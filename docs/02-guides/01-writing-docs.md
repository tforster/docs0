# Writing Docs <!-- omit in toc -->

DOCS0 has no config file. Everything is driven by conventions in your folder and files.

## Table of Contents <!-- omit in toc -->

- [Folder structure becomes navigation](#folder-structure-becomes-navigation)
  - [Ordering with numeric prefixes](#ordering-with-numeric-prefixes)
  - [Landing pages](#landing-pages)
  - [Page titles](#page-titles)
- [Tables of contents become the sidebar](#tables-of-contents-become-the-sidebar)
- [Linking between pages](#linking-between-pages)
- [What gets ignored](#what-gets-ignored)

## Folder structure becomes navigation

The folder tree below your docs root _is_ the left nav:

```text
docs/
├── README.md                    # Home
├── 01-getting-started/
│   ├── README.md                # landing page; folder shows as "Getting Started"
│   ├── 01-installation.md
│   └── 02-quick-start.md
├── 02-guides/                   # no README → label derived from folder name: "Guides"
│   └── 01-writing-docs.md
└── assets/                      # no .md files → not shown in nav
    └── banner.png
```

### Ordering with numeric prefixes

In every folder the landing page comes first, then loose files, then sub-folders. Each group sorts by name using natural
(numeric) ordering, so `2-` comes before `10-`. Prefixes such as `01-`, `02_` or `3.` are
stripped from labels **and** from URLs: `02-guides/01-writing-docs.md` is served at `#/guides/writing-docs`.

### Landing pages

A `README.md` (or `index.md`) inside a folder becomes that folder's landing page. Clicking the folder name opens it.
The `README.md` at the docs root is the home page.

Folder labels come from the **folder name**, not the README title — READMEs often share a title (think several
`# Explanation` pages in a [Diátaxis](https://diataxis.fr) tree) while folder names are unique. When the README title contains
the folder name, its casing is kept: `iam/` with `# IAM — Explanation` shows as **IAM**.

### Page titles

The first `#` heading is the page title shown in the nav. Files without one fall back to a tidied filename:
`03-api_keys.md` → **Api keys**.

## Tables of contents become the sidebar

Add a list under this exact heading:

```markdown
## Table of Contents <!-- omit in toc -->

- [Install](#install)
  - [From npm](#from-npm)
- [Configure](#configure)
```

DOCS0 removes it from the page body and renders it as the sticky **On this page** sidebar, highlighting the section you are
reading. The `<!-- omit in toc -->` comment keeps tools like _Markdown All in One_ from listing the TOC heading in itself.

> [!TIP]
> Anchors follow GitHub's slug rules, so the same TOC works on GitHub.com and in DOCS0.

## Linking between pages

Use ordinary relative links — the same ones that work on GitHub:

| You write                                        | DOCS0 routes to               |
| :----------------------------------------------- | :---------------------------- |
| `[Diagrams](03-diagrams.md)`                     | `#/guides/diagrams`           |
| `[CLI flags](../03-reference/01-cli.md#flags)`   | `#/reference/cli/flags`       |
| `[Up top](#folder-structure-becomes-navigation)` | a section of the current page |
| `[Getting Started](../01-getting-started/)`      | that folder's landing page    |

Try one: jump to the [flags section of the CLI reference](../03-reference/01-cli.md#flags).

## What gets ignored

- Files and folders starting with `.`
- `node_modules`
- Folders that contain no `.md` files (they can still hold images)
