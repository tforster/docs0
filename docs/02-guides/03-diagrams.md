# Diagrams <!-- omit in toc -->

Fenced code blocks tagged `mermaid` are rendered as diagrams. They follow the light/dark theme and re-render when you toggle it.

## Table of Contents <!-- omit in toc -->

- [Flowchart](#flowchart)
- [Sequence diagram](#sequence-diagram)
- [Class diagram](#class-diagram)
- [State diagram](#state-diagram)
- [Entity relationship](#entity-relationship)
- [Gantt chart](#gantt-chart)
- [Pie chart](#pie-chart)
- [Git graph](#git-graph)
- [How loading works](#how-loading-works)

## Flowchart

````markdown
```mermaid
flowchart TD
  Start([docs0 docs]) --> Walk[Walk tree]
```
````

```mermaid
flowchart TD
  Start([docs0 docs]) --> Walk[Walk tree]
  Walk --> Lex[Lex each .md]
  Lex --> Titles[Derive titles & routes]
  Titles --> Render[Render pages]
  Render --> Mermaid{Any mermaid?}
  Mermaid -->|yes| Embed[Embed fallback runtime]
  Mermaid -->|no| Write
  Embed --> Write[Write docs.html]
  Write --> Open{open=false?}
  Open -->|no| Browser([Open browser])
  Open -->|yes| Done([Exit])
```

## Sequence diagram

```mermaid
sequenceDiagram
  actor Reader
  participant Browser
  participant Router as DOCS0 router
  participant Mermaid
  Reader->>Browser: Click "Diagrams" in nav
  Browser->>Router: hashchange #/guides/diagrams
  Router->>Router: Hide old page, show new page
  Router->>Mermaid: render(pending diagrams)
  Mermaid-->>Router: SVG
  Router-->>Reader: Page with diagrams
```

## Class diagram

```mermaid
classDiagram
  class Page {
    +string file
    +string rel
    +string route
    +string title
    +Token[] tokens
  }
  class DirNode {
    +string name
    +Page landing
    +children
  }
  DirNode "1" o-- "*" Page : contains
  DirNode "1" o-- "*" DirNode : contains
```

## State diagram

```mermaid
stateDiagram-v2
  [*] --> idle
  idle --> loading: page has diagrams
  loading --> ready: CDN loaded
  loading --> ready: embedded fallback
  loading --> failed: no runtime
  ready --> ready: theme toggled / re-render
  failed --> [*]
```

## Entity relationship

```mermaid
erDiagram
  FOLDER ||--o{ FOLDER : contains
  FOLDER ||--o{ PAGE : contains
  FOLDER |o--o| PAGE : "landing page"
  PAGE ||--o{ HEADING : has
  PAGE ||--o{ IMAGE : embeds
```

## Gantt chart

```mermaid
gantt
  title DOCS0 roadmap
  dateFormat YYYY-MM-DD
  section Core
    Tree to nav          :done, 2026-09-01, 7d
    Sticky TOC           :done, 2026-09-05, 5d
    Single-file output   :done, 2026-09-08, 6d
  section Next
    Full-text search     :active, 2026-10-01, 14d
    Minified output      :2026-10-15, 7d
```

## Pie chart

```mermaid
pie title Where the bytes go (typical docs.html)
  "Mermaid fallback" : 2900
  "Highlight.js themes" : 3
  "DOCS0 CSS + JS" : 25
  "Your content" : 120
```

## Git graph

```mermaid
gitGraph
  commit id: "init"
  branch docs
  commit id: "add docs tree"
  commit id: "add diagrams"
  checkout main
  merge docs
  commit id: "v0.1.0" tag: "v0.1.0"
```

## How loading works

> [!NOTE]
> Mermaid is loaded from the jsDelivr CDN the first time a page with diagrams is opened. If the CDN is unreachable, DOCS0 uses
> a copy embedded in `docs.html` — so diagrams render offline too. Pages without diagrams never load Mermaid at all, and builds
> without any diagrams leave the embedded copy out entirely.
