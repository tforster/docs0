// docs0.client.js — DOCS0 in-browser runtime, inlined into the generated HTML by docs0.js
//
// Hash router (#/page/route[/section-slug]), nav state, TOC scroll-spy, theme switching, copy buttons and on-demand mermaid.
/* global mermaid */
(function () {
  "use strict";

  const config = JSON.parse(document.getElementById("docs0-config").textContent);
  const root = document.documentElement;
  const nav = document.getElementById("nav");
  const pathEl = document.getElementById("current-path");
  const updatedEl = /** @type {HTMLTimeElement} */ (document.getElementById("updated"));
  const navToggle = document.getElementById("nav-toggle");
  const pages = /** @type {HTMLElement[]} */ ([...document.querySelectorAll(".page")]);
  const byRoute = new Map(pages.map((p) => [p.dataset.route, p]));
  const navLinks = /** @type {HTMLAnchorElement[]} */ ([...nav.querySelectorAll("a[data-route]")]);
  const TOP_OFFSET = 80;

  /** @type {HTMLElement|null} */
  let current = null;

  // ---------------------------------------------------------------------------
  // Routing
  // ---------------------------------------------------------------------------

  /**
   * Resolves location.hash into a page and optional heading anchor. An exact page route wins; otherwise the last segment is
   * treated as an in-page anchor. Bare #anchors (not starting with "/") target the current page.
   *
   * @returns {{ page: HTMLElement, anchor: string }} Target.
   */
  function resolveHash() {
    const raw = decodeURIComponent(location.hash.slice(1));
    const home = byRoute.get("") ?? pages[0];
    if (raw && !raw.startsWith("/")) return { page: current ?? home, anchor: raw };
    const h = raw.replace(/^\/+|\/+$/g, "");
    if (byRoute.has(h)) return { page: byRoute.get(h), anchor: "" };
    const i = h.lastIndexOf("/");
    const base = i < 0 ? "" : h.slice(0, i);
    if (byRoute.has(base)) return { page: byRoute.get(base), anchor: h.slice(i + 1) };
    if (h) console.warn(`docs0: no page for #/${h}`);
    return { page: home, anchor: "" };
  }

  /**
   * Finds a heading within a page by its slug.
   *
   * @param {HTMLElement} page - Page article.
   * @param {string} anchor - Heading slug.
   * @returns {Element|null} Heading.
   */
  function findHeading(page, anchor) {
    return anchor ? page.querySelector(`[data-anchor="${CSS.escape(anchor)}"]`) : null;
  }

  /**
   * Opens every <details> ancestor of an element.
   *
   * @param {Element} el - Nav element.
   */
  function openAncestors(el) {
    for (let d = el.closest("details"); d; d = d.parentElement.closest("details")) d.open = true;
  }

  /** Shows the page addressed by the hash and scrolls to its anchor. */
  function route() {
    const { page, anchor } = resolveHash();
    const changed = page !== current;
    if (changed) {
      if (current) current.hidden = true;
      page.hidden = false;
      current = page;
      pathEl.textContent = page.dataset.path;
      updatedEl.textContent = page.dataset.updated;
      updatedEl.dateTime = page.dataset.updated;
      document.title = `${page.dataset.title} · ${config.siteName}`;
      for (const a of navLinks) {
        const on = a.dataset.route === page.dataset.route;
        a.classList.toggle("active", on);
        if (on) {
          a.setAttribute("aria-current", "page");
          openAncestors(a);
          // Keep the active link in view inside the nav without scrolling the window
          const r = a.getBoundingClientRect();
          const n = nav.getBoundingClientRect();
          if (r.top < n.top || r.bottom > n.bottom) nav.scrollTop += r.top - n.top - n.height / 3;
        } else a.removeAttribute("aria-current");
      }
      setNavOpen(false);
    }
    const heading = findHeading(page, anchor);
    if (heading) heading.scrollIntoView();
    else if (changed) window.scrollTo(0, 0);
    renderMermaid(page).then(() => {
      // Diagrams change layout above the anchor; settle on it again once they are drawn
      if (heading && resolveHash().anchor === anchor) heading.scrollIntoView();
    });
    updateSpy();
  }

  window.addEventListener("hashchange", route);

  // Re-clicking the link for the current hash does not fire hashchange; route manually so the anchor is scrolled to again
  document.addEventListener("click", (e) => {
    const a = /** @type {Element} */ (e.target).closest("a[href^='#']");
    if (a && a.getAttribute("href") === location.hash) {
      e.preventDefault();
      route();
    }
  });

  // Folder rows: clicking a folder's landing link navigates and keeps the folder open rather than collapsing it
  nav.addEventListener("click", (e) => {
    const a = /** @type {Element} */ (e.target).closest("summary a");
    if (!a) return;
    e.preventDefault();
    a.closest("details").open = true;
    if (a.getAttribute("href") === location.hash) route();
    else location.hash = a.getAttribute("href");
  });

  // ---------------------------------------------------------------------------
  // Nav toggle — collapses the sidebar on wide screens (remembered), opens the off-canvas nav on narrow ones
  // ---------------------------------------------------------------------------

  const narrow = matchMedia("(max-width: 800px)");

  /** Reflects the nav's visibility on the toggle button for the current screen width. */
  function syncNavToggle() {
    const shown = narrow.matches ? document.body.classList.contains("nav-open") : !root.classList.contains("nav-collapsed");
    navToggle.setAttribute("aria-expanded", String(shown));
    navToggle.title = shown ? "Hide navigation" : "Show navigation";
  }

  /**
   * Opens or closes the off-canvas nav on narrow screens.
   *
   * @param {boolean} open - Desired state.
   */
  function setNavOpen(open) {
    document.body.classList.toggle("nav-open", open);
    syncNavToggle();
  }

  /**
   * Collapses or restores the sidebar on wide screens.
   *
   * @param {boolean} collapsed - Desired state.
   */
  function setNavCollapsed(collapsed) {
    root.classList.toggle("nav-collapsed", collapsed);
    try {
      localStorage.setItem("docs0-nav", collapsed ? "collapsed" : "open");
    } catch {
      // Storage unavailable — the choice lasts for this visit only
    }
    syncNavToggle();
    updateSpy();
  }

  navToggle.addEventListener("click", () => {
    if (narrow.matches) setNavOpen(!document.body.classList.contains("nav-open"));
    else setNavCollapsed(!root.classList.contains("nav-collapsed"));
  });
  narrow.addEventListener("change", () => setNavOpen(false));
  syncNavToggle();
  document.getElementById("scrim").addEventListener("click", () => setNavOpen(false));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") setNavOpen(false);
  });

  // ---------------------------------------------------------------------------
  // TOC scroll-spy
  // ---------------------------------------------------------------------------

  /** @type {WeakMap<Element, Element|null>} TOC link → heading it targets. */
  const tocHeadings = new WeakMap();

  /** Highlights the TOC entry for the last heading scrolled past the top bar. */
  function updateSpy() {
    if (!current) return;
    const links = [...current.querySelectorAll(".page-toc a")];
    if (!links.length) return;
    let active = null;
    for (const a of links) {
      if (!tocHeadings.has(a))
        tocHeadings.set(a, findHeading(current, decodeURIComponent(a.getAttribute("href")).split("/").pop()));
      const h = tocHeadings.get(a);
      if (h && h.getBoundingClientRect().top <= TOP_OFFSET + 1) active = a;
    }
    // At the very bottom, short final sections can never reach the top; favour the last visible one
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) {
      const visible = links.filter((a) => tocHeadings.get(a)?.getBoundingClientRect().top < window.innerHeight);
      if (visible.length) active = visible.at(-1);
    }
    for (const a of links) a.classList.toggle("active", a === active);
  }

  let spyQueued = false;
  window.addEventListener(
    "scroll",
    () => {
      if (spyQueued) return;
      spyQueued = true;
      requestAnimationFrame(() => {
        spyQueued = false;
        updateSpy();
      });
    },
    { passive: true },
  );

  // ---------------------------------------------------------------------------
  // Theme
  // ---------------------------------------------------------------------------

  /**
   * Applies a theme and re-renders diagrams in the matching mermaid theme.
   *
   * @param {"light"|"dark"} theme - Theme name.
   */
  function setTheme(theme) {
    if (root.dataset.theme === theme) return;
    root.dataset.theme = theme;
    if (mermaidState === "ready") {
      initMermaid();
      document.querySelectorAll("pre.mermaid[data-rendered]").forEach((el) => el.removeAttribute("data-rendered"));
      renderMermaid(current);
    }
  }

  document.getElementById("theme-toggle").addEventListener("click", () => {
    const next = root.dataset.theme === "dark" ? "light" : "dark";
    try {
      localStorage.setItem("docs0-theme", next);
    } catch {
      // Storage unavailable (private mode, file:// restrictions) — the choice lasts for this visit only
    }
    setTheme(next);
  });

  // Follow the system preference live until the reader makes an explicit choice
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
    let stored = null;
    try {
      stored = localStorage.getItem("docs0-theme");
    } catch {
      // Ignore
    }
    if (!stored) setTheme(e.matches ? "dark" : "light");
  });

  // ---------------------------------------------------------------------------
  // Zen mode — hides both sidebars so content fills the width; remembered like the theme
  // ---------------------------------------------------------------------------

  const zenToggle = document.getElementById("zen-toggle");
  zenToggle.setAttribute("aria-pressed", String(root.classList.contains("zen")));
  zenToggle.addEventListener("click", () => {
    const on = root.classList.toggle("zen");
    zenToggle.setAttribute("aria-pressed", String(on));
    try {
      localStorage.setItem("docs0-zen", on ? "1" : "0");
    } catch {
      // Storage unavailable — the choice lasts for this visit only
    }
    setNavOpen(false);
    updateSpy();
  });

  // ---------------------------------------------------------------------------
  // Copy buttons
  // ---------------------------------------------------------------------------

  document.addEventListener("click", async (e) => {
    const btn = /** @type {Element} */ (e.target).closest(".code-copy");
    if (!btn) return;
    try {
      await navigator.clipboard.writeText(btn.parentElement.querySelector("code").innerText);
      btn.textContent = "Copied";
    } catch {
      btn.textContent = "Failed";
    }
    setTimeout(() => (btn.textContent = "Copy"), 1500);
  });

  // ---------------------------------------------------------------------------
  // Mermaid — CDN first, embedded copy as offline fallback; rendered per page when shown
  // ---------------------------------------------------------------------------

  /** @type {"idle"|"loading"|"ready"|"failed"} */
  let mermaidState = "idle";
  /** @type {WeakMap<Element, string>} Original diagram source, kept so diagrams can be re-rendered on theme change. */
  const mermaidSrc = new WeakMap();
  let mermaidSeq = 0;

  /** (Re)initialises mermaid with the current theme. */
  function initMermaid() {
    mermaid.initialize({ startOnLoad: false, theme: root.dataset.theme === "dark" ? "dark" : "default" });
  }

  /**
   * Renders any un-rendered diagrams in a page. Pages are visible when rendered, so mermaid measures real text sizes.
   *
   * @param {HTMLElement|null} page - Page article.
   * @returns {Promise<void>} Resolves when done.
   */
  async function renderMermaid(page) {
    if (mermaidState !== "ready" || !page) return;
    for (const el of page.querySelectorAll("pre.mermaid:not([data-rendered])")) {
      if (!mermaidSrc.has(el)) mermaidSrc.set(el, el.textContent.trim());
      const src = mermaidSrc.get(el);
      const id = `docs0-mermaid-${++mermaidSeq}`;
      el.setAttribute("data-rendered", "1");
      try {
        const { svg } = await mermaid.render(id, src);
        el.innerHTML = svg;
        el.classList.remove("mermaid-error");
      } catch (err) {
        // Show the source rather than a blank gap; mermaid may leave its error node in <body>
        document.getElementById(`d${id}`)?.remove();
        el.textContent = src;
        el.classList.add("mermaid-error");
        console.warn("docs0: Mermaid render failed", err);
      }
    }
  }

  /** Loads mermaid from the CDN, falling back to the copy embedded in this file. */
  function loadMermaid() {
    mermaidState = "loading";
    const ready = () => {
      mermaidState = "ready";
      initMermaid();
      renderMermaid(current);
    };
    const s = document.createElement("script");
    s.src = config.mermaidCdn;
    s.addEventListener("load", ready);
    s.addEventListener("error", () => {
      const embedded = document.getElementById("docs0-mermaid");
      if (embedded) {
        const f = document.createElement("script");
        f.textContent = embedded.textContent;
        document.head.appendChild(f);
      }
      if (typeof mermaid !== "undefined") ready();
      else {
        mermaidState = "failed";
        console.warn("docs0: Mermaid unavailable (offline and no embedded copy)");
      }
    });
    document.head.appendChild(s);
  }

  route();
  if (document.querySelector("pre.mermaid")) loadMermaid();
})();
