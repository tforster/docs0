#!/usr/bin/env node
/* eslint-disable no-console */
// docs0.js — DOCS0 markdown documentation compiler
//
// Usage: docs0 <docs-root> [--out=docs.html] [--open=false]
//        npx @tforster/docs0 <docs-root>
//
// Walks the .md tree below <docs-root> and compiles it into ONE self-contained HTML file: CSS, JS, images (as data: URIs) and a
// mermaid fallback runtime are all embedded. The folder hierarchy becomes the left nav, each page's
// `## Table of Contents <!-- omit in toc -->` list becomes a sticky right sidebar, and hash routing (#/folder/page/section)
// switches pages without a server. The output opens in the default browser unless open=false (e.g. in CI).
//
// Dependencies: marked (Markdown → HTML), highlight.js (syntax highlighting), mermaid (diagrams, CDN with embedded fallback)

// System dependencies
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync, realpathSync } from "fs";
import { resolve, dirname, extname, relative, join, basename, sep } from "path";
import { fileURLToPath } from "url";
import { execFile, execFileSync } from "child_process";
import { createRequire } from "module";

// Third-party dependencies
import { Marked } from "marked";
import hljs from "highlight.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const MERMAID_CDN = "https://cdn.jsdelivr.net/npm/mermaid@11.13.0/dist/mermaid.min.js";
const IGNORED_DIRS = new Set(["node_modules"]);
const LANDING_RE = /^(readme|index)\.md$/i;
const TOC_RE = /^table of contents\b/i;

/** @type {Record<string, string>} Web-safe image types that get inlined as data: URIs. */
const IMAGE_MIME = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Escapes a string for safe use in HTML text and attribute values.
 *
 * @param {string} s - Raw text.
 * @returns {string} Escaped text.
 */
export function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Reduces rendered inline HTML to plain text (tags and comments stripped, common entities decoded).
 *
 * @param {string} html - Inline HTML.
 * @returns {string} Plain text.
 */
function plainText(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

/**
 * Produces a GitHub-compatible heading slug so hand-written TOC links (e.g. `#1-features`) resolve.
 *
 * @param {string} text - Plain heading text.
 * @returns {string} Slug.
 */
export function githubSlug(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "")
    .replace(/ /g, "-");
}

/**
 * Strips an ordering prefix such as `01-` or `2_` from a file or folder name.
 *
 * @param {string} name - File or folder name.
 * @returns {string} Name without prefix.
 */
function stripOrder(name) {
  return name.replace(/^\d+[-_. ]+/, "");
}

/**
 * Turns a file or folder name into a human label: `02-getting_started.md` → `Getting started`.
 *
 * @param {string} name - File or folder name.
 * @returns {string} Label.
 */
