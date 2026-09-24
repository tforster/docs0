# Markdown Showcase <!-- omit in toc -->

A tour of the GitHub Flavored Markdown (GFM) that DOCS0 renders. View this file's source next to the rendered page to see how
each element is written.

## Table of Contents <!-- omit in toc -->

- [Text formatting](#text-formatting)
- [Lists](#lists)
  - [Task lists](#task-lists)
- [Callouts](#callouts)
- [Code](#code)
  - [JavaScript](#javascript)
  - [Python](#python)
  - [Shell and config](#shell-and-config)
  - [Diffs](#diffs)
- [Tables](#tables)
- [Images](#images)
- [Block quotes](#block-quotes)
- [Raw HTML](#raw-html)

## Text formatting

You can write **bold**, _italic_, _**both**_, ~~strikethrough~~ and `inline code`. Autolinks such as https://github.com work,
as do [inline links](https://marked.js.org "marked") and reference-style links like [highlight.js][hljs].

Press <kbd>Ctrl</kbd> + <kbd>K</kbd> to <mark>highlight</mark> things with inline HTML.

[hljs]: https://highlightjs.org

## Lists

1. Ordered lists
2. Keep their numbering
   - and nest
   - unordered items
     1. to any depth
3. Back to the top level

- Unordered item
- Another item with a longer line of text that wraps naturally when the viewport is narrow, demonstrating comfortable line
  length and spacing for reading.

### Task lists

- [x] Walk the docs tree
- [x] Render Markdown with marked
- [x] Inline images as data URIs
- [ ] Full-text search (coming soon)

## Callouts

> [!NOTE]
> Useful information that users should know, even when skimming.

> [!TIP]
> Helpful advice for doing things better or more easily.

> [!IMPORTANT]
> Key information users need to know to achieve their goal.

> [!WARNING]
> Urgent info that needs immediate user attention to avoid problems.

> [!CAUTION]
> Advises about risks or negative outcomes of certain actions.

## Code

Code blocks are highlighted at build time, so there is no highlighting JavaScript in the output. Hover a block to copy it.

### JavaScript

```javascript
/**
 * Resolves a hash route into a page and optional section.
 * @param {string} hash - e.g. "#/guides/diagrams/flowcharts"
 */
export function resolve(hash, routes) {
  const path = decodeURIComponent(hash).replace(/^#\/?/, "");
  if (routes.has(path)) return { page: path, anchor: "" };
  const i = path.lastIndexOf("/");
  return { page: path.slice(0, i), anchor: path.slice(i + 1) };
}
```

### Python

```python
from pathlib import Path

def pages(root: Path) -> list[Path]:
    """Every markdown file below root, in natural order."""
    return sorted(p for p in root.rglob("*.md") if not p.name.startswith("."))

if __name__ == "__main__":
    for page in pages(Path("docs")):
        print(f"{page.relative_to('docs')}")
```

### Shell and config

```bash
#!/usr/bin/env bash
set -euo pipefail
npx @tforster/docs0 docs --out="build/docs.html" --open=false
echo "Built $(du -h build/docs.html | cut -f1) of docs"
```

```yaml
# .github/workflows/docs.yml (excerpt)
on:
  push:
    branches: [main]
    paths: ["docs/**"]
```

```css
:root[data-theme="dark"] {
  --bg: #0d1117;
  --accent: #58a6ff;
}
```

### Diffs

```diff
- const html = marked.parse(md);
+ const html = applyCallouts(marked.parser(tokens));
```

Unknown or missing languages render as plain, escaped text:

```
No language specified — <b>tags</b> are shown literally.
```

## Tables

| Feature    | Status |                       Notes |
| :--------- | :----: | --------------------------: |
| Left nav   |   ✅   |       Mirrors folder layout |
| Sticky TOC |   ✅   | From `## Table of Contents` |
| Mermaid    |   ✅   |  CDN with embedded fallback |
| Search     |   🚧   |                     Planned |

Columns honour `:---` (left), `:---:` (centre) and `---:` (right) alignment.

## Images

Local images are embedded as `data:` URIs so the output stays a single file. Both SVG and raster formats work:

![DOCS0 logo](../assets/logo.svg "The DOCS0 logo")

Remote images are left as links and load normally when online:

![Markdown mark](https://upload.wikimedia.org/wikipedia/commons/4/48/Markdown-mark.svg)

## Block quotes

> Documentation is a love letter that you write to your future self.
>
> — Damian Conway

## Raw HTML

Inline HTML is passed through, which gives you collapsible sections for free:

<details>
<summary>Click to expand</summary>

Hidden content can contain **Markdown** too, as long as it is separated from the tags by blank lines.

</details>

<p align="center"><img src="../assets/logo.svg" width="48" alt="Small logo via raw HTML"></p>
