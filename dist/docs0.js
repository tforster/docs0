#!/usr/bin/env node
/* eslint-disable no-console */
// docs0.js — DOCS0 markdown documentation compiler
//
// Usage: docs0 <docs-root> [--out=file.html] [--open=false] [-w|--watch] [-v|--verbose] [--workers=N]
//        npx @tforster/docs0 <docs-root>
//
// Walks the .md tree below <docs-root> and compiles it into ONE self-contained HTML file: CSS, JS, images (as data: URIs) and a
// mermaid fallback runtime are all embedded. The folder hierarchy becomes the left nav, each page's
// `## Table of Contents <!-- omit in toc -->` list becomes a sticky right sidebar, and hash routing (#/folder/page/section)
// switches pages without a server. The output opens in the default browser unless open=false (e.g. in CI).
//
// Pages are rendered by docs0.render.js — inline for small trees, on a pool of worker threads (docs0.worker.js) for large ones —
// and cached, so --watch only re-renders what a change affects before reassembling the file.
//
// Dependencies: marked (Markdown → HTML), highlight.js (syntax highlighting), mermaid (diagrams, CDN with embedded fallback)

// System dependencies
import {
  readFileSync,
  writeFileSync,
  appendFileSync,
  readdirSync,
  renameSync,
  statSync,
  existsSync,
  mkdirSync,
  realpathSync,
  watch,
} from "fs";
import { resolve, dirname, extname, relative, join, basename, sep } from "path";
import { fileURLToPath } from "url";
import { execFile, execFileSync } from "child_process";
import { createRequire } from "module";
import { tmpdir, availableParallelism } from "os";
import { createHash } from "crypto";
import { Worker } from "worker_threads";

// Project dependencies
import { IMAGE_MIME, esc, githubSlug, stripOrder, prettify, routeHref } from "./docs0.shared.js";

export { esc, githubSlug, prettify, routeHref };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const MERMAID_CDN = "https://cdn.jsdelivr.net/npm/mermaid@11.13.0/dist/mermaid.min.js";
const IGNORED_DIRS = new Set(["node_modules"]);
const LANDING_RE = /^(readme|index)\.md$/i;
/** Below this many pages, worker start-up costs more than it saves, so pages render on the main thread. */
const WORKER_THRESHOLD = 40;
/** Quiet period after the last file-system event before a watch rebuild starts. */
const DEBOUNCE_MS = 75;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Labels a folder in the nav. The folder name is the source of truth (it is unique among siblings, whereas README titles often
 * repeat, e.g. several `# Explanation` READMEs in a Diátaxis tree). When the landing page title contains the folder name, its
 * casing is borrowed: `iam` + "IAM — Explanation" → `IAM`, `domain-driven-design` + "Domain-Driven Design" → `Domain-Driven Design`.
 *
 * @param {string} name - Folder name.
 * @param {string} [title] - Landing page title.
 * @returns {string} Label.
 */
export function folderLabel(name, title) {
  const words = stripOrder(name)
    .split(/[-_. ]+/)
    .filter(Boolean);
  if (title && words.length) {
    const pattern = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[-_.\\s]+");
    const m = title.match(new RegExp(`(?<![\\p{L}\\p{N}])${pattern}s?(?![\\p{L}\\p{N}])`, "iu"));
    if (m) return m[0];
  }
  return prettify(name);
}

/**
 * Maps a docs-root-relative .md path to its hash route. Ordering prefixes and `.md` are dropped, README/index collapse onto their
 * folder, and the result is lower-cased: `01-Guides/02-install.md` → `guides/install`, `README.md` → `` (home).
 *
 * @param {string} rel - Relative path using `/` separators.
 * @returns {string} Route.
 */
export function routeFromRel(rel) {
  const segs = rel.split("/");
  if (LANDING_RE.test(segs.at(-1))) segs.pop();
  return segs.map((s) => stripOrder(s.replace(/\.md$/i, "")).toLowerCase().replace(/\s+/g, "-")).join("/");
}

