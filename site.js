(() => {
  "use strict";
  const products = new Set(["power", "distribution", "unsure"]);
  const applications = new Set(["data-center", "solar", "storage", "hybrid", "utility", "industrial", "other"]);
  const sources = new Set(["website", "homepage", "products", "power-transformers", "distribution-transformers", "applications", "data-centers", "solar-storage", "quality", "delivery", "manufacturing", "about", "email"]);
  const campaigns = new Set(["power", "distribution", "data-center", "solar", "storage", "hybrid", "utility", "industrial", "other"]);
  const allowed = { product: products, application: applications, source: sources, campaign: campaigns };
  const routes = new Set(["products.html", "applications.html", "quote.html"]);
  const productSections = { "#power": "power", "#distribution": "distribution" };
  const applicationSections = { "#datacenter": "data-center", "#solar": "solar", "#storage": "storage", "#hybrid": "hybrid", "#utilities": "utility", "#industrial": "industrial", "#wind": "other", "#replacement": "other" };
  const initialProduct = products.has(document.body.dataset.product) ? document.body.dataset.product : undefined;
  const initialApplication = applications.has(document.body.dataset.application) ? document.body.dataset.application : undefined;

  function sectionContext(url) {
    const route = url.pathname.split("/").pop();
    return {
      product: route === "products.html" ? productSections[url.hash] : undefined,
      application: route === "applications.html" ? applicationSections[url.hash] : undefined
    };
  }

  function safeQuery(params, key) {
    const value = params.get(key);
    return params.getAll(key).length === 1 && allowed[key].has(value) ? value : undefined;
  }

  // Always derive from authored links, never from a previously enriched href.
  // Only the four public context fields below can pass between pages.
  const links = Array.from(document.querySelectorAll("a[href]"), link => ({ link, original: link.getAttribute("href") }));
  function refreshContext() {
    const current = new URL(location.href);
    const section = sectionContext(current);
    const inherited = {};
    for (const key of Object.keys(allowed)) inherited[key] = safeQuery(current.searchParams, key);
    inherited.product = section.product || inherited.product || initialProduct;
    inherited.application = section.application || inherited.application || initialApplication;
    document.body.dataset.product = inherited.product || "unsure";
    document.body.dataset.application = inherited.application || "unsure";

    for (const { link, original } of links) {
      if (!original || !original.trim() || original.trim().startsWith("#")) continue;
      let destination;
      try { destination = new URL(original, current.href); } catch (_) { continue; }
      if (destination.origin !== current.origin || !["http:", "https:"].includes(destination.protocol) || !routes.has(destination.pathname.split("/").pop())) continue;
      const targetSection = sectionContext(destination);
      for (const key of Object.keys(allowed)) {
        if (destination.searchParams.has(key)) {
          // Keep one valid authored value. Discard ambiguous or unsafe values.
          if (!safeQuery(destination.searchParams, key)) destination.searchParams.delete(key);
          continue;
        }
        const value = targetSection[key] || inherited[key];
        if (value && allowed[key].has(value)) destination.searchParams.set(key, value);
      }
      link.setAttribute("href", destination.pathname + destination.search + destination.hash);
    }
  }
  refreshContext();
  window.addEventListener("hashchange", refreshContext);
  window.addEventListener("pageshow", refreshContext);

  const nav = document.querySelector(".nav");
  const toggle = document.querySelector(".navbtn");
  const menu = document.getElementById("site-menu");
  if (nav && toggle && toggle.tagName === "BUTTON" && menu) {
    toggle.hidden = false;
    nav.classList.add("menu-ready");
    const close = () => {
      menu.classList.remove("is-open");
      toggle.setAttribute("aria-expanded", "false");
    };
    close();
    toggle.addEventListener("click", () => {
      const open = toggle.getAttribute("aria-expanded") !== "true";
      menu.classList.toggle("is-open", open);
      toggle.setAttribute("aria-expanded", String(open));
    });
    nav.addEventListener("keydown", event => {
      if (event.key === "Escape" && toggle.getAttribute("aria-expanded") === "true") {
        close();
        toggle.focus();
      }
    });
    menu.addEventListener("click", event => {
      if (event.target instanceof Element && event.target.closest("a[href]")) close();
    });
    window.addEventListener("pageshow", close);
    if (window.matchMedia) {
      const desktop = window.matchMedia("(min-width: 901px)");
      if (desktop.addEventListener) desktop.addEventListener("change", close);
    }
  }
})();
