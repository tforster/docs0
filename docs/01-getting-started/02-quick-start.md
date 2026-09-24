# Quick Start <!-- omit in toc -->

## Table of Contents <!-- omit in toc -->

- [Quick Start](#quick-start)
  - [1. Create a docs folder](#1-create-a-docs-folder)
  - [2. Build and open](#2-build-and-open)
  - [3. Build without opening](#3-build-without-opening)
  - [4. Share it](#4-share-it)

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

DOCS0 writes `docs.html` to the current directory and opens it in your default browser.

## 3. Build without opening

Perfect for CI:

```bash
npx @tforster/docs0 docs --out=_site/index.html --open=false
```

> [!IMPORTANT]
> When the `CI` environment variable is set (as it is on GitHub Actions), DOCS0 skips opening a browser automatically.

## 4. Share it

`docs.html` is fully self-contained. Attach it to an email, drop it in Slack, or publish it —
see [Publishing to GitHub Pages](../02-guides/04-publishing.md).
