# DOCS0 <!-- omit in toc -->

DOCS0 turns a folder of Markdown into a documentation viewer delivered as **one self-contained HTML file**. Point it at a
folder and run one command. No build step, no config file, no framework.

**See it live**: [tforster.github.io/docs0](https://tforster.github.io/docs0/) is this repo's own `docs/` folder, built by
DOCS0 itself (dogfooding).

**Try it out**: from any repo that has a `docs/` folder:

```bash
npx @tforster/docs0 docs
```

Nothing is written into your repo. The HTML goes to your OS temp folder and opens in your browser, so you can view the docs you
already have mid dev session without creating a copy of them.

## Table of Contents <!-- omit in toc -->

- [1. Features](#1-features)
- [2. Usage](#2-usage)
- [3. Writing Docs](#3-writing-docs)
- [4. Publishing to GitHub Pages](#4-publishing-to-github-pages)
- [5. Development](#5-development)
- [6. Policies and Procedures](#6-policies-and-procedures)
- [7. Author](#7-author)

## 1. Features

- **One command**: `npx @tforster/docs0 docs` builds the site into your OS temp folder and opens it
- **One file**: CSS, JS and images (as `data:` URIs) are embedded, plus an offline Mermaid fallback. Share it anywhere
- **Folder → nav**: the folder hierarchy becomes a collapsible left nav, and numeric prefixes (`01-`) set the order
- **Sticky in-page TOC**: a `## Table of Contents <!-- omit in toc -->` list becomes a right sidebar with scroll-spy
- **Top bar**: DOCS0 branding, the current file path and its last-updated date (the file's modified time), the version from the closest `package.json`, a zen mode toggle and a theme toggle
- **Watch mode**: `--watch` rebuilds on save, re-rendering only the pages a change affects (typically ~30 ms); refresh the tab to see it
- **Zen mode**: hides both sidebars so the content fills the full width, and your choice is remembered
- **Light and dark**: follows the system setting by default, and your choice is remembered
- **Syntax highlighting**: 190+ languages via [highlight.js](https://github.com/highlightjs/highlight.js), done at build time
- **Mermaid diagrams**: loaded from the CDN, with an embedded fallback when offline, and re-themed live
- **GFM**: tables, task lists, callouts (`> [!NOTE]` …), inline HTML
- **GitHub-compatible links**: relative `.md` links and `#anchors` work the same here as on GitHub.com
- **Two dependencies**: [marked](https://marked.js.org) and highlight.js

## 2. Usage

```bash
docs0 <docs-root> [--out=file.html] [--open=false] [-w|--watch] [-v|--verbose] [--workers=N]
```

| Flag                          | Default     | Description                                    |
| :---------------------------- | :---------- | :--------------------------------------------- |
| `--out=<file>` / `out=<file>` | temp folder | Output path; folders are created ¹             |
| `--open=false` / `open=false` | `true`      | Don't open the browser (implied when `CI` set) |
| `-w` / `--watch`              | `false`     | Rebuild on changes until Ctrl-C                |
| `-v` / `--verbose`            | `false`     | List warnings (broken links, missing images)   |
| `--workers=<n>`               | auto        | Render threads; `0` renders on the main thread |

¹ By default: `<os temp>/docs0/<project>-<hash>/index.html`. The path is stable per docs folder, so re-running refreshes the
same file and an open tab only needs a reload. Inside GitHub Actions the `file` and `dir` locations are also written to
`GITHUB_OUTPUT`.

## 3. Writing Docs

```text
docs/
├── README.md               → home page
├── 01-getting-started/
│   ├── README.md           → folder landing page
│   └── 01-installation.md  → #/getting-started/installation
└── assets/logo.svg         → inlined wherever referenced
```

See [docs/02-guides/01-writing-docs.md](docs/02-guides/01-writing-docs.md) for the conventions. For a tour of every supported
element, see the [Markdown Showcase](docs/02-guides/02-markdown-showcase.md).

## 4. Publishing to GitHub Pages

[.github/workflows/docs.yml](.github/workflows/docs.yml) builds this repo's `docs/` and deploys it. Set
**Settings → Pages → Source** to **GitHub Actions**. For your own repo use:

```yaml
- id: docs
  run: npx --yes @tforster/docs0 docs
- uses: actions/upload-pages-artifact@v3
  with:
    path: ${{ steps.docs.outputs.dir }}
```

## 5. Development

```bash
npm install
npm start        # build ./docs into the temp folder and open it (dogfooding)
npm test         # node:test suite
npm run lint     # oxlint
npm run format   # oxfmt
```

| File                    | Role                                                    |
| :---------------------- | :------------------------------------------------------ |
| `dist/docs0.js`         | CLI and build (walk → lex → render → assemble)          |
| `dist/docs0.client.js`  | In-browser router, scroll-spy, theme, mermaid (inlined) |
| `dist/docs0.css`        | Reader styles (inlined)                                 |
| `vendor/mermaid.min.js` | Offline mermaid fallback (embedded only when needed)    |

## 6. Policies and Procedures

- [CONTRIBUTING.md](CONTRIBUTING.md) covers our code of conduct and how to submit pull requests.
- [Code of Conduct](./CODE_OF_CONDUCT.md) describes how we keep this an open and welcoming environment.
- [LICENSE](./LICENSE.md) sets out the legal terms for using and distributing this project.

## 7. Author

Troy Forster
<https://www.tforster.com>