/**
 * Parses CLI arguments. Accepts `--open=false`, `open=false`, `--no-open`, `--out=file`, `out=file`, `-w`/`--watch`,
 * `-v`/`--verbose` and `--workers=N`/`workers=N`. Opening defaults to off when the CI environment variable is set.
 *
 * @param {string[]} argv - Arguments after the script path.
 * @param {Record<string, string|undefined>} [env] - Environment.
 * @returns {{ root: string|undefined, out: string|undefined, open: boolean, watch: boolean, verbose: boolean,
 *   workers: number|undefined, help: boolean }} Parsed options; `out` is undefined unless given, meaning "use the temp-folder
 *   default", and `workers` is undefined unless given, meaning "decide from the page count".
 */
export function parseArgs(argv, env = process.env) {
  /** @type {Record<string, string>} */
  const flags = {};
  const positional = [];
  for (const arg of argv) {
    const m = arg.match(/^(?:--)?(open|out|workers)=(.*)$/);
    if (arg === "--no-open") flags.open = "false";
    else if (arg === "--open") flags.open = "true";
    else if (arg === "-h" || arg === "--help") flags.help = "true";
    else if (arg === "-v" || arg === "--verbose") flags.verbose = "true";
    else if (arg === "-w" || arg === "--watch") flags.watch = "true";
    else if (m) flags[m[1]] = m[2];
    else positional.push(arg);
  }
  const open = flags.open === undefined ? !env.CI : !/^(false|0|no|off)$/i.test(flags.open);
  const workers = /^\d+$/.test(flags.workers ?? "") ? Number(flags.workers) : undefined;
  return {
    root: positional[0],
    out: flags.out || undefined,
    open,
    watch: !!flags.watch,
    verbose: !!flags.verbose,
    workers,
    help: !!flags.help,
  };
}

/**
 * Default output location: `<os temp>/docs0/<site>-<hash>/index.html`. The hash of the absolute docs root keeps the path stable
 * across runs (re-running refreshes the same file, so an open tab just needs a reload) and distinct between projects. Being an
 * `index.html` in its own folder, the directory can be uploaded to GitHub Pages as-is.
 *
 * @param {string} root - Docs root.
 * @param {string} siteName - Site name (package name or folder).
 * @param {string} [tmp] - Temp directory, defaults to the OS one.
 * @returns {string} Absolute output file path.
 */
export function defaultOut(root, siteName, tmp = tmpdir()) {
  const slug =
    siteName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "docs";
  const hash = createHash("sha256").update(resolve(root)).digest("hex").slice(0, 8);
  return join(tmp, "docs0", `${slug}-${hash}`, "index.html");
}

/**
 * Finds the version in the closest package.json at or above a directory.
 *
 * @param {string} dir - Starting directory.
 * @returns {{ name: string|null, version: string|null }} Package name and version, null when not found.
 */
export function findPackage(dir) {
  for (let d = resolve(dir); ; d = dirname(d)) {
    const p = join(d, "package.json");
    if (existsSync(p)) {
      try {
        const pkg = JSON.parse(readFileSync(p, "utf8"));
        if (pkg.version) return { name: pkg.name ?? null, version: pkg.version };
      } catch {
        // Malformed package.json — keep walking up
      }
    }
    if (dirname(d) === d) return { name: null, version: null };
  }
}

/**
 * Formats a Date as a local yyyy-mm-dd string.
 *
 * @param {Date} d - Date.
 * @returns {string} yyyy-mm-dd.
 */
function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Stats a path, returning null when it vanished (files can disappear between readdir and stat while an editor saves).
 *
 * @param {string} abs - Absolute path.
 * @returns {import("fs").Stats|null} Stats.
 */
