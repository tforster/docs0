// docs0.render.js — Markdown → HTML for a single page
//
// Pages render independently: a page needs only its own file plus the site's file → route map (for cross-page links), never
// another page's content or title. That lets docs0.js run renders inline or spread them over worker threads (docs0.worker.js),
// and cache each result until the page, an image it inlines, or a link target it resolves changes.

// System dependencies
import { readFileSync, statSync } from "fs";
import { resolve, dirname, extname, relative, join, basename } from "path";

// Third-party dependencies
import { Marked } from "marked";
import hljs from "highlight.js";

// Project dependencies
import { IMAGE_MIME, esc, plainText, githubSlug, prettify, routeHref } from "./docs0.shared.js";

const TOC_RE = /^table of contents\b/i;

/**
 * @typedef {object} PageResult
 * @property {string}   title    First H1, or prettified filename.
 * @property {string}   body     Rendered page HTML (TOC removed).
 * @property {string}   toc      Rendered TOC list for the sidebar, or "".
 * @property {boolean}  mermaid  Whether the page contains mermaid diagrams.
 * @property {string[]} warnings Broken links and missing images.
 * @property {string[]} images   Absolute paths of local images referenced (found or not).
 * @property {string[]} links    Absolute paths of relative link targets (resolved or not).
 */

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

/**
 * Creates a page renderer. Links to other .md files become hash routes, images become data: URIs, headings get GitHub-style
 * anchors, and code is highlighted at render time. Call setRoutes before rendering and again whenever files are added or removed.
 *
 * @returns {{ setRoutes: (routes: Array<[string, string]>) => void, render: (page: { file: string, route: string }) => PageResult }}
 *   Renderer.
 */
export function createPageRenderer() {
  /** @type {Map<string, string>} Absolute .md path → route. */
  let routes = new Map();
  const routeFor = (/** @type {string} */ abs) =>
    routes.get(abs) ?? routes.get(join(abs, "README.md")) ?? routes.get(join(abs, "index.md"));

  /** Per-page render state, reset by render(). */
  const ctx = {
    file: "",
    route: "",
    /** @type {Map<string, number>} */ slugs: new Map(),
    mermaid: false,
    /** @type {string[]} */ warnings: [],
    /** @type {Set<string>} */ images: new Set(),
    /** @type {Set<string>} */ links: new Set(),
  };

  /** @type {Map<string, { stamp: string, uri: string }>} Images shared by many pages are read once, until they change. */
  const imageCache = new Map();

  /**
   * Records a warning for the current page.
   *
   * @param {string} what - Problem description.
   */
  function warn(what) {
    const msg = `${relative(process.cwd(), ctx.file)}: ${what}`;
    if (!ctx.warnings.includes(msg)) ctx.warnings.push(msg);
  }

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
    ctx.links.add(abs);
    const route = routeFor(abs);
    if (route === undefined) {
      if (/\.md$/i.test(path)) {
        let exists = false;
        try {
          exists = statSync(abs).isFile();
        } catch {
          // Missing
        }
        warn(`link to ${href} ${exists ? "is outside the docs tree" : "is broken (file not found)"}`);
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
    ctx.images.add(abs);
    const mime = IMAGE_MIME[extname(abs).toLowerCase()];
    let st = null;
    try {
      st = statSync(abs);
    } catch {
      // Missing
    }
    if (!mime || !st?.isFile()) {
      warn(`image ${src} ${mime ? "not found" : "is not a web-safe type"}`);
      return src;
    }
    const stamp = `${st.mtimeMs}:${st.size}`;
    const cached = imageCache.get(abs);
    if (cached?.stamp === stamp) return cached.uri;
    const uri = `data:${mime};base64,${readFileSync(abs).toString("base64")}`;
    imageCache.set(abs, { stamp, uri });
    return uri;
  }

  // Plain instance for titles, so rendering an H1's inline text has no side effects on the page context
  const plain = new Marked({ gfm: true });
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

  return {
    setRoutes(entries) {
      routes = new Map(entries);
    },

    render({ file, route }) {
      Object.assign(ctx, { file, route, slugs: new Map(), mermaid: false, warnings: [], images: new Set(), links: new Set() });
      const tokens = marked.lexer(readFileSync(file, "utf8"));
      const h1 = tokens.find((t) => t.type === "heading" && t.depth === 1);
      const title = (h1 && plainText(plain.parseInline(h1.text))) || prettify(basename(file));
      const tocTokens = extractToc(tokens);
      const body = applyCallouts(marked.parser(tokens));
      const toc = tocTokens ? marked.parser(tocTokens) : "";
      return {
        title,
        body,
        toc,
        mermaid: ctx.mermaid,
        warnings: ctx.warnings,
        images: [...ctx.images],
        links: [...ctx.links],
      };
    },
  };
}
