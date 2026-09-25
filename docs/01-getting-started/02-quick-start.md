# Quick Start <!-- omit in toc -->

## Table of Contents <!-- omit in toc -->

- [Quick Start](#quick-start)
  - [1. Create a docs folder](#1-create-a-docs-folder)
  - [2. Build and open](#2-build-and-open)
  - [3. Watch while you write](#3-watch-while-you-write)
  - [4. Build without opening](#4-build-without-opening)
  - [5. Check for broken links](#5-check-for-broken-links)
  - [6. Share it](#6-share-it)

## 1. Create a docs folder

```bash
mkdir -p docs/guides
cat > docs/README.md <<'MD'
# My Project

Welcome to the docs.
MD
cat > docs/guides/setup.md <<'MD'
# Setup

## Table of Contents <!-- omit in toc -->

- [Install](#install)

## Install

Run the installer.
MD
```

The resulting tree:

```text
docs/
├── README.md          → home page
└── guides/
    └── setup.md       → Guides › Setup
```

## 2. Build and open

```bash
npx @tforster/docs0 docs
```

DOCS0 writes the site to `<os temp>/docs0/<project>-<hash>/index.html` and opens it in your default browser. Your repo stays
clean, and re-running refreshes the same file.

## 3. Watch while you write

```bash
npx @tforster/docs0 docs --watch
```

DOCS0 builds and opens the site once, then keeps running. Each time you save a `.md` file or an image, it re-renders only the
affected pages (usually in tens of milliseconds) and rewrites the same file. Refresh the tab to see the change. Press Ctrl-C to
stop. See [Watch mode](../03-reference/01-cli.md#watch-mode).

## 4. Build without opening

Perfect for CI:

```bash
npx @tforster/docs0 docs --out=_site/index.html --open=false
```

> [!IMPORTANT]
> When the `CI` environment variable is set (as it is on GitHub Actions), DOCS0 skips opening a browser automatically.

## 5. Check for broken links

The build summary counts problems such as broken `.md` links and missing images:

```console
   13 pages from /home/me/project/docs · 3190 KB · 160 ms · 2 warnings (-v to list)
```

Add `-v` (or `--verbose`) to list each one with its file:

```bash
npx @tforster/docs0 docs -v
```

## 6. Share it

The output file is fully self-contained. Attach it to an email, drop it in Slack, or publish it —
see [Publishing to GitHub Pages](../02-guides/04-publishing.md).