function statOrNull(abs) {
  try {
    return statSync(abs);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Tree discovery
// ---------------------------------------------------------------------------

/**
 * @typedef {object} Page
 * @property {string} file    Absolute path to the .md file.
 * @property {string} rel     Docs-root-relative path with `/` separators.
 * @property {string} route   Hash route.
 * @property {string} title   First H1, or prettified filename (set once rendered).
 * @property {string} updated Last-updated date (file modified time), yyyy-mm-dd.
 * @property {string} stamp   Modified time and size; a changed stamp means the page must be re-rendered.
 *
 * @typedef {object} DirNode
 * @property {"dir"} type    Node discriminator.
 * @property {string} name   Folder name.
 * @property {Page|null} landing README/index page for the folder.
 * @property {Array<DirNode|{type:"page", page: Page}>} children Sub-folders and pages in nav order.
 *
 * @typedef {import("./docs0.render.js").PageResult} PageResult
 */

/**
 * Recursively collects .md files, skipping dotfiles and node_modules. Folders with no markdown are omitted. At every level the
 * landing page comes first, then loose files, then folders; each group sorts by name with numeric collation so `01-`, `02-` …
 * prefixes control ordering. Files lead so a folder's own pages sit beside its landing page instead of below expanded sub-trees.
 * Web-safe images met on the way are recorded in `images` (path → stamp) so a watch rebuild can tell which ones changed.
 *
 * @param {string} dir - Absolute directory.
 * @param {string} root - Absolute docs root.
 * @param {Map<string, string>} images - Collected image stamps.
 * @returns {DirNode|null} Directory node, or null when it holds no markdown.
 */
function walk(dir, root, images) {
  const entries = readdirSync(dir, { withFileTypes: true })
    .filter((e) => !e.name.startsWith(".") && !IGNORED_DIRS.has(e.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));

  /** @type {DirNode} */
  const node = { type: "dir", name: basename(dir), landing: null, children: [] };
  const files = [];
  const folders = [];
  for (const e of entries) {
    const abs = join(dir, e.name);
    const st = e.isSymbolicLink() || !e.isDirectory() ? statOrNull(abs) : null;
    if (e.isDirectory() || st?.isDirectory()) {
      const child = walk(abs, root, images);
      if (child) folders.push(child);
    } else if (!st) continue;
    else if (/\.md$/i.test(e.name)) {
      const rel = relative(root, abs).split(sep).join("/");
      /** @type {Page} */
      const page = {
        file: abs,
        rel,
        route: routeFromRel(rel),
        title: prettify(e.name),
        updated: isoDate(st.mtime),
        stamp: `${st.mtimeMs}:${st.size}`,
      };
      if (LANDING_RE.test(e.name) && !node.landing) node.landing = page;
      else files.push({ type: /** @type {const} */ ("page"), page });
    } else if (IMAGE_MIME[extname(e.name).toLowerCase()]) images.set(abs, `${st.mtimeMs}:${st.size}`);
  }
  node.children = [...files, ...folders];
  return node.landing || node.children.length ? node : null;
}

/**
 * Flattens the tree into nav (reading) order.
 *
 * @param {DirNode} node - Directory node.
 * @returns {Page[]} Pages in order.
 */
function flatten(node) {
  const out = node.landing ? [node.landing] : [];
  for (const c of node.children) out.push(...(c.type === "page" ? [c.page] : flatten(c)));
  return out;
}

// ---------------------------------------------------------------------------
// Renderers — inline, or a pool of worker threads
// ---------------------------------------------------------------------------

/**
 * @typedef {object} Renderer
 * @property {(routes: Array<[string, string]>) => void} setRoutes Shares the file → route map with every render thread.
 * @property {(page: { file: string, route: string }) => Promise<PageResult>} render Renders one page.
 * @property {() => Promise<void>} close Stops any threads.
 */

/**
 * Picks a worker count for a tree: none for small trees, else one per spare core (capped). A single worker would only add
 * start-up and messaging cost to the same serial work, so fewer than two means render inline.
 *
 * @param {number} pages - Page count.
 * @returns {number} Worker count, 0 for inline.
 */
function defaultWorkers(pages) {
  if (pages < WORKER_THRESHOLD) return 0;
  const n = Math.min(availableParallelism() - 1, 8, Math.ceil(pages / 20));
  return n >= 2 ? n : 0;
}

/**
 * Renders pages on the main thread. The render module (and with it marked and highlight.js) loads only when needed, so a
 * worker-backed build never pays for it on the main thread.
 *
 * @returns {Promise<Renderer>} Renderer.
 */
async function createInlineRenderer() {
  const { createPageRenderer } = await import("./docs0.render.js");
  const r = createPageRenderer();
  return {
    setRoutes: (routes) => r.setRoutes(routes),
    render: async (page) => r.render(page),
    close: async () => {},
  };
}

/**
 * Renders pages on a pool of worker threads. Each worker handles one page at a time and pulls the next queued page as soon as it
 * is free, so a few slow pages do not hold up the rest. A worker that crashes fails its page and is replaced.
 *
 * @param {number} size - Worker count.
 * @returns {Renderer} Renderer.
 */
function createWorkerPool(size) {
  const url = new URL("./docs0.worker.js", import.meta.url);
  /** @type {Array<{ page: object, resolve: (r: PageResult) => void, reject: (e: Error) => void }>} */
  const queue = [];
  /** @type {Set<Worker>} */
  const all = new Set();
  /** @type {Worker[]} */
  const idle = [];
  /** @type {Map<Worker, (typeof queue)[number]>} */
  const busy = new Map();
  /** @type {Array<[string, string]>} */
  let routes = [];
  let closing = false;

  /** Hands queued pages to idle workers. */
  function pump() {
    while (idle.length && queue.length) {
      const w = idle.pop();
      const job = queue.shift();
      busy.set(w, job);
      w.postMessage({ type: "render", page: job.page });
    }
  }

  /**
   * Settles the page a worker was rendering, if any.
   *
   * @param {Worker} w - Worker.
   * @param {(job: (typeof queue)[number]) => void} fn - Settles the job.
   */
  function settle(w, fn) {
    const job = busy.get(w);
    busy.delete(w);
    if (job) fn(job);
  }

  /** Starts a worker and primes it with the current routes. */
  function spawn() {
    const w = new Worker(url);
    all.add(w);
    w.postMessage({ type: "routes", routes });
    w.on("message", (msg) => {
      settle(w, (job) => (msg.error ? job.reject(new Error(msg.error)) : job.resolve(msg.result)));
      idle.push(w);
      pump();
    });
    w.on("error", (err) => settle(w, (job) => job.reject(err)));
    w.on("exit", () => {
      settle(w, (job) => job.reject(new Error("render worker exited")));
      all.delete(w);
      idle.splice(idle.indexOf(w) >>> 0, 1);
      if (!closing) {
        spawn();
        pump();
      }
    });
    idle.push(w);
  }

  for (let i = 0; i < size; i++) spawn();

  return {
    setRoutes(next) {
      // Messages to a worker are handled in order, so any page queued after this sees the new routes
      routes = next;
      for (const w of all) w.postMessage({ type: "routes", routes });
    },
    render(page) {
      return new Promise((resolve, reject) => {
        queue.push({ page, resolve, reject });
        pump();
      });
    },
    async close() {
      closing = true;
      await Promise.all([...all].map((w) => w.terminate()));
    },
  };
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

/**
 * Renders one nav link.
 *
 * @param {Page} p - Page.
 * @param {string} [label] - Link text; defaults to the page title.
 * @returns {string} HTML string.
 */
function navLink(p, label = p.title) {
  return `<a class="nav-link" href="${esc(routeHref(p.route))}" data-route="${esc(p.route)}">${esc(label)}</a>`;
}

/**
 * Renders the nav tree as nested lists. Folders are <details>; top-level folders start open.
 *
 * @param {DirNode} node - Directory node.
 * @param {number} depth - Nesting depth.
 * @returns {string} HTML string.
 */
function renderNav(node, depth = 0) {
  const items = node.children.map((c) => {
    if (c.type === "page") return `<li>${navLink(c.page)}</li>`;
    const text = folderLabel(c.name, c.landing?.title);
    const label = c.landing ? navLink(c.landing, text) : `<span class="nav-label">${esc(text)}</span>`;
    return `<li class="nav-dir"><details${depth === 0 ? " open" : ""}><summary>${label}</summary>${renderNav(c, depth + 1)}</details></li>`;
  });
  if (depth === 0 && node.landing) items.unshift(`<li>${navLink(node.landing)}</li>`);
  return `<ul class="nav-list">${items.join("")}</ul>`;
}

/**
 * Wraps a rendered page in its <article>, with the pager to its neighbours.
 *
 * @param {Page} p - Page.
 * @param {PageResult} r - Render result.
 * @param {Page|undefined} prev - Previous page.
 * @param {Page|undefined} next - Next page.
 * @param {string} rootName - Docs root folder name, for the displayed path.
 * @returns {string} HTML string.
 */
function renderArticle(p, r, prev, next, rootName) {
  const pager = [
    prev
      ? `<a class="pager-prev" href="${esc(routeHref(prev.route))}"><small>Previous</small>${esc(prev.title)}</a>`
      : "<span></span>",
    next ? `<a class="pager-next" href="${esc(routeHref(next.route))}"><small>Next</small>${esc(next.title)}</a>` : "<span></span>",
  ].join("");
  return `<article class="page${r.toc ? " has-toc" : ""}" data-route="${esc(p.route)}" data-path="${esc(`${rootName}/${p.rel}`)}" data-title="${esc(p.title)}" data-updated="${esc(p.updated)}" hidden>
  <div class="page-main">
    <div class="markdown">
${r.body}
    </div>
    <nav class="pager" aria-label="Pages">${pager}</nav>
  </div>${r.toc ? `\n  <aside class="page-toc" aria-label="On this page"><div class="toc-title">On this page</div>${r.toc}</aside>` : ""}
</article>`;
}

/**
 * @typedef {object} BuildResult
 * @property {string} html            Complete HTML document.
 * @property {Page[]} pages           Pages in nav order.
 * @property {string} siteName        Package name or prettified root folder name.
 * @property {string|null} version    Version from the closest package.json.
 * @property {string[]} warnings      All current warnings (broken links, missing images), de-duplicated.
 * @property {number} rendered        Pages rendered by this build; the rest came from the cache.
 * @property {number} removed         Pages gone since the previous build.
 * @property {boolean} changed        False when nothing relevant changed since the previous build.
 */

/**
 * Creates a reusable builder for a docs tree. Each build() rescans the tree, re-renders only pages whose file changed or whose
 * inlined images or link targets changed, then reassembles the document from cached results. Nav, pager and folder labels are
 * rebuilt every time because they are cheap and depend on titles across pages.
 *
 * @param {string} rootArg - Path to the docs root.
 * @param {{ workers?: number, warn?: (msg: string) => void }} [options] - Worker count (default: from page count) and a callback
 *   for warnings from freshly rendered pages.
 * @returns {{ build: () => Promise<BuildResult>, close: () => Promise<void> }} Builder.
 */
export function createBuilder(rootArg, options = {}) {
  const root = resolve(rootArg);
  const rootName = basename(root);
  /** @type {Map<string, { stamp: string, result: PageResult }>} */
  const cache = new Map();
  /** @type {Renderer|null} */
  let renderer = null;
  /** @type {{ files: Set<string>, images: Map<string, string> }|null} */
  let last = null;

  /**
   * Builds the document, reusing unaffected pages from the previous build.
   *
   * @returns {Promise<BuildResult>} Result.
   */
  async function build() {
    if (!statOrNull(root)?.isDirectory()) throw new Error(`docs root not found: ${rootArg}`);
    /** @type {Map<string, string>} */
    const images = new Map();
    const tree = walk(root, root, images);
    if (!tree) throw new Error(`no .md files found below ${rootArg}`);
    const pages = flatten(tree);
    const files = new Set(pages.map((p) => p.file));

    // Paths whose appearance, disappearance or change affects pages that link to or inline them
    const stale = new Set();
    let structural = !last;
    let removed = 0;
    if (last) {
      for (const f of files) if (!last.files.has(f)) stale.add(f);
      for (const f of last.files) {
        if (files.has(f)) continue;
        stale.add(f);
        removed++;
      }
      structural = stale.size > 0;
      // A folder link resolves to its README/index, so it is affected when that landing page comes or goes
      const landingDirs = [...stale].filter((f) => LANDING_RE.test(basename(f))).map((f) => dirname(f));
      for (const d of landingDirs) stale.add(d);
      for (const [img, stamp] of images) if (last.images.get(img) !== stamp) stale.add(img);
      for (const img of last.images.keys()) if (!images.has(img)) stale.add(img);
    }
    for (const [f, c] of cache) {
      if (!files.has(f) || c.result.links.some((l) => stale.has(l)) || c.result.images.some((i) => stale.has(i))) cache.delete(f);
    }

    if (!renderer) {
      const n = options.workers ?? defaultWorkers(pages.length);
      renderer = n > 0 ? createWorkerPool(n) : await createInlineRenderer();
    }
    if (structural) renderer.setRoutes(pages.map((p) => [p.file, p.route]));

    const todo = pages.filter((p) => cache.get(p.file)?.stamp !== p.stamp);
    const settled = await Promise.allSettled(
      todo.map((p) =>
        renderer.render({ file: p.file, route: p.route }).then((result) => {
          cache.set(p.file, { stamp: p.stamp, result });
          for (const w of result.warnings) options.warn?.(w);
        }),
      ),
    );
    const failed = settled.find((s) => s.status === "rejected");
    if (failed) throw /** @type {PromiseRejectedResult} */ (failed).reason;
    const changed = !last || structural || stale.size > 0 || todo.length > 0;
    last = { files, images };

    const results = pages.map((p) => cache.get(p.file).result);
    pages.forEach((p, i) => (p.title = results[i].title));
    const pkg = findPackage(root);
    const siteName = pkg.name ?? prettify(rootName);
    const html = buildHtml({
      siteName,
      version: pkg.version,
      nav: renderNav(tree),
      articles: pages.map((p, i) => renderArticle(p, results[i], pages[i - 1], pages[i + 1], rootName)).join("\n"),
      mermaid: results.some((r) => r.mermaid),
    });
    const warnings = [...new Set(results.flatMap((r) => r.warnings))];
    return { html, pages, siteName, version: pkg.version, warnings, rendered: todo.length, removed, changed };
  }

  return {
    build,
    close: async () => renderer?.close(),
  };
}

/**
 * Compiles a docs tree into a single self-contained HTML document (one-off build).
 *
 * @param {string} rootArg - Path to the docs root.
 * @param {{ workers?: number, warn?: (msg: string) => void }} [options] - Options, as for createBuilder.
 * @returns {Promise<BuildResult>} Build result.
 */
export async function build(rootArg, options = {}) {
  const builder = createBuilder(rootArg, options);
  try {
    return await builder.build();
  } finally {
    await builder.close();
  }
}

// ---------------------------------------------------------------------------
// HTML assembly
// ---------------------------------------------------------------------------

/**
 * Reads a highlight.js stylesheet from the installed package (works with npx and global installs).
 *
 * @param {string} name - Style file name.
 * @returns {string} CSS.
 */
function hljsStyle(name) {
  const hljsRoot = dirname(createRequire(import.meta.url).resolve("highlight.js/package.json"));
  return readFileSync(resolve(hljsRoot, "styles", name), "utf8");
}

/** Inline SVG logo: a page outline with DOCS0's slashed zero. */
const LOGO = `<svg class="logo" viewBox="0 0 100 100" aria-hidden="true"><path d="M24 14h38l16 16v56H24z" fill="none" stroke="currentColor" stroke-width="6" stroke-linejoin="round"/><ellipse cx="51" cy="55" rx="11" ry="16" fill="none" stroke="currentColor" stroke-width="6"/><line x1="37" y1="74" x2="65" y2="36" stroke="currentColor" stroke-width="6" stroke-linecap="round"/></svg>`;

/** @type {{ css: string, clientJs: string, hlCss: string, mermaidFallback: string }|undefined} */
let assets;

/**
 * Loads the stylesheets and scripts embedded in every build, once per process (watch rebuilds reuse them).
 *
 * @returns {{ css: string, clientJs: string, hlCss: string, mermaidFallback: string }} Assets.
 */
function staticAssets() {
  if (assets) return assets;
  const vendor = resolve(__dirname, "../vendor/mermaid.min.js");
  assets = {
    css: readFileSync(resolve(__dirname, "docs0.css"), "utf8"),
    clientJs: readFileSync(resolve(__dirname, "docs0.client.js"), "utf8"),
    // Theme-scoped highlight.js styles via native CSS nesting: :root[data-theme] raises specificity so the right one wins
    hlCss: `:root[data-theme="light"] {\n${hljsStyle("github.min.css")}\n}\n:root[data-theme="dark"] {\n${hljsStyle("github-dark.min.css")}\n}`,
    // Embedded offline fallback, used only when some page has diagrams. Neutralise any "</script" so the block cannot end early.
    mermaidFallback: existsSync(vendor)
      ? `\n  <script type="text/plain" id="docs0-mermaid">${readFileSync(vendor, "utf8").replace(/<\/script/gi, "<\\/script")}</script>`
      : "",
  };
  return assets;
}

/**
 * Builds the full HTML document string.
 *
 * @param {{ siteName: string, version: string|null, nav: string, articles: string, mermaid: boolean }} parts - Page parts.
 * @returns {string} Complete HTML document.
 */
function buildHtml({ siteName, version, nav, articles, mermaid }) {
  const { css, clientJs, hlCss, mermaidFallback } = staticAssets();
  const config = JSON.stringify({ siteName, mermaidCdn: MERMAID_CDN }).replace(/</g, "\\u003c");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="generator" content="DOCS0">
  <title>${esc(siteName)}</title>
  <script>
    // Apply the theme and zen mode before first paint: stored choice, else the system preference
    (function () {
      var t;
      try { t = localStorage.getItem("docs0-theme"); } catch (e) {}
      if (t !== "light" && t !== "dark") t = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
      document.documentElement.dataset.theme = t;
      try { if (localStorage.getItem("docs0-zen") === "1") document.documentElement.classList.add("zen"); } catch (e) {}
    })();
  </script>
  <style>
${hlCss}
${css}
  </style>
</head>
<body>
  <header id="topbar">
    <button id="nav-toggle" type="button" aria-label="Toggle navigation" aria-controls="nav" aria-expanded="false">&#9776;</button>
    <a id="brand" href="#/">${LOGO}<span>DOCS0</span></a>
    <span id="site-name">${esc(siteName)}</span>
    <code id="current-path"></code>
    <time id="updated" title="Last updated"></time>
    <span class="spacer"></span>
    ${version ? `<span id="version" title="Documentation version">v${esc(version)}</span>` : ""}
    <button id="zen-toggle" type="button" aria-label="Toggle zen mode" aria-pressed="false" title="Zen mode: hide sidebars">
      <svg class="icon-expand" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9V3h6M21 9V3h-6M3 15v6h6M21 15v6h-6"/></svg>
      <svg class="icon-collapse" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3v6H3M15 3v6h6M9 21v-6H3M15 21v-6h6"/></svg>
    </button>
    <button id="theme-toggle" type="button" aria-label="Toggle dark mode" title="Toggle dark mode">
      <svg class="icon-sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.5"/><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3M4.6 4.6l2.1 2.1M17.3 17.3l2.1 2.1M4.6 19.4l2.1-2.1M17.3 6.7l2.1-2.1"/></svg>
      <svg class="icon-moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z"/></svg>
    </button>
  </header>
  <nav id="nav" aria-label="Documentation">
${nav}
  </nav>
  <div id="scrim"></div>
  <main id="content">
${articles}
  </main>
  <script type="application/json" id="docs0-config">${config}</script>${mermaid ? mermaidFallback : ""}
  <script>${clientJs}</script>
</body>
</html>`;
}
// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/** Ignores child-process results; openers often exit non-zero even on success. */
const quiet = () => {};

/**
 * Opens a file in the default browser (macOS, Windows, WSL, Linux).
 *
 * @param {string} file - Absolute file path.
 */
function openInBrowser(file) {
  if (process.platform === "darwin") execFile("open", [file], quiet);
  else if (process.platform === "win32") execFile("cmd", ["/c", "start", "", file], quiet);
  else if (process.env.WSL_DISTRO_NAME) {
    // explorer.exe needs a Windows path and always exits non-zero, hence the ignored callback
    execFile("explorer.exe", [execFileSync("wslpath", ["-w", file]).toString().trim()], quiet);
  } else execFile("xdg-open", [file], quiet);
}

/**
 * Writes the output atomically (temp file + rename), so a browser refresh mid-write never loads a truncated page.
 *
 * @param {string} out - Absolute output path.
 * @param {string} html - Document.
 */
function writeOut(out, html) {
  mkdirSync(dirname(out), { recursive: true });
  const tmp = `${out}.${process.pid}.tmp`;
  writeFileSync(tmp, html);
  renameSync(tmp, out);
}

/**
 * Summarises hidden warnings for a status line.
 *
 * @param {number} n - Warning count.
 * @param {boolean} verbose - Whether warnings were already listed.
 * @returns {string} Suffix, empty when there is nothing to add.
 */
function warningHint(n, verbose) {
  return n && !verbose ? ` · ${n} warning${n === 1 ? "" : "s"} (-v to list)` : "";
}

/**
 * Watches the docs tree and rebuilds after changes. File-system events are only a trigger: editors save through temp files and
 * renames, so event types are unreliable, and the builder's rescan works out what actually changed. Builds never overlap; events
 * during a build queue exactly one more.
 *
 * @param {ReturnType<typeof createBuilder>} builder - Builder that produced the initial output.
 * @param {string} root - Absolute docs root.
 * @param {string} out - Absolute output path.
 * @param {boolean} verbose - List warnings from re-rendered pages.
 */
function watchDocs(builder, root, out, verbose) {
  /** @type {NodeJS.Timeout|undefined} */
  let timer;
  let running = false;
  let again = false;

  /** Rebuilds until no further changes arrived meanwhile. */
  async function rebuild() {
    if (running) {
      again = true;
      return;
    }
    running = true;
    do {
      again = false;
      const started = performance.now();
      try {
        const r = await builder.build();
        if (!r.changed) continue;
        writeOut(out, r.html);
        const time = new Date().toTimeString().slice(0, 8);
        const ms = (performance.now() - started).toFixed(0);
        const what = `${r.rendered} page${r.rendered === 1 ? "" : "s"} re-rendered${r.removed ? `, ${r.removed} removed` : ""}`;
        console.log(`↻  ${time}  ${what} · ${ms} ms${warningHint(r.warnings.length, verbose)}`);
      } catch (err) {
        // Keep watching and keep the last good output; the next save gets another try
        console.error(`docs0: ${/** @type {Error} */ (err).message}`);
      }
    } while (again);
    running = false;
  }

  const watcher = watch(root, { recursive: true }, (_event, name) => {
    if (
      name &&
      String(name)
        .split(/[\\/]/)
        .some((s) => s.startsWith(".") || IGNORED_DIRS.has(s))
    )
      return;
    clearTimeout(timer);
    timer = setTimeout(rebuild, DEBOUNCE_MS);
  });

  const stop = async () => {
    clearTimeout(timer);
    watcher.close();
    await builder.close();
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  console.log(`   Watching ${root} · Ctrl-C to stop\n`);
}

/** Entry point when run as a command. */
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || !opts.root) {
    console.error("Usage: docs0 <docs-root> [--out=file.html] [--open=false] [-w|--watch] [-v|--verbose] [--workers=N]");
    process.exit(opts.help ? 0 : 1);
  }

  const started = performance.now();
  // Warnings (broken links, missing images) are listed only with --verbose; otherwise just counted in the summary
  const builder = createBuilder(opts.root, {
    workers: opts.workers,
    warn: opts.verbose ? (msg) => console.warn(`docs0: warning: ${msg}`) : undefined,
  });
  let result;
  try {
    result = await builder.build();
  } catch (err) {
    console.error(`docs0: ${/** @type {Error} */ (err).message}`);
    await builder.close();
    process.exit(1);
  }

  const out = opts.out ? resolve(opts.out) : defaultOut(opts.root, result.siteName);
  writeOut(out, result.html);
  // Inside GitHub Actions, expose the location to later steps (e.g. upload-pages-artifact with: path: steps.<id>.outputs.dir)
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `file=${out}\ndir=${dirname(out)}\n`);

  const kb = (Buffer.byteLength(result.html) / 1024).toFixed(0);
  console.log(`\n📚  DOCS0 → ${out}`);
  console.log(
    `   ${result.pages.length} pages from ${resolve(opts.root)} · ${kb} KB · ${(performance.now() - started).toFixed(0)} ms${warningHint(result.warnings.length, opts.verbose)}\n`,
  );
  if (opts.open) openInBrowser(out);
  if (opts.watch) watchDocs(builder, resolve(opts.root), out, opts.verbose);
  else await builder.close();
}

// Run only when invoked directly (bin symlinks resolved), not when imported by tests
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
