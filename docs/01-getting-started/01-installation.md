# Installation <!-- omit in toc -->

## Table of Contents <!-- omit in toc -->

- [Installation](#installation)
  - [No install: npx](#no-install-npx)
  - [Global install](#global-install)
  - [Project dev dependency](#project-dev-dependency)
  - [Verifying](#verifying)

## No install: npx

The fastest route. `npx` downloads DOCS0 into a cache and runs it:

```bash
npx @tforster/docs0 ./docs
```

## Global install

```bash
npm install -g @tforster/docs0
docs0 ./docs
```

## Project dev dependency

Pin the version alongside your code so every contributor and CI run uses the same build:

```bash
npm install --save-dev @tforster/docs0
```

```json
{
  "scripts": {
    "docs": "docs0 docs",
    "docs:build": "docs0 docs --out=build/docs.html --open=false"
  }
}
```

## Verifying

```console
$ docs0 --help
Usage: docs0 <docs-root> [--out=file.html] [--open=false] [-w|--watch] [-v|--verbose] [--workers=N]
```

> [!NOTE]
> DOCS0 has exactly two runtime dependencies: [marked](https://marked.js.org) and
> [highlight.js](https://highlightjs.org). Mermaid is vendored for offline use.