export function prettify(name) {
  const s = stripOrder(name.replace(/\.md$/i, "")).replace(/[-_]+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

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
 * Builds a hash href for a route and optional in-page anchor.
 *
 * @param {string} route - Page route.
 * @param {string} [anchor] - Heading slug.
 * @returns {string} Hash href.
 */
export function routeHref(route, anchor) {
  return "#/" + [route, anchor].filter(Boolean).join("/");
}

/**
 * Parses CLI arguments. Accepts `--open=false`, `open=false`, `--no-open`, `--out=file` and `out=file`.
 * Opening defaults to off when the CI environment variable is set.
 *
 * @param {string[]} argv - Arguments after the script path.
 * @param {Record<string, string|undefined>} [env] - Environment.
 * @returns {{ root: string|undefined, out: string, open: boolean, help: boolean }} Parsed options.
 */
export function parseArgs(argv, env = process.env) {
  /** @type {Record<string, string>} */
  const flags = {};
  const positional = [];
  for (const arg of argv) {
    const m = arg.match(/^(?:--)?(open|out)=(.*)$/);
    if (arg === "--no-open") flags.open = "false";
    else if (arg === "--open") flags.open = "true";
    else if (arg === "-h" || arg === "--help") flags.help = "true";
    else if (m) flags[m[1]] = m[2];
    else positional.push(arg);
  }
  const open = flags.open === undefined ? !env.CI : !/^(false|0|no|off)$/i.test(flags.open);
  return { root: positional[0], out: flags.out || "docs.html", open, help: !!flags.help };
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
 * Collects last-commit dates (yyyy-mm-dd) for committed, unmodified files below a directory in one pass over git history.
 * Files that are untracked or have uncommitted changes are left out so callers fall back to mtime. Returns an empty map when
 * git or a repository is unavailable. Works in jj colocated repos, whose commits live in git.
 *
 * @param {string} dir - Absolute directory.
 * @returns {Map<string, string>} Absolute path → yyyy-mm-dd.
 */
export function gitDates(dir) {
  /** @type {Map<string, string>} */
  const dates = new Map();
  const git = (/** @type {string[]} */ args) =>
    execFileSync("git", ["-C", dir, "-c", "core.quotePath=false", ...args], {
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 256 * 1024 * 1024,
    }).toString();
  try {
    const top = git(["rev-parse", "--show-toplevel"]).trim();
    // Porcelain -z: "XY path\0", with renames/copies followed by an extra "orig\0"
    const dirty = new Set();
    const status = git(["status", "--porcelain", "-z", "--untracked-files=all", "--", "."]).split("\0");
    for (let i = 0; i < status.length; i++) {
      if (status[i].length < 4) continue;
      dirty.add(join(top, status[i].slice(3)));
      if (/^[RC]/.test(status[i])) i++;
    }
    // Newest commits first, so the first date seen for a file is its latest
    for (const chunk of git(["log", "--format=%x00%cs", "--name-only", "--no-renames", "--", "."]).split("\0").slice(1)) {
      const [date, ...files] = chunk.split("\n").filter(Boolean);
      for (const f of files) {
        const abs = join(top, f);
        if (!dates.has(abs) && !dirty.has(abs)) dates.set(abs, date);
      }
    }
  } catch {
    // Not a git checkout or git missing — every file falls back to mtime
  }
  return dates;
}

// ---------------------------------------------------------------------------
// Tree discovery
// ---------------------------------------------------------------------------

/**
 * @typedef {object} Page
 * @property {string} file   Absolute path to the .md file.
 * @property {string} rel    Docs-root-relative path with `/` separators.
 * @property {string} route  Hash route.
 * @property {string} title  First H1, or prettified filename.
 * @property {any[]}  tokens marked token list.
 * @property {string} updated Last-updated date, yyyy-mm-dd.
 *
 * @typedef {object} DirNode
 * @property {"dir"} type    Node discriminator.
 * @property {string} name   Folder name.
 * @property {Page|null} landing README/index page for the folder.
 * @property {Array<DirNode|{type:"page", page: Page}>} children Sub-folders and pages in nav order.
 */

/**
 * Recursively collects .md files, skipping dotfiles and node_modules. Folders with no markdown are omitted. At every level the
 * landing page comes first, then loose files, then folders; each group sorts by name with numeric collation so `01-`, `02-` …
 * prefixes control ordering. Files lead so a folder's own pages sit beside its landing page instead of below expanded sub-trees.
 *
 * @param {string} dir - Absolute directory.
 * @param {string} root - Absolute docs root.
 * @param {(file: string, rel: string) => Page} makePage - Page factory.
 * @returns {DirNode|null} Directory node, or null when it holds no markdown.
 */
function walk(dir, root, makePage) {
  const entries = readdirSync(dir, { withFileTypes: true })
    .filter((e) => !e.name.startsWith(".") && !IGNORED_DIRS.has(e.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));

  /** @type {DirNode} */
  const node = { type: "dir", name: basename(dir), landing: null, children: [] };
  const files = [];
  const folders = [];
  for (const e of entries) {
    const abs = join(dir, e.name);
    const isDir = e.isDirectory() || (e.isSymbolicLink() && statSync(abs).isDirectory());
    if (isDir) {
      const child = walk(abs, root, makePage);
      if (child) folders.push(child);
    } else if (/\.md$/i.test(e.name)) {
      const page = makePage(abs, relative(root, abs).split(sep).join("/"));
      if (LANDING_RE.test(e.name) && !node.landing) node.landing = page;
      else files.push({ type: /** @type {const} */ ("page"), page });
    }
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
// Markdown → HTML
// ---------------------------------------------------------------------------

/**
 * Converts GitHub-style blockquote alerts (> [!NOTE], > [!TIP], etc.) into semantic callout divs.
 *
 * @param {string} html - Raw HTML from marked.
 * @returns {string} HTML with callout divs substituted.
 */
function applyCallouts(html) {
  // marked renders > [!NOTE]\n> text as <blockquote><p>[!NOTE]\ntext</p></blockquote>
  return html.replace(
    /<blockquote>\s*<p>\[!(NOTE|TIP|WARNING|IMPORTANT|CAUTION)\]\n?([\s\S]*?)<\/blockquote>/gi,
    (_, type, inner) => {
      const label = type.charAt(0) + type.slice(1).toLowerCase();
      const body = inner.replace(/<\/p>\s*$/, "").trim();
      return `<div class="callout callout-${type.toLowerCase()}"><strong class="callout-label">${label}</strong><p>${body}</p></div>`;
    },
  );
}

/**
 * Creates a marked instance bound to a mutable per-page render context. Links to other .md files become hash routes, images become
 * data: URIs, headings get GitHub-style anchors, and code is highlighted at build time.
 *
 * @param {{ routeFor: (abs: string) => string|undefined, warn: (msg: string) => void }} site - Site-wide lookups.
 * @returns {{ marked: Marked, ctx: { file: string, route: string, slugs: Map<string, number>, mermaid: boolean } }} Instance.
 */
function createRenderer(site) {
  const ctx = { file: "", route: "", slugs: new Map(), mermaid: false };
  /** @type {Map<string, string>} */
  const imageCache = new Map();

  /**
   * Rewrites a link target. In-page anchors and relative .md links become hash routes; everything else is left alone.
   *
   * @param {string} href - Original href.
   * @returns {string} Rewritten href.
   */
  function rewriteHref(href) {
    if (!href) return href;
    if (href.startsWith("#")) return routeHref(ctx.route, decodeURIComponent(href.slice(1)));
    if (/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(href) || href.startsWith("/")) return href;
    const [path, anchor] = href.split("#");
    const abs = resolve(dirname(ctx.file), decodeURI(path));
    const route = site.routeFor(abs);
    if (route === undefined) {
      if (/\.md$/i.test(path)) {
        const why = existsSync(abs) ? "is outside the docs tree" : "is broken (file not found)";
        site.warn(`${relative(process.cwd(), ctx.file)}: link to ${href} ${why}`);
      }
      return href;
    }
    return routeHref(route, anchor && decodeURIComponent(anchor));
  }

  /**
   * Inlines a local, web-safe image as a base64 data: URI. Remote and unknown sources pass through.
   *
   * @param {string} src - Original src.
   * @returns {string} data: URI or original src.
   */
  function inlineImage(src) {
    if (!src || /^([a-z][a-z0-9+.-]*:|\/\/)/i.test(src)) return src;
    const abs = resolve(dirname(ctx.file), decodeURI(src.split(/[?#]/)[0]));
    if (imageCache.has(abs)) return imageCache.get(abs);
    const mime = IMAGE_MIME[extname(abs).toLowerCase()];
    if (!mime || !existsSync(abs)) {
      site.warn(`${relative(process.cwd(), ctx.file)}: image ${src} ${mime ? "not found" : "is not a web-safe type"}`);
      return src;
    }
    const uri = `data:${mime};base64,${readFileSync(abs).toString("base64")}`;
    imageCache.set(abs, uri);
    return uri;
  }

  const marked = new Marked({
    gfm: true,
    breaks: false,
    renderer: {
      /**
       * Renders a heading with a GitHub-style slug in data-anchor (ids would collide across pages in one document).
       *
       * @param {{ tokens: any[], depth: number }} token
       * @returns {string} HTML string.
       */
      heading({ tokens, depth }) {
        const inner = this.parser.parseInline(tokens);
        let slug = githubSlug(plainText(inner));
        const n = ctx.slugs.get(slug) ?? 0;
        ctx.slugs.set(slug, n + 1);
        if (n) slug = `${slug}-${n}`;
        const href = routeHref(ctx.route, slug);
        return `<h${depth} data-anchor="${esc(slug)}">${inner}<a class="anchor" href="${esc(href)}" aria-label="Link to this section">#</a></h${depth}>\n`;
      },

      /**
       * Renders a link, routing relative .md targets through the SPA and opening external links in a new tab.
       *
       * @param {{ href: string, title: string|null, tokens: any[] }} token
       * @returns {string} HTML string.
       */
      link({ href, title, tokens }) {
        const text = this.parser.parseInline(tokens);
        const target = rewriteHref(href);
        const external = /^https?:\/\//i.test(target);
        return `<a href="${esc(target)}"${title ? ` title="${esc(title)}"` : ""}${
          external ? ' target="_blank" rel="noopener"' : ""
        }>${text}</a>`;
      },

      /**
       * Renders an image with local sources inlined.
       *
       * @param {{ href: string, title: string|null, text: string }} token
       * @returns {string} HTML string.
       */
      image({ href, title, text }) {
        return `<img src="${esc(inlineImage(href))}" alt="${esc(text)}"${title ? ` title="${esc(title)}"` : ""}>`;
      },

      /**
       * Passes raw HTML through, inlining any local <img src> it contains.
       *
       * @param {{ text: string }} token
       * @returns {string} HTML string.
       */
      html({ text }) {
        return text.replace(/(<img\b[^>]*?\bsrc=)(["'])(.*?)\2/gi, (_, pre, q, src) => `${pre}${q}${inlineImage(src)}${q}`);
      },

      /**
       * Renders a fenced code block with highlight.js token colouring. Mermaid blocks are escaped and left for the client.
       *
       * @param {{ text: string, lang: string }} token
       * @returns {string} HTML string.
       */
      code({ text, lang }) {
        const language = (lang ?? "").split(/\s+/)[0].toLowerCase();
        if (language === "mermaid") {
          ctx.mermaid = true;
          return `<pre class="mermaid">${esc(text)}</pre>\n`;
        }
        const known = language && hljs.getLanguage(language);
        const body = known ? hljs.highlight(text, { language }).value : esc(text);
        const label = language ? `<span class="code-lang">${esc(language)}</span>` : "";
        return `<div class="code">${label}<button class="code-copy" type="button" aria-label="Copy code">Copy</button><pre><code class="hljs${
          known ? ` language-${language}` : ""
        }">${body}</code></pre></div>\n`;
      },
    },
  });

  return { marked, ctx };
}

/**
 * Removes the `## Table of Contents` heading and its following list from a token list.
 *
 * @param {any[]} tokens - marked tokens (mutated).
 * @returns {any[]|null} The TOC list token wrapped as a token list, or null when the page has no TOC.
 */
export function extractToc(tokens) {
  const i = tokens.findIndex((t) => t.type === "heading" && t.depth === 2 && TOC_RE.test(t.text));
  if (i < 0) return null;
  let j = i + 1;
  while (tokens[j]?.type === "space") j++;
  if (tokens[j]?.type !== "list") return null;
  const [list] = tokens.splice(i, j - i + 1).slice(-1);
  return Object.assign([list], { links: tokens.links });
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
 * Compiles a docs tree into a single self-contained HTML document.
 *
 * @param {string} rootArg - Path to the docs root.
 * @param {{ warn?: (msg: string) => void }} [options] - Options.
 * @returns {{ html: string, pages: Page[], version: string|null, warnings: string[] }} Build result.
 */
export function build(rootArg, options = {}) {
  const root = resolve(rootArg);
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new Error(`docs root not found: ${rootArg}`);
  const warnings = [];
  const warn = (/** @type {string} */ msg) => {
    if (warnings.includes(msg)) return;
    warnings.push(msg);
    options.warn?.(msg);
  };

  // Pass 1 — discover pages, lex them, derive titles and routes (needed before rendering for cross-page links)
  const lexer = new Marked({ gfm: true });
  const dates = gitDates(root);
  const tree = walk(root, root, (file, rel) => {
    const tokens = lexer.lexer(readFileSync(file, "utf8"));
    const h1 = tokens.find((t) => t.type === "heading" && t.depth === 1);
    const title = (h1 && plainText(lexer.parseInline(h1.text))) || prettify(basename(file));
    const updated = dates.get(file) ?? isoDate(statSync(file).mtime);
    return { file, rel, route: routeFromRel(rel), title, tokens, updated };
  });
  if (!tree) throw new Error(`no .md files found below ${rootArg}`);
  const pages = flatten(tree);

  /** @type {Map<string, string>} */
  const routeByFile = new Map(pages.map((p) => [p.file, p.route]));
  const routeFor = (/** @type {string} */ abs) =>
    routeByFile.get(abs) ?? routeByFile.get(join(abs, "README.md")) ?? routeByFile.get(join(abs, "index.md"));

  // Pass 2 — render each page
  const { marked, ctx } = createRenderer({ routeFor, warn });
  let anyMermaid = false;
  const rootName = basename(root);
  const articles = pages.map((p, i) => {
    Object.assign(ctx, { file: p.file, route: p.route, slugs: new Map(), mermaid: false });
    const tocTokens = extractToc(p.tokens);
    const body = applyCallouts(marked.parser(p.tokens));
    const toc = tocTokens ? marked.parser(tocTokens) : "";
    anyMermaid ||= ctx.mermaid;
    const prev = pages[i - 1];
    const next = pages[i + 1];
    const pager = [
      prev
        ? `<a class="pager-prev" href="${esc(routeHref(prev.route))}"><small>Previous</small>${esc(prev.title)}</a>`
        : "<span></span>",
      next
        ? `<a class="pager-next" href="${esc(routeHref(next.route))}"><small>Next</small>${esc(next.title)}</a>`
        : "<span></span>",
    ].join("");
    return `<article class="page${toc ? " has-toc" : ""}" data-route="${esc(p.route)}" data-path="${esc(`${rootName}/${p.rel}`)}" data-title="${esc(p.title)}" data-updated="${esc(p.updated)}" hidden>
  <div class="page-main">
    <div class="markdown">
${body}
    </div>
    <nav class="pager" aria-label="Pages">${pager}</nav>
  </div>${toc ? `\n  <aside class="page-toc" aria-label="On this page"><div class="toc-title">On this page</div>${toc}</aside>` : ""}
</article>`;
  });

  const pkg = findPackage(root);
  const html = buildHtml({
    siteName: pkg.name ?? prettify(rootName),
    version: pkg.version,
    nav: renderNav(tree),
    articles: articles.join("\n"),
    mermaid: anyMermaid,
  });
  return { html, pages, version: pkg.version, warnings };
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

/**
 * Builds the full HTML document string.
 *
 * @param {{ siteName: string, version: string|null, nav: string, articles: string, mermaid: boolean }} parts - Page parts.
 * @returns {string} Complete HTML document.
 */
function buildHtml({ siteName, version, nav, articles, mermaid }) {
  const css = readFileSync(resolve(__dirname, "docs0.css"), "utf8");
  const clientJs = readFileSync(resolve(__dirname, "docs0.client.js"), "utf8");
  // Theme-scoped highlight.js styles via native CSS nesting: :root[data-theme] raises specificity so the right one wins
  const hlCss = `:root[data-theme="light"] {\n${hljsStyle("github.min.css")}\n}\n:root[data-theme="dark"] {\n${hljsStyle("github-dark.min.css")}\n}`;
  const vendor = resolve(__dirname, "../vendor/mermaid.min.js");
  // Embedded offline fallback, only when some page uses mermaid. Neutralise any "</script" so the block cannot end early.
  const mermaidFallback =
    mermaid && existsSync(vendor)
      ? `\n  <script type="text/plain" id="docs0-mermaid">${readFileSync(vendor, "utf8").replace(/<\/script/gi, "<\\/script")}</script>`
      : "";
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
  <script type="application/json" id="docs0-config">${config}</script>${mermaidFallback}
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

/** Entry point when run as a command. */
function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || !opts.root) {
    console.error("Usage: docs0 <docs-root> [--out=docs.html] [--open=false]");
    process.exit(opts.help ? 0 : 1);
  }

  const started = performance.now();
  let result;
  try {
    result = build(opts.root, { warn: (msg) => console.warn(`docs0: warning: ${msg}`) });
  } catch (err) {
    console.error(`docs0: ${/** @type {Error} */ (err).message}`);
    process.exit(1);
  }

  const out = resolve(opts.out);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, result.html);

  const kb = (Buffer.byteLength(result.html) / 1024).toFixed(0);
  console.log(`\n📚  DOCS0 → ${out}`);
  console.log(
    `   ${result.pages.length} pages from ${resolve(opts.root)} · ${kb} KB · ${(performance.now() - started).toFixed(0)} ms\n`,
  );
  if (opts.open) openInBrowser(out);
}

// Run only when invoked directly (bin symlinks resolved), not when imported by tests
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
