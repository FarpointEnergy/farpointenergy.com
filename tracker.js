/* Farpoint v1: allowlisted observations, durable-receipt acknowledgements, no form values. */
(function (root, make) {
  "use strict";
  if (typeof module === "object" && module.exports) module.exports = make;
  else {
    try {
      const tracker = make(root, root.farpointAnalyticsConfig || {});
      root.farpointTracker = tracker;
      tracker.start();
    } catch (_) { /* A blocked or broken tracker cannot interrupt the quotation form. */ }
  }
})(typeof window !== "undefined" ? window : globalThis, function createTracker(env, config) {
  "use strict";
  const VERSION = "1.0.0";
  const PREFIX = "farpoint-event-v1:";
  const BROWSER_KEY = "farpoint-browser-v1";
  const SESSION_KEY = "farpoint-session-v1";
  const EVENTS = new Set(["page_view", "product_view", "reference_select", "quotation_view", "quotation_start", "technical_details_open", "quotation_validation_error", "quotation_attempt", "quotation_provider_accepted", "quotation_transport_error", "email_click", "script_error"]);
  const PAGES = {"": "home", "index.html": "home", "products.html": "products", "applications.html": "applications", "quality.html": "quality", "delivery.html": "delivery", "manufacturing.html": "manufacturing", "about.html": "about", "quote.html": "quote", "privacy.html": "privacy", "thanks.html": "thanks", "power-transformers.html": "power-transformers", "distribution-transformers.html": "distribution-transformers", "data-centers.html": "data-centers", "solar-storage.html": "solar-storage", "markets.html": "markets", "contact.html": "contact", "404.html": "404"};
  const VALUES = {
    product_id: new Set(["power", "distribution", "unsure"]),
    application_id: new Set(["data-center", "solar", "storage", "hybrid", "utility", "industrial", "other", "unsure"]),
    reference_id: new Set(["FP-MPT-138-50", "FP-MPT-115-50", "FP-MPT-138-100", "FP-MPT-115-100"]),
    error_category: new Set(["required_field", "invalid_number", "provider_rejected", "transport_timeout", "transport_error", "malformed_response", "script_exception", "storage_unavailable", "unknown_error"]),
    location_code: new Set(["global", "quotation", "tracker", "navigation", "unknown_location"])
  };
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const memory = new Map();
  let sequence = 0, storageStatus = "persistent", browserId = null, session = null;
  let retryTimer = null, retryCount = 0, started = false, inflight = 0;
  const now = () => env.Date ? env.Date.now() : Date.now();
  const date = n => new Date(n).toISOString();
  let endpoint = "";
  try {
    const u = new URL(config.endpoint);
    if (u.protocol === "https:" && !u.username && !u.password && !u.search && !u.hash && u.pathname === "/v1/events") endpoint = u.href;
  } catch (_) { /* Missing configuration is intentionally disabled. */ }
  const enabled = config.enabled === true && config.privacy_disclosure_version === "1" && Boolean(endpoint);
  function uuid() {
    const c = env.crypto;
    if (!c || typeof c.getRandomValues !== "function") return null;
    if (typeof c.randomUUID === "function") return c.randomUUID();
    const b = new Uint8Array(16); c.getRandomValues(b); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    const h = Array.from(b, x => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
  }
  function storage() { try { return env.localStorage; } catch (_) { storageStatus = "memory_only"; return null; } }
  function get(key) { try { return storage()?.getItem(key); } catch (_) { storageStatus = "memory_only"; return null; } }
  function set(key, value) { try { const s = storage(); if (!s) return false; s.setItem(key, value); return true; } catch (_) { storageStatus = "memory_only"; return false; } }
  function safeCampaign() {
    const out = {}; let p;
    try { p = new URL(env.location.href).searchParams; } catch (_) { return out; }
    for (const [key, names] of Object.entries({source:["utm_source", "source"], medium:["utm_medium"], campaign:["utm_campaign", "campaign"]})) {
      const present = names.filter(name => p.has(name));
      if (!present.length) continue;
      const value = present.length === 1 && p.getAll(present[0]).length === 1 ? p.get(present[0]) : null;
      out[key] = Array.isArray(config.campaign_registry?.[key]) && config.campaign_registry[key].includes(value) ? value : "unknown_campaign";
    }
    return out;
  }
  function cleanCampaign(value) {
    const clean = {};
    for (const key of ["source", "medium", "campaign"]) if (value && Object.hasOwn(value,key)) {
      clean[key] = value[key] === "unknown_campaign" || config.campaign_registry?.[key]?.includes(value[key]) ? value[key] : "unknown_campaign";
    }
    return clean;
  }
  function safeReferrer() {
    try {
      const raw = env.document?.referrer;
      if (!raw) return "direct_unknown";
      const ref = new URL(raw), here = new URL(env.location.href);
      if (ref.origin === here.origin) return "internal";
      const value = config.referrer_domains?.[ref.hostname];
      return ["search", "social", "referral"].includes(value) ? value : "unknown";
    } catch (_) { return "unknown"; }
  }
  function pageId() {
    try { const path = new URL(env.location.href).pathname; return Object.hasOwn(PAGES, path.slice(1)) ? PAGES[path.slice(1)] : "unknown_page"; }
    catch (_) { return "unknown_page"; }
  }
  function identity() {
    if (!browserId) {
      const saved = get(BROWSER_KEY);
      browserId = UUID.test(saved || "") ? saved : uuid();
      if (browserId && saved !== browserId && !set(BROWSER_KEY, browserId)) browserId = null;
    }
    let saved;
    try { saved = JSON.parse(get(SESSION_KEY) || "null"); } catch (_) { /* Use a fresh session. */ }
    if (saved && UUID.test(saved.id || "") && Number.isSafeInteger(saved.at) && now() >= saved.at && now() - saved.at < 30 * 60 * 1000) session = {id:saved.id, at:saved.at, campaign:cleanCampaign(saved.campaign)};
    else if (!session || now() < session.at || now() - session.at >= 30 * 60 * 1000) session = {id:uuid(), at:now(), campaign:safeCampaign()};
    session.at = now(); set(SESSION_KEY, JSON.stringify(session));
    return {browser_id:browserId, session_id:session.id};
  }
  function record(name, detail = {}) {
    if (!enabled || !EVENTS.has(name)) return null;
    try {
      const id = uuid(); if (!id) return null;
      const event = {schema_version:1, event_id:id, ...identity(), client_timestamp:date(now()), sequence:sequence++, event_name:name, page_id:pageId(), tracker_version:VERSION, referrer_category:safeReferrer(), storage_status:storageStatus};
      const campaign = safeCampaign(); if (Object.keys(campaign).length) event.campaign = campaign;
      for (const [key, allowed] of Object.entries(VALUES)) if (allowed.has(detail[key])) event[key] = detail[key];
      if (UUID.test(detail.inquiry_id || "")) event.inquiry_id = detail.inquiry_id;
      if (config.synthetic === true) event.synthetic = true;
      const key = PREFIX + id;
      let raw = JSON.stringify(event);
      // One immutable key per event avoids cross-tab last-write-wins queue loss.
      if (memory.has(key) || (get(key) !== null && get(key) !== undefined)) return null;
      if (!set(key, raw)) { event.storage_status = "memory_only"; raw = JSON.stringify(event); }
      memory.set(key, raw);
      schedule(200);
      return id;
    } catch (_) { return null; }
  }
  function pending() {
    const all = new Map(memory);
    try {
      const s = storage();
      if (s) for (let i = 0; i < s.length; i++) { const key = s.key(i); if (key?.startsWith(PREFIX)) { const raw = s.getItem(key); if (raw !== null) all.set(key, raw); } }
    } catch (_) { storageStatus = "memory_only"; }
    return all;
  }
  function snapshot() {
    const items = []; const events = [];
    // Unknown/corrupt local items remain untouched. Valid items can still be delivered.
    for (const [key, raw] of pending()) {
      let value; try { value = JSON.parse(raw); } catch (_) { continue; }
      if (!value || typeof value !== "object" || !UUID.test(value.event_id || "") || key !== PREFIX + value.event_id) continue;
      const candidate = JSON.stringify({schema_version:1, tracker_version:VERSION, events:[...events, value]});
      if (new TextEncoder().encode(candidate).byteLength > 24 * 1024) { if (events.length) break; else continue; }
      events.push(value); items.push(Object.freeze({key, raw})); if (events.length === 40) break;
    }
    if (!items.length) return null;
    return Object.freeze({items:Object.freeze(items), body:JSON.stringify({schema_version:1, tracker_version:VERSION, events})});
  }
  async function sha256(body) {
    if (!env.crypto?.subtle) return null;
    const bytes = await env.crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
    return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
  }
  function canonicalize(value) {
    if (value === null || typeof value === "boolean") return JSON.stringify(value);
    if (typeof value === "number") { if (!Number.isSafeInteger(value)) throw Error("invalid_number"); return String(value === 0 ? 0 : value); }
    if (typeof value === "string") {
      for (let i=0;i<value.length;i++) {
        const n=value.charCodeAt(i);
        if (n>=0xd800 && n<=0xdbff) { const next=value.charCodeAt(++i); if (!(next>=0xdc00 && next<=0xdfff)) throw Error("invalid_surrogate"); }
        else if (n>=0xdc00 && n<=0xdfff) throw Error("invalid_surrogate");
      }
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) return "[" + Array.from(value, canonicalize).join(",") + "]";
    if (value && Object.prototype.toString.call(value) === "[object Object]") {
      const keys=Object.keys(value).sort();
      if (keys.some(k=>!/^[\x00-\x7f]*$/.test(k))) throw Error("non_ascii_key");
      return "{" + keys.map(k=>canonicalize(k)+":"+canonicalize(value[k])).join(",") + "}";
    }
    throw Error("invalid_type");
  }
  function clearAcknowledged(snap) {
    for (const item of snap.items) {
      // Exact value comparison also protects a later event version under a reused key.
      if (memory.get(item.key) === item.raw) memory.delete(item.key);
      try { const s = storage(); if (s?.getItem(item.key) === item.raw) s.removeItem(item.key); } catch (_) { /* Safe to send a duplicate later. */ }
    }
  }
  function schedule(ms) {
    if (retryTimer || !env.setTimeout) return;
    retryTimer = env.setTimeout(() => { retryTimer = null; void flush(); }, ms);
  }
  async function send(snap) {
    if (!enabled || !snap || typeof env.fetch !== "function") return false;
    let timer;
    try {
      const hash = await sha256(snap.body); if (!hash) return false;
      const controller = typeof env.AbortController === "function" ? new env.AbortController() : null;
      if (controller && env.setTimeout) timer = env.setTimeout(() => controller.abort(), 15000);
      const response = await env.fetch(endpoint, {method:"POST", headers:{"Content-Type":"application/json", "Accept":"application/json"}, body:snap.body, mode:"cors", credentials:"omit", referrerPolicy:"no-referrer", redirect:"error", keepalive:true, ...(controller ? {signal:controller.signal} : {})});
      if (!response.ok || response.type === "opaque" || response.redirected || response.url !== endpoint) return false;
      const ack = await response.json();
      if (!ack || ack.status !== "retained" || ack.terminal !== true || typeof ack.receipt_id !== "string" || !ack.receipt_id || ack.receipt_id.length > 128 || ack.receipt_body_sha256 !== hash) return false;
      clearAcknowledged(snap); return true;
    } catch (_) { return false; }
    finally { if (timer && env.clearTimeout) env.clearTimeout(timer); }
  }
  async function flush() {
    if (!enabled || inflight) return false;
    const snap = snapshot(); if (!snap) return true;
    inflight++;
    const ok = await send(snap); inflight--;
    retryCount = ok ? 0 : Math.min(retryCount + 1, 8);
    if (pending().size) schedule(ok ? 200 : Math.min(60000, 500 * (2 ** retryCount)));
    return ok;
  }
  function beacon() {
    if (!enabled) return false;
    const snap = snapshot(); if (!snap || !env.navigator?.sendBeacon) return false;
    try {
      // Returning true means queued by the browser, never a durable acknowledgement.
      return env.navigator.sendBeacon(endpoint, new Blob([snap.body], {type:"application/json"}));
    } catch (_) { return false; }
  }
  function inquiryContext() {
    if (!enabled) return {};
    const ids = identity(), campaign = cleanCampaign(session?.campaign);
    return {...ids, ...(Object.keys(campaign).length ? {campaign} : {})};
  }
  function start() {
    if (!enabled || started) return;
    started = true;
    const detail = {product_id:env.document?.body?.dataset?.product, application_id:env.document?.body?.dataset?.application};
    record("page_view", detail); if (pageId() === "quote") record("quotation_view", detail);
    env.addEventListener?.("online", () => void flush());
    env.addEventListener?.("pageshow", () => void flush());
    env.addEventListener?.("pagehide", beacon);
    env.addEventListener?.("error", () => record("script_error", {error_category:"script_exception", location_code:"global"}));
    env.addEventListener?.("unhandledrejection", () => record("script_error", {error_category:"script_exception", location_code:"global"}));
    env.document?.addEventListener?.("visibilitychange", () => { if (env.document.visibilityState === "hidden") beacon(); else void flush(); });
    const seenProducts = new Set();
    if (pageId() === "products" && typeof env.IntersectionObserver === "function") {
      const observer = new env.IntersectionObserver(entries => {
        for (const entry of entries) if (entry.isIntersecting && !seenProducts.has(entry.target.id) && ["power", "distribution"].includes(entry.target.id)) {
          seenProducts.add(entry.target.id); record("product_view", {product_id:entry.target.id});
        }
      }, {threshold:0.15});
      for (const id of ["power", "distribution"]) { const section = env.document.getElementById(id); if (section) observer.observe(section); }
    }
  }
  // Factory exports support deterministic tests; production has no network debug endpoint.
  return Object.freeze({enabled, start, record, flush, beacon, inquiryContext, snapshot, send, canonicalize, pendingCount:() => pending().size});
});
