# Routing <!-- omit in toc -->

## Table of Contents <!-- omit in toc -->

- [Routing](#routing)
  - [Hash format](#hash-format)
  - [Resolution rules](#resolution-rules)
  - [Why not real anchors](#why-not-real-anchors)

## Hash format

```text
#/<page-route>[/<heading-slug>]
```

| Hash                            | Page                       | Section      |
| :------------------------------ | :------------------------- | :----------- |
| `#/`                            | `README.md`                | top          |
| `#/guides/diagrams`             | `02-guides/03-diagrams.md` | top          |
| `#/guides/diagrams/gantt-chart` | `02-guides/03-diagrams.md` | Gantt chart  |
| `#/1-why-docs0`                 | `README.md`                | 1. Why DOCS0 |

Heading slugs follow GitHub's rules, so `## 1. Why DOCS0` becomes `1-why-docs0`.

## Resolution rules

1. If the whole path is a page route, show that page from the top.
2. Otherwise split off the last segment: the rest is the page, the segment is the heading slug.
3. Unknown routes fall back to the home page.

## Why not real anchors

All pages live in one document, so heading `id`s would collide (every page may have an "Overview"). Headings carry a
`data-anchor` attribute instead and the router scrolls to them.
