// docs0.shared.js — dependency-free helpers used by both the main thread (docs0.js) and render threads (docs0.render.js)

/** @type {Record<string, string>} Web-safe image types that get inlined as data: URIs. */
export const IMAGE_MIME = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
};

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
export function plainText(html) {
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
export function stripOrder(name) {
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
 * Builds a hash href for a route and optional in-page anchor.
 *
 * @param {string} route - Page route.
 * @param {string} [anchor] - Heading slug.
 * @returns {string} Hash href.
 */
export function routeHref(route, anchor) {
  return "#/" + [route, anchor].filter(Boolean).join("/");
}
