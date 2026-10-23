/* Consent-limited website measurement. Never reads inquiry contents or full URLs. */
(() => {
  "use strict";
  const KEY = "farpoint-analytics-v1";
  const DAY = 86400000;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const PAGES = new Set(["index", "products", "applications", "manufacturing", "quality", "delivery", "quote", "about", "privacy", "thanks", "404"].map(p => `/${p}.html`));
  const NAMES = new Set(["page_view", "product_path_view", "rfq_start", "rfq_submit_success", "email_click"]);
  const PRODUCTS = new Set(["power", "distribution", "unsure"]);
  const APPLICATIONS = new Set(["data-center", "solar", "storage", "hybrid", "utility", "industrial", "other", "unsure"]);
  const REFERRERS = new Set(["google.com", "bing.com", "duckduckgo.com", "linkedin.com", "yahoo.com", "facebook.com", "t.co"]);
  const LANGUAGES = new Set(["en", "es", "fr", "de", "pt", "it", "zh", "ja", "ko", "hi", "ar", "ru"]);
  const SOURCES = new Set(["email", "search", "social", "referral", "direct"]);
  const MEDIA = new Set(["email", "organic", "social", "referral", "none"]);
  const config = window.farpointAnalyticsConfig;
  const page = location.pathname === "/" ? "/index.html" : location.pathname;
  let endpoint;
  try {
    if (!config || config.enabled !== true || !Array.isArray(config.approvedHosts) || !config.approvedHosts.includes(location.hostname) || !PAGES.has(page)) return;
    endpoint = new URL(config.endpoint);
    if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== "/v1/events") return;
  } catch (_) { return; }
  const registry = Object.create(null);
  for (const [code, entry] of Object.entries(config.campaigns || {})) {
    if (/^[a-z0-9][a-z0-9_-]{0,39}$/.test(code) && entry && SOURCES.has(entry.source) && MEDIA.has(entry.medium)) registry[code] = { source: entry.source, medium: entry.medium };
  }
  const panel = document.getElementById("analytics-preferences");
  const opener = document.getElementById("analytics-open");
  const status = document.getElementById("analytics-status");
  const allow = document.getElementById("analytics-allow");
  const decline = document.getElementById("analytics-decline");
  const close = document.getElementById("analytics-close");
  const exclude = document.getElementById("analytics-exclude");
  if (!panel || !opener || !status || !allow || !decline || !close || !exclude) return;
  const form = document.getElementById("quote-form");
  let pageViewed = false, startedSession = "", inflight = 0, returnFocus = null, localBlockReason = "";
  const protectedByBrowser = () => navigator.globalPrivacyControl === true || navigator.doNotTrack === "1" || window.doNotTrack === "1";
  function uuid() {
    try {
      if (typeof window.crypto?.randomUUID === "function") return window.crypto.randomUUID();
      if (typeof window.crypto?.getRandomValues !== "function") return null;
      const bytes = window.crypto.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
      const hex = Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
      return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
    } catch (_) { return null; }
  }
  function clean(consent, excluded = false) {
    return { version: 1, consent, consentExpires: Date.now() + 180 * DAY, excluded };
  }
  function read() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const state = JSON.parse(raw), now = Date.now();
      const keys = ["version", "consent", "consentExpires", "excluded", "browserId", "browserExpires", "sessionId", "lastActivity", "firstCampaign", "lastCampaign"];
      if (!state || Array.isArray(state) || Object.keys(state).some(k => !keys.includes(k)) || state.version !== 1 || !["allow", "deny"].includes(state.consent) || typeof state.excluded !== "boolean" || !Number.isFinite(state.consentExpires) || state.consentExpires <= now || state.consentExpires > now + 180 * DAY + 1000) return null;
      if (state.consent === "deny" || state.excluded) return { version: 1, consent: state.consent, consentExpires: state.consentExpires, excluded: state.excluded };
      if (!state.browserId) return state;
      if (!UUID.test(state.browserId) || !Number.isFinite(state.browserExpires) || state.browserExpires > now + 30 * DAY + 1000 || !UUID.test(state.sessionId) || !Number.isFinite(state.lastActivity) || state.lastActivity > now + 1000 || !["", ...Object.keys(registry)].includes(state.firstCampaign) || !["", ...Object.keys(registry)].includes(state.lastCampaign)) return null;
      if (state.browserExpires <= now) return { version: 1, consent: state.consent, consentExpires: state.consentExpires, excluded: false };
      return state;
    } catch (_) { return null; }
  }
  function save(state) {
    try { localStorage.setItem(KEY, JSON.stringify(state)); return true; } catch (_) { return false; }
  }
  function campaign() {
    const params = new URLSearchParams(location.search), code = params.get("utm_campaign");
    if (params.getAll("utm_campaign").length !== 1 || !Object.hasOwn(registry, code)) return "";
    for (const [query, field] of [["utm_source", "source"], ["utm_medium", "medium"]]) {
      if (params.has(query) && (params.getAll(query).length !== 1 || params.get(query) !== registry[code][field])) return "";
    }
    return code;
  }
  function context() {
    const product = form ? form.elements["Transformer category"]?.value : page === "/products.html" ? ({ "#power": "power", "#distribution": "distribution" })[location.hash] : null;
    const application = form ? form.elements.Application?.value : page === "/applications.html" ? ({ "#datacenter": "data-center", "#solar": "solar", "#storage": "storage", "#hybrid": "hybrid", "#utilities": "utility", "#industrial": "industrial", "#wind": "other", "#replacement": "other" })[location.hash] : null;
    return { product: PRODUCTS.has(product) ? product : "unsure", application: APPLICATIONS.has(application) ? application : "unsure" };
  }
  function referrer() {
    if (!document.referrer) return "";
    try {
      const host = new URL(document.referrer).hostname.replace(/^www\./, "");
      if (config.approvedHosts.map(h => h.replace(/^www\./, "")).includes(host)) return "";
      return REFERRERS.has(host) ? host : "other";
    } catch (_) { return "other"; }
  }
  function send(name, categories) {
    if (!NAMES.has(name) || localBlockReason || protectedByBrowser() || inflight >= 20) return;
    const state = read(), now = Date.now();
    if (!state || state.consent !== "allow" || state.excluded) return;
    let newSession = false;
    if (!state.browserId) {
      newSession = true;
      state.browserId = uuid(); state.browserExpires = now + 30 * DAY;
      state.sessionId = uuid(); state.lastActivity = now;
      state.firstCampaign = ""; state.lastCampaign = "";
    } else if (now - state.lastActivity >= 30 * 60000) {
      newSession = true;
      state.sessionId = uuid();
    }
    const eventId = uuid();
    if (!UUID.test(state.browserId || "") || !UUID.test(state.sessionId || "") || !UUID.test(eventId || "")) return;
    if (name === "rfq_start" && startedSession === state.sessionId) return;
    const currentCampaign = campaign();
    if (currentCampaign) { if (!state.firstCampaign) state.firstCampaign = currentCampaign; state.lastCampaign = currentCampaign; }
    state.lastActivity = now;
    if (!save(state)) return;
    if ((newSession || !pageViewed) && name !== "page_view") send("page_view", context());
    if (name === "page_view") pageViewed = true;
    const lang = String(navigator.language || "").toLowerCase().split("-")[0];
    const body = { schemaVersion: 1, eventId, browserId: state.browserId, sessionId: state.sessionId, name, page,
      product: PRODUCTS.has(categories?.product) ? categories.product : "unsure",
      application: APPLICATIONS.has(categories?.application) ? categories.application : "unsure",
      campaignCode: state.lastCampaign, source: state.lastCampaign ? registry[state.lastCampaign].source : "", medium: state.lastCampaign ? registry[state.lastCampaign].medium : "",
      referrerHost: referrer(), language: LANGUAGES.has(lang) ? lang : "other",
      screenClass: window.innerWidth < 600 ? "mobile" : window.innerWidth < 1000 ? "tablet" : "desktop", clientTimestamp: now };
    if (name === "rfq_submit_success") {
      const id = document.getElementById("f-inquiry-id")?.value;
      if (UUID.test(id || "")) body.inquiryId = id;
    }
    if (name === "rfq_start") startedSession = state.sessionId;
    const data = JSON.stringify(body);
    if (inflight >= 20) return;
    // No retry or persistent queue: an uncertain request must not become a new event.
    if (typeof window.fetch === "function") {
      inflight++;
      try {
        Promise.resolve(window.fetch(endpoint.href, { method: "POST", headers: { "Content-Type": "application/json" }, body: data, keepalive: true, credentials: "omit", referrerPolicy: "no-referrer" })).catch(() => {}).finally(() => { inflight--; });
      } catch (_) { inflight--; }
    } else if (document.querySelector('meta[name="referrer"]')?.content === "no-referrer" && typeof navigator.sendBeacon === "function") {
      try { navigator.sendBeacon(endpoint.href, new Blob([data], { type: "application/json" })); } catch (_) { /* RFQ remains independent. */ }
    }
  }
  function recordCurrentPage() {
    const state = read();
    if (pageViewed || localBlockReason || protectedByBrowser() || !state || state.consent !== "allow" || state.excluded) return;
    send("page_view", context());
    if (page === "/products.html" && context().product !== "unsure") send("product_path_view", context());
  }
  function updateStatus() {
    const state = read();
    allow.disabled = protectedByBrowser();
    exclude.checked = state?.excluded === true;
    status.textContent = localBlockReason || (protectedByBrowser() ? "Analytics is off because your browser requests privacy." : state?.excluded ? "This browser is excluded from analytics." : state?.consent === "allow" ? "Analytics is allowed on this browser." : "Analytics is off. Your quotation form works either way.");
  }
  function show(focus) {
    updateStatus(); panel.hidden = false; opener.setAttribute("aria-expanded", "true");
    if (focus) { returnFocus = document.activeElement; panel.focus(); }
  }
  function hide() {
    panel.hidden = true; opener.setAttribute("aria-expanded", "false");
    if (returnFocus && typeof returnFocus.focus === "function") returnFocus.focus();
    returnFocus = null;
  }
  function choice(consent) {
    const existing = read();
    // Reaffirming an unchanged choice must not rotate identity or replay views.
    // Keep the original expiry as well, so other tabs receive no state change.
    if (!localBlockReason && existing?.consent === consent && existing.excluded === (exclude.checked === true)) {
      updateStatus(); hide(); return;
    }
    const state = clean(consent, exclude.checked === true);
    // A failed opt-out write must never leave the previous allow state active here.
    localBlockReason = consent === "deny" ? "Analytics is off. Your quotation form works either way." : "";
    if (!save(state)) {
      localBlockReason = "Analytics is off on this page. Your browser could not save this choice; clear this site's stored data to remove an earlier choice.";
      try { localStorage.removeItem(KEY); } catch (_) { /* Remain blocked in memory. */ }
      updateStatus(); return;
    }
    localBlockReason = "";
    pageViewed = false; startedSession = "";
    updateStatus(); hide();
    if (consent === "allow") recordCurrentPage();
  }
  opener.hidden = false;
  opener.addEventListener("click", () => show(true));
  allow.addEventListener("click", () => { if (!protectedByBrowser()) choice("allow"); });
  decline.addEventListener("click", () => choice("deny"));
  close.addEventListener("click", hide);
  panel.addEventListener("keydown", e => { if (e.key === "Escape") { hide(); } });
  exclude.addEventListener("change", () => {
    const current = read();
    localBlockReason = exclude.checked ? "This browser is excluded from analytics." : "";
    if (!save(clean(current?.consent || "deny", exclude.checked))) {
      localBlockReason = "Analytics is off on this page because your browser could not save this choice.";
      try { localStorage.removeItem(KEY); } catch (_) { /* Remain blocked in memory. */ }
    } else localBlockReason = "";
    pageViewed = false; startedSession = ""; updateStatus();
    if (!exclude.checked) recordCurrentPage();
  });
  function identityKey(raw) {
    try {
      const state = JSON.parse(raw);
      return JSON.stringify([state?.consent, state?.consentExpires, state?.excluded, state?.browserId, state?.sessionId]);
    } catch (_) { return "invalid"; }
  }
  window.addEventListener("storage", e => {
    if (e.key !== KEY && e.key !== null) return;
    // Other tabs update lastActivity and attribution for every action. Reacting
    // by sending a page view would recursively write storage across all tabs.
    // Identity/consent changes invalidate local guards; only a later action in
    // this tab can collect its current page and start a new measurement period.
    if (e.key === null || identityKey(e.oldValue) !== identityKey(e.newValue)) {
      pageViewed = false; startedSession = "";
    }
    updateStatus();
  });
  window.addEventListener("pageshow", () => { updateStatus(); });
  // Independent listener handles consent granted after inquiry.js already saw a start.
  if (form) for (const event of ["focusin", "input", "submit"]) form.addEventListener(event, () => send("rfq_start", context()));
  window.farpointAnalytics = (name, categories) => {
    if (name !== "page_view" && name !== "product_path_view") send(name, categories);
    else if (name === "product_path_view") {
      // Initial product-page callback follows this script; don't count it twice.
      const key = `${location.hash}:${read()?.sessionId || ""}`;
      if (window.farpointAnalytics.lastProductKey !== key) { window.farpointAnalytics.lastProductKey = key; send(name, categories); }
    }
  };
  if (protectedByBrowser()) {
    const state = read(); if (state) save(clean("deny", state.excluded));
  }
  const initial = read();
  if (!initial && !protectedByBrowser()) show(false);
  updateStatus(); recordCurrentPage();
  window.farpointAnalytics.lastProductKey = `${location.hash}:${read()?.sessionId || ""}`;
})();
