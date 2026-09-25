// docs0.test.js — unit and integration tests for the DOCS0 compiler (node:test, Node 20+)

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  utimesSync,
  unlinkSync,
  chmodSync,
} from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  build,
  githubSlug,
  routeFromRel,
  routeHref,
  parseArgs,
  prettify,
  folderLabel,
  defaultOut,
  findPackage,
  createBuilder,
  esc,
} from "../dist/docs0.js";
import { extractToc } from "../dist/docs0.render.js";

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), "../dist/docs0.js");
// 1×1 transparent PNG
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

/**
 * Writes a map of relative paths → contents below a directory.
 *
 * @param {string} dir - Base directory.
 * @param {Record<string, string|Buffer>} files - Files to create.
 */
function writeTree(dir, files) {
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
}

/**
 * Returns the <article> HTML for a route.
 *
 * @param {string} html - Built document.
 * @param {string} route - Page route.
 * @returns {string} Article HTML.
 */
function article(html, route) {
  const m = html.match(new RegExp(`<article[^>]*data-route="${route}"[^>]*>[\\s\\S]*?</article>`));
  assert.ok(m, `article for route "${route}" not found`);
  return m[0];
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("githubSlug", () => {
  it("matches GitHub's heading anchors", () => {
    assert.equal(githubSlug("1. Features"), "1-features");
    assert.equal(githubSlug("Does it state intent?"), "does-it-state-intent");
    assert.equal(githubSlug("  Hello, World!  "), "hello-world");
    assert.equal(githubSlug("snake_case & dashes-ok"), "snake_case--dashes-ok");
    assert.equal(githubSlug("Café Über"), "café-über");
  });
});

describe("routeFromRel", () => {
  it("strips .md, ordering prefixes and case", () => {
    assert.equal(routeFromRel("01-Guides/02-install.md"), "guides/install");
    assert.equal(routeFromRel("3.notes/10_api keys.md"), "notes/api-keys");
  });
  it("collapses README and index onto their folder", () => {
    assert.equal(routeFromRel("README.md"), "");
    assert.equal(routeFromRel("guides/readme.md"), "guides");
    assert.equal(routeFromRel("a/b/index.md"), "a/b");
  });
});

describe("routeHref", () => {
  it("builds hash routes with optional anchors", () => {
    assert.equal(routeHref(""), "#/");
    assert.equal(routeHref("", "intro"), "#/intro");
    assert.equal(routeHref("guides/install", "step-1"), "#/guides/install/step-1");
  });
});

describe("prettify", () => {
  it("turns file names into labels", () => {
    assert.equal(prettify("02-getting_started.md"), "Getting started");
    assert.equal(prettify("api"), "Api");
  });
});

describe("defaultOut", () => {
  it("is a stable index.html per project under <tmp>/docs0", () => {
    const a = defaultOut("/work/proj/docs", "@tforster/docs0", "/tmp");
    assert.match(a, /^\/tmp\/docs0\/tforster-docs0-[0-9a-f]{8}\/index\.html$/);
    assert.equal(defaultOut("/work/proj/docs", "@tforster/docs0", "/tmp"), a, "same root → same path");
    assert.notEqual(defaultOut("/work/other/docs", "@tforster/docs0", "/tmp"), a, "different root → different path");
    assert.match(defaultOut("/x", "!!!", "/tmp"), /\/docs-[0-9a-f]{8}\/index\.html$/);
  });
});

describe("folderLabel", () => {
  it("uses the folder name, borrowing casing from the landing title when it contains the name", () => {
    assert.equal(folderLabel("iam", "IAM — Explanation"), "IAM");
    assert.equal(folderLabel("domain-driven-design", "Domain-Driven Design — Explanation"), "Domain-Driven Design");
    assert.equal(folderLabel("adr", "Architecture Decision Records (ADR)"), "ADR");
    assert.equal(folderLabel("adr", "Architecture Decision Records (ADRs)"), "ADRs");
    assert.equal(folderLabel("01-getting-started", "Getting Started"), "Getting Started");
  });
  it("falls back to the prettified folder name", () => {
    assert.equal(folderLabel("ecommerce", "Explanation"), "Ecommerce");
    assert.equal(folderLabel("02-guides"), "Guides");
    assert.equal(folderLabel("ad", "Read me"), "Ad", "matches whole words only");
  });
});

describe("esc", () => {
  it("escapes HTML-significant characters", () => {
    assert.equal(esc(`<a href="x">&</a>`), "&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;");
  });
});

describe("parseArgs", () => {
  it("reads the root and defaults", () => {
    assert.deepEqual(parseArgs(["docs"], {}), {
      root: "docs",
      out: undefined,
      open: true,
      watch: false,
      verbose: false,
      workers: undefined,
      help: false,
    });
  });
  it("accepts open=false with or without dashes, and --no-open", () => {
    for (const flag of ["open=false", "--open=false", "--no-open", "open=0", "--open=no"]) {
      assert.equal(parseArgs(["docs", flag], {}).open, false, flag);
    }
  });
  it("accepts out with or without dashes", () => {
    assert.equal(parseArgs(["--out=_site/index.html", "docs"], {}).out, "_site/index.html");
    assert.equal(parseArgs(["docs", "out=x.html"], {}).out, "x.html");
  });
  it("does not open in CI unless forced", () => {
    assert.equal(parseArgs(["docs"], { CI: "true" }).open, false);
    assert.equal(parseArgs(["docs", "--open=true"], { CI: "true" }).open, true);
  });
  it("flags help", () => {
    assert.equal(parseArgs(["--help"], {}).help, true);
    assert.equal(parseArgs(["docs", "-v"], {}).verbose, true);
    assert.equal(parseArgs(["--verbose", "docs"], {}).verbose, true);
    assert.equal(parseArgs(["--verbose", "docs"], {}).root, "docs");
    assert.equal(parseArgs([], {}).root, undefined);
  });
  it("reads watch and workers", () => {
    assert.equal(parseArgs(["docs", "-w"], {}).watch, true);
    assert.equal(parseArgs(["--watch", "docs"], {}).watch, true);
    assert.equal(parseArgs(["docs", "--workers=4"], {}).workers, 4);
    assert.equal(parseArgs(["docs", "workers=0"], {}).workers, 0);
    assert.equal(parseArgs(["docs", "--workers=lots"], {}).workers, undefined);
  });
});

describe("extractToc", () => {
  it("removes the TOC heading and list and returns the list", async () => {
    const { Marked } = await import("marked");
    const tokens = new Marked().lexer("# T\n\n## Table of Contents <!-- omit in toc -->\n\n- [A](#a)\n\n## A\n\ntext\n");
    const toc = extractToc(tokens);
    assert.equal(toc.length, 1);
    assert.equal(toc[0].type, "list");
    assert.ok(!tokens.some((t) => t.type === "heading" && /Table of Contents/.test(t.text)));
    assert.ok(tokens.some((t) => t.type === "heading" && t.text === "A"));
  });
  it("returns null when absent or not followed by a list", async () => {
    const { Marked } = await import("marked");
    assert.equal(extractToc(new Marked().lexer("# T\n\n## A\n")), null);
    assert.equal(extractToc(new Marked().lexer("## Table of Contents\n\nparagraph\n")), null);
  });
});

// ---------------------------------------------------------------------------
// Build (integration)
// ---------------------------------------------------------------------------

describe("build", () => {
  let tmp;
  let root;
  let result;

  before(async () => {
    tmp = mkdtempSync(join(tmpdir(), "docs0-"));
    root = join(tmp, "project", "docs");
    writeTree(tmp, {
      "project/package.json": JSON.stringify({ name: "demo-project", version: "2.3.4" }),
      "project/docs/README.md": [
        "# Home Page <!-- omit in toc -->",
        "",
        "## Table of Contents <!-- omit in toc -->",
        "",
        "- [1. First](#1-first)",
        "- [Second](#second)",
        "",
        "## 1. First",
        "",
        "See [install](10-guides/02-install.md#step-1), [guides](10-guides/) and [elsewhere](../../outside.md).",
        "",
        "![pixel](img/pixel.png) ![remote](https://example.com/x.png) ![missing](img/nope.png)",
        "",
        '<img src="img/pixel.png" alt="raw">',
        "",
        "## Second",
        "",
        "> [!WARNING]",
        "> Careful now.",
        "",
        "## Second",
      ].join("\n"),
      "project/docs/img/pixel.png": PNG,
      "project/docs/2-alpha.md": "# Alpha\n\n```js\nconst x = 1 < 2;\n```\n\n```\n<b>raw</b>\n```\n",
      "project/docs/10-guides/README.md": "# Guides Overview\n",
      "project/docs/10-guides/02-install.md": "# Install\n\n## Step 1\n\n[top](#step-1) [home](../README.md)\n",
      "project/docs/10-guides/01-setup.md": "no heading here\n\n```mermaid\ngraph TD\n  A-->B\n```\n",
      "project/docs/.hidden/secret.md": "# Secret\n",
      "project/docs/node_modules/pkg/README.md": "# Dependency\n",
      "project/docs/empty/notes.txt": "not markdown",
      "project/docs/explain/README.md": "# Explanation\n",
      "project/docs/explain/shop/README.md": "# Explanation\n",
      "project/docs/explain/iam/README.md": "# IAM — Explanation\n",
      "project/docs/zeta.md": "# Zeta\n",
      "project/docs/explain/b-loose.md": "# B loose\n",
      "project/docs/explain/a-sub/page.md": "# Sub page\n",
    });
    result = await build(root);
  });

  after(() => rmSync(tmp, { recursive: true, force: true }));

  it("discovers pages in natural order, skipping hidden, node_modules and non-md", () => {
    assert.deepEqual(
      result.pages.map((p) => p.rel),
      [
        "README.md",
        // Loose files before folders at every level, each group in natural order
        "2-alpha.md",
        "zeta.md",
        "10-guides/README.md",
        "10-guides/01-setup.md",
        "10-guides/02-install.md",
        "explain/README.md",
        "explain/b-loose.md",
        "explain/a-sub/page.md",
        "explain/iam/README.md",
        "explain/shop/README.md",
      ],
    );
    assert.ok(!result.html.includes("Secret"));
    assert.ok(!result.html.includes("Dependency"));
  });

  it("derives titles from H1 or filename", () => {
    assert.deepEqual(
      result.pages.map((p) => p.title),
      [
        "Home Page",
        "Alpha",
        "Zeta",
        "Guides Overview",
        "Setup",
        "Install",
        "Explanation",
        "B loose",
        "Sub page",
        "IAM — Explanation",
        "Explanation",
      ],
    );
  });

  it("renders a hierarchical nav with folder landing pages", () => {
    const nav = result.html.match(/<nav id="nav"[\s\S]*?<\/nav>/)[0];
    assert.match(nav, /<summary><a class="nav-link" href="#\/guides" data-route="guides">Guides<\/a><\/summary>/);
    assert.match(nav, /<details open><summary>[\s\S]*<ul class="nav-list"><li><a[^>]*data-route="guides\/setup">Setup<\/a>/);
    assert.ok(nav.indexOf('data-route=""') < nav.indexOf('data-route="alpha"'));
    assert.ok(!nav.includes("Empty"), "folders without markdown are omitted");
    // Sibling READMEs sharing a title (Diátaxis style) stay distinguishable
    assert.match(nav, /data-route="explain\/iam">IAM<\/a>/);
    assert.match(nav, /data-route="explain\/shop">Shop<\/a>/);
  });

  it("moves the TOC to a sidebar and out of the body", () => {
    const home = article(result.html, "");
    assert.match(home, /class="page has-toc"/);
    const [body, toc] = home.split('<aside class="page-toc"');
    assert.ok(!/Table of Contents/.test(body));
    assert.match(toc, /href="#\/1-first">1\. First<\/a>/);
    assert.match(toc, /href="#\/second">Second<\/a>/);
    assert.ok(!article(result.html, "alpha").includes("page-toc"), "pages without TOC get no sidebar");
  });

  it("gives headings GitHub slugs, de-duplicated per page", () => {
    const home = article(result.html, "");
    assert.match(home, /<h2 data-anchor="1-first">/);
    assert.match(home, /<h2 data-anchor="second">/);
    assert.match(home, /<h2 data-anchor="second-1">/);
    assert.match(article(result.html, "guides/install"), /<h2 data-anchor="step-1">/);
  });

  it("rewrites relative .md links and anchors to hash routes", () => {
    const home = article(result.html, "");
    assert.match(home, /href="#\/guides\/install\/step-1"/);
    assert.match(home, /href="#\/guides">guides/);
    assert.match(home, /href="\.\.\/\.\.\/outside\.md"/, "links outside the tree are left alone");
    const install = article(result.html, "guides/install");
    assert.match(install, /href="#\/guides\/install\/step-1">top/);
    assert.match(install, /href="#\/">home/);
    assert.ok(result.warnings.some((w) => w.includes("outside.md is broken")));
  });

  it("inlines local images as data URIs and leaves remote ones", () => {
    const home = article(result.html, "");
    const uri = `data:image/png;base64,${PNG.toString("base64")}`;
    assert.ok(home.includes(`<img src="${uri}" alt="pixel">`));
    assert.ok(home.includes(`<img src="${uri}" alt="raw">`), "raw HTML <img> is inlined too");
    assert.match(home, /<img src="https:\/\/example\.com\/x\.png"/);
    assert.ok(result.warnings.some((w) => w.includes("img/nope.png")));
  });

  it("highlights code and escapes unknown languages", () => {
    const alpha = article(result.html, "alpha");
    assert.match(alpha, /<code class="hljs language-js"><span class="hljs-keyword">const<\/span>/);
    assert.match(alpha, /&lt;b&gt;raw&lt;\/b&gt;/);
  });

  it("renders callouts", () => {
    assert.match(article(result.html, ""), /<div class="callout callout-warning"><strong class="callout-label">Warning<\/strong>/);
  });

  it("leaves mermaid for the client and embeds the fallback runtime", () => {
    assert.match(article(result.html, "guides/setup"), /<pre class="mermaid">graph TD\n {2}A--&gt;B<\/pre>/);
    assert.match(result.html, /<script type="text\/plain" id="docs0-mermaid">/);
    assert.ok(!/<\/script/i.test(result.html.match(/id="docs0-mermaid">([\s\S]*?)<\/script>/)[1]));
  });

  it("shows the version from the closest package.json", () => {
    assert.equal(result.version, "2.3.4");
    assert.match(result.html, /<span id="version"[^>]*>v2\.3\.4<\/span>/);
    assert.match(result.html, /<title>demo-project<\/title>/);
  });

  it("is self-contained: CSS and JS inlined, no external stylesheets or scripts", () => {
    assert.ok(!/<link\b/i.test(result.html));
    assert.ok(!/<script[^>]+\bsrc=/i.test(result.html));
    assert.match(result.html, /<style>[\s\S]*\.hljs[\s\S]*<\/style>/);
    assert.match(result.html, /:root\[data-theme="dark"\] \{/);
  });

  it("renders identically on worker threads", async () => {
    const pooled = await build(root, { workers: 2 });
    assert.equal(pooled.html, result.html);
    assert.deepEqual([...pooled.warnings].sort(), [...result.warnings].sort());
  });

  it("omits the mermaid runtime when no page uses it", async () => {
    const dir = join(tmp, "plain");
    writeTree(dir, { "README.md": "# Plain\n" });
    const plain = await build(dir);
    assert.ok(!plain.html.includes('id="docs0-mermaid"'));
    assert.ok(Buffer.byteLength(plain.html) < 200_000);
  });

  it("rejects on a missing root or empty tree", async () => {
    await assert.rejects(build(join(tmp, "nope")), /docs root not found/);
    mkdirSync(join(tmp, "empty-root"));
    await assert.rejects(build(join(tmp, "empty-root")), /no \.md files/);
  });
});

describe("findPackage", () => {
  it("skips version-less package.json files and walks up", () => {
    const dir = mkdtempSync(join(tmpdir(), "docs0-pkg-"));
    writeTree(dir, {
      "package.json": JSON.stringify({ name: "outer", version: "9.9.9" }),
      "inner/package.json": "{}",
      "inner/docs/README.md": "# x\n",
    });
    assert.deepEqual(findPackage(join(dir, "inner", "docs")), { name: "outer", version: "9.9.9" });
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("last updated dates", () => {
  it("uses the file's modified time", async () => {
    const dir = mkdtempSync(join(tmpdir(), "docs0-mtime-"));
    writeTree(dir, { "README.md": "# Home\n" });
    utimesSync(join(dir, "README.md"), new Date(2024, 1, 29, 12), new Date(2024, 1, 29, 12));
    const res = await build(dir);
    assert.equal(res.pages[0].updated, "2024-02-29");
    assert.match(res.html, /data-updated="2024-02-29"/);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("top bar", () => {
  it("has the updated date slot and a zen toggle next to the theme toggle", async () => {
    const dir = mkdtempSync(join(tmpdir(), "docs0-bar-"));
    writeTree(dir, { "README.md": "# Home\n" });
    const { html } = await build(dir);
    assert.match(html, /<code id="current-path"><\/code>\s*<time id="updated"/);
    assert.match(html, /<button id="zen-toggle"[\s\S]*?<\/button>\s*<button id="theme-toggle"/);
    assert.match(html, /<header id="topbar">\s*<button id="nav-toggle"[^>]*aria-expanded="true"/);
    assert.match(html, /localStorage\.getItem\("docs0-nav"\) === "collapsed"/, "collapsed nav restored before first paint");
    rmSync(dir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// Incremental builds (the engine behind --watch)
// ---------------------------------------------------------------------------

/**
 * Rewrites a file with a new modified time, so the change is seen even when the size stays the same.
 *
 * @param {string} file - Path.
 * @param {string|Buffer} body - Contents.
 */
function touch(file, body) {
  writeFileSync(file, body);
  const t = new Date(Date.now() + Math.floor(Math.random() * 1e6));
  utimesSync(file, t, t);
}

for (const workers of [0, 2]) {
  describe(`createBuilder (${workers ? "worker pool" : "inline"})`, () => {
    let dir;
    let builder;
    before(() => {
      dir = mkdtempSync(join(tmpdir(), "docs0-inc-"));
      writeTree(dir, {
        "README.md": "# Home\n\n[soon](later.md) ![pic](pixel.png)\n",
        "a.md": "# A\n",
        "b.md": "# B\n\n[a](a.md)\n",
        "pixel.png": PNG,
      });
      builder = createBuilder(dir, { workers });
    });
    after(async () => {
      await builder.close();
      rmSync(dir, { recursive: true, force: true });
    });

    it("renders everything first, then nothing when unchanged", async () => {
      const first = await builder.build();
      assert.equal(first.rendered, 3);
      assert.equal(first.changed, true);
      assert.ok(first.warnings.some((w) => w.includes("later.md is broken")));
      const again = await builder.build();
      assert.equal(again.rendered, 0);
      assert.equal(again.changed, false);
      assert.equal(again.html, first.html);
    });

    it("re-renders only an edited page, updating nav and neighbours' pager", async () => {
      touch(join(dir, "a.md"), "# A renamed\n");
      const r = await builder.build();
      assert.equal(r.rendered, 1);
      assert.match(r.html, /data-route="a">A renamed<\/a>/, "nav");
      assert.match(article(r.html, "b"), /<small>Previous<\/small>A renamed/, "neighbour's pager");
    });

    it("re-renders pages linking to an added page, and to a removed one", async () => {
      touch(join(dir, "later.md"), "# Later\n");
      let r = await builder.build();
      assert.equal(r.rendered, 2, "the new page and README, which links to it");
      assert.match(article(r.html, ""), /href="#\/later"/);
      assert.ok(!r.warnings.some((w) => w.includes("later.md")));
      unlinkSync(join(dir, "later.md"));
      r = await builder.build();
      assert.equal(r.rendered, 1);
      assert.equal(r.removed, 1);
      assert.ok(r.warnings.some((w) => w.includes("later.md is broken")));
    });

    it("re-renders pages that inline a changed image", async () => {
      const other = Buffer.from(PNG);
      other[other.length - 5] ^= 1;
      touch(join(dir, "pixel.png"), other);
      const r = await builder.build();
      assert.equal(r.rendered, 1);
      assert.ok(article(r.html, "").includes(other.toString("base64")));
    });

    it(
      "rejects when a page cannot be read, then recovers",
      { skip: process.getuid?.() === 0 && "root ignores permissions" },
      async () => {
        const b = join(dir, "b.md");
        touch(b, "# B locked\n");
        chmodSync(b, 0o000);
        await assert.rejects(builder.build(), /EACCES|permission/i);
        chmodSync(b, 0o644);
        const r = await builder.build();
        assert.equal(r.rendered, 1);
        assert.match(r.html, /B locked/);
      },
    );
  });
}

// ---------------------------------------------------------------------------
// CLI (end to end)
// ---------------------------------------------------------------------------

describe("CLI", () => {
  it("writes the output file and does not open with open=false", () => {
    const dir = mkdtempSync(join(tmpdir(), "docs0-cli-"));
    writeTree(dir, { "docs/README.md": "# Hi\n" });
    const out = join(dir, "site", "index.html");
    const stdout = execFileSync(process.execPath, [CLI, join(dir, "docs"), `--out=${out}`, "open=false"], { encoding: "utf8" });
    assert.match(stdout, /DOCS0 →/);
    assert.ok(existsSync(out));
    assert.match(readFileSync(out, "utf8"), /<h1 data-anchor="hi">Hi/);
    rmSync(dir, { recursive: true, force: true });
  });

  it("defaults to the OS temp folder and reports file/dir to GITHUB_OUTPUT", () => {
    const dir = mkdtempSync(join(tmpdir(), "docs0-cli-tmp-"));
    writeTree(dir, { "docs/README.md": "# Hi\n", "gh-output": "" });
    const env = {
      ...process.env,
      TMPDIR: join(dir, "t"),
      TEMP: join(dir, "t"),
      TMP: join(dir, "t"),
      GITHUB_OUTPUT: join(dir, "gh-output"),
    };
    mkdirSync(env.TMPDIR);
    execFileSync(process.execPath, [CLI, join(dir, "docs"), "--open=false"], { env, encoding: "utf8" });
    const vars = Object.fromEntries(
      readFileSync(env.GITHUB_OUTPUT, "utf8")
        .trim()
        .split("\n")
        .map((l) => l.split("=")),
    );
    assert.equal(vars.file, join(vars.dir, "index.html"));
    assert.ok(vars.dir.startsWith(join(env.TMPDIR, "docs0")));
    assert.ok(existsSync(vars.file));
    rmSync(dir, { recursive: true, force: true });
  });

  it("exits 1 with usage when the root is missing", () => {
    assert.throws(
      () => execFileSync(process.execPath, [CLI], { stdio: "pipe" }),
      (/** @type {any} */ err) => err.status === 1 && /Usage: docs0/.test(err.stderr.toString()),
    );
  });

  it("lists warnings only with --verbose, otherwise counts them in the summary", () => {
    const dir = mkdtempSync(join(tmpdir(), "docs0-cli-v-"));
    writeTree(dir, { "docs/README.md": "# Hi\n\n[a](nope.md) [b](gone.md)\n" });
    const args = [CLI, join(dir, "docs"), `--out=${join(dir, "o.html")}`, "--open=false"];
    const quiet = spawnSync(process.execPath, args, { encoding: "utf8" });
    assert.equal(quiet.status, 0);
    assert.equal(quiet.stderr, "");
    assert.match(quiet.stdout, /· 2 warnings \(-v to list\)/);
    const loud = spawnSync(process.execPath, [...args, "-v"], { encoding: "utf8" });
    assert.equal(loud.stderr.match(/docs0: warning:/g)?.length, 2);
    assert.doesNotMatch(loud.stdout, /-v to list/);
    rmSync(dir, { recursive: true, force: true });
  });

  it("--watch rebuilds once per burst of saves and stops cleanly on SIGINT", async () => {
    const dir = mkdtempSync(join(tmpdir(), "docs0-watch-"));
    writeTree(dir, { "docs/README.md": "# Hi\n", "docs/a.md": "# A\n" });
    const out = join(dir, "o.html");
    const child = spawn(process.execPath, [CLI, join(dir, "docs"), `--out=${out}`, "--open=false", "--watch"]);
    let stdout = "";
    child.stdout.on("data", (d) => (stdout += d));
    const until = async (/** @type {() => boolean} */ ok, what) => {
      const start = Date.now();
      while (!ok()) {
        if (Date.now() - start > 5000) assert.fail(`timed out waiting for ${what}\n${stdout}`);
        await new Promise((r) => setTimeout(r, 20));
      }
    };
    await until(() => stdout.includes("Watching"), "initial build");
    for (let i = 0; i < 10; i++) writeFileSync(join(dir, "docs", "a.md"), `# A ${i}\n`);
    await until(() => stdout.includes("↻"), "rebuild");
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(stdout.match(/↻/g).length, 1, "one rebuild for the burst");
    assert.match(stdout, /1 page re-rendered/);
    assert.match(readFileSync(out, "utf8"), /A 9/);
    writeFileSync(join(dir, "docs", "notes.txt"), "not markdown");
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(stdout.match(/↻/g).length, 1, "unrelated files cause no rebuild");
    const code = await new Promise((r) => {
      child.on("exit", r);
      child.kill("SIGINT");
    });
    assert.equal(code, 0);
    rmSync(dir, { recursive: true, force: true });
  });

  it("builds this repo's docs without warnings", () => {
    const out = join(mkdtempSync(join(tmpdir(), "docs0-self-")), "docs.html");
    const res = spawnSync(process.execPath, [CLI, resolve(dirname(CLI), "../docs"), `--out=${out}`, "--open=false", "-v"], {
      encoding: "utf8",
    });
    assert.equal(res.status, 0);
    assert.equal(res.stderr, "");
    assert.match(res.stdout, /pages from/);
    assert.ok(existsSync(out));
  });
});
