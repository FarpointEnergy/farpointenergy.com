/* Progressive enhancement; native HTML POST remains available without JavaScript. */
(() => {
  "use strict";
  const products = new Set(["power", "distribution", "unsure"]);
  const applications = new Set(["data-center", "solar", "storage", "hybrid", "utility", "industrial", "other"]);
  const publicSources = new Set(["website", "homepage", "products", "power-transformers", "distribution-transformers", "applications", "data-centers", "solar-storage", "quality", "delivery", "manufacturing", "about", "email"]);
  const publicCampaigns = new Set(["power", "distribution", "data-center", "solar", "storage", "hybrid", "utility", "industrial", "other"]);
  const confirmationKey = "farpoint-inquiry-accepted";
  const form = document.getElementById("quote-form");
  let inquiryId = null, submittedBusiness = null, inquiryMetadata = {};
  const path = location.pathname.split("/").pop();
  const productPages = { "power-transformers.html": "power", "distribution-transformers.html": "distribution" };
  const applicationPages = { "data-centers.html": "data-center" };
  const productSections = { "#power": "power", "#distribution": "distribution" };
  const applicationSections = { "#datacenter": "data-center", "#solar": "solar", "#storage": "storage", "#utilities": "utility", "#industrial": "industrial", "#hybrid": "hybrid", "#wind": "other", "#replacement": "other" };
  const eventNames = new Set(["product_path_view", "rfq_start", "rfq_submit_success", "email_click"]);

  function context() {
    const product = form ? form.elements["Transformer category"].value : document.body.dataset.product || productPages[path] || (path === "products.html" && productSections[location.hash]);
    const application = form ? form.elements.Application.value : document.body.dataset.application || applicationPages[path] || (path === "applications.html" && applicationSections[location.hash]);
    return {
      product: products.has(product) ? product : "unsure",
      application: applications.has(application) ? application : "unsure"
    };
  }

  function track(name, detail = {}) {
    if (!window.farpointTracker || typeof window.farpointTracker.record !== "function") return;
    try {
      const c = context();
      window.farpointTracker.record(name, {product_id:c.product, application_id:c.application,
        ...(inquiryId ? {inquiry_id:inquiryId} : {}), ...detail});
    } catch (_) { /* Analytics never blocks an inquiry. */ }
  }

  function emit(name) {
    const names = {product_path_view:"product_view", rfq_start:"quotation_start", rfq_submit_success:"quotation_provider_accepted", email_click:"email_click"};
    if (names[name]) track(names[name]);
    // Preserve the existing integration hook; never send any form contents.
    if (!eventNames.has(name) || typeof window.farpointAnalytics !== "function") return;
    try { window.farpointAnalytics(name, context()); } catch (_) { /* Isolated optional callback. */ }
  }

  function correlate(payload) {
    // Compare business intent only in page memory. Never persist or track this text.
    const business = Object.fromEntries(Object.entries(payload).filter(([key]) => !key.startsWith("_") && !key.startsWith("Farpoint ") && !["Source", "Campaign"].includes(key)).sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0));
    const snapshot = JSON.stringify(business);
    if (!inquiryId || submittedBusiness !== snapshot) {
      inquiryId = null;
      const c = window.crypto;
      if (c && typeof c.getRandomValues === "function") {
        if (typeof c.randomUUID === "function") inquiryId = c.randomUUID();
        else {
          const b = new Uint8Array(16); c.getRandomValues(b); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
          const h = Array.from(b, x => x.toString(16).padStart(2,"0")).join("");
          inquiryId = `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
        }
      }
      submittedBusiness = snapshot;
      inquiryMetadata = {};
      try { inquiryMetadata = window.farpointTracker?.inquiryContext() || {}; } catch (_) { /* Submit without attribution. */ }
    }
    const metadata = inquiryMetadata;
    const values = {"inquiry":inquiryId, "browser":metadata.browser_id, "session":metadata.session_id,
      "source":metadata.campaign?.source, "medium":metadata.campaign?.medium, "campaign":metadata.campaign?.campaign};
    for (const [key, value] of Object.entries(values)) {
      const input = document.getElementById(`f-analytics-${key}`);
      if (!input) continue;
      input.disabled = !value; input.value = value || "";
      if (value) payload[input.name] = value;
      else delete payload[input.name];
    }
  }

  function updateAttachmentLinks() {
    const reference = document.getElementById("f-reference") || document.getElementById("attachment-reference");
    const value = reference ? reference.value.trim().slice(0, 160).replace(/[\r\n]/g, " ") : "";
    const subject = value ? `Transformer specification — ${value}` : "Transformer specification";
    document.querySelectorAll("[data-spec-email]").forEach((link) => {
      link.href = `mailto:${link.dataset.email}?subject=${encodeURIComponent(subject)}`;
    });
  }

  document.addEventListener("click", (event) => {
    const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (link && link.getAttribute("href").startsWith("mailto:")) emit("email_click");
  });
  ["f-reference", "attachment-reference"].forEach((id) => {
    const input = document.getElementById(id);
    if (input) input.addEventListener("input", updateAttachmentLinks);
  });
  updateAttachmentLinks();
  if (productPages[path] || (path === "products.html" && productSections[location.hash])) emit("product_path_view");
  if (path === "products.html") window.addEventListener("hashchange", () => {
    if (productSections[location.hash]) emit("product_path_view");
  });

  const thanks = document.querySelector("[data-inquiry-thanks]");
  if (thanks) {
    try {
      const raw = sessionStorage.getItem(confirmationKey);
      sessionStorage.removeItem(confirmationKey);
      const accepted = raw ? JSON.parse(raw) : null;
      if (accepted && accepted.accepted === true && Number.isFinite(accepted.at) && Date.now() >= accepted.at && Date.now() - accepted.at < 10 * 60 * 1000) {
        document.getElementById("thanks-heading").textContent = "Your request was submitted.";
        document.getElementById("thanks-message").textContent = "Farpoint reviews your requirement and follows up by email. You can send drawings and specifications using the email link below.";
        document.getElementById("thanks-neutral").hidden = true;
      }
    } catch (_) { /* Retain the neutral page if browser storage is unavailable. */ }
  }

  if (!form) return;
  const params = new URLSearchParams(location.search);
  function setPrefill(key, element, values) {
    const value = params.get(key);
    // Ambiguous repeated values and unrecognized content are not propagated.
    if (params.getAll(key).length === 1 && values.has(value)) {
      element.value = value;
      if (element.type === "hidden") element.disabled = false;
    }
  }
  setPrefill("product", document.getElementById("f-product"), products);
  setPrefill("application", document.getElementById("f-application"), applications);
  setPrefill("source", document.getElementById("f-source"), publicSources);
  setPrefill("campaign", document.getElementById("f-campaign"), publicCampaigns);

  const category = document.getElementById("f-product");
  const configuration = document.getElementById("f-configuration");
  const configurationHint = document.getElementById("f-configuration-hint");
  const configurationSummary = document.getElementById("configuration-summary");
  const defaultConfigurationHint = configurationHint.textContent;
  // The generated options share the Products table's source. No free-form
  // query value is accepted, and a reference never fills electrical inputs.
  const references = new Set(Array.from(configuration.options, option => option.value).filter(Boolean));
  if (category.value !== "distribution") {
    setPrefill("reference", configuration, references);
    if (configuration.value) category.value = "power";
  }
  function syncConfiguration() {
    const distribution = category.value === "distribution";
    if (distribution) configuration.value = "";
    configuration.disabled = distribution;
    configurationHint.textContent = distribution
      ? "Distribution transformers are specified to your requirements; no power-transformer reference selection is needed."
      : defaultConfigurationHint;
    const selected = Array.from(configuration.options).find(option => option.value === configuration.value && references.has(option.value));
    configurationSummary.textContent = selected ? `Starting from: ${selected.textContent}. Final design follows your specification.` : "";
    configurationSummary.hidden = !selected;
  }
  category.addEventListener("change", syncConfiguration);
  configuration.addEventListener("change", () => {
    if (references.has(configuration.value)) category.value = "power";
    syncConfiguration();
    if (references.has(configuration.value)) track("reference_select", {reference_id:configuration.value});
  });
  syncConfiguration();
  if (references.has(configuration.value)) track("reference_select", {reference_id:configuration.value});
  form.querySelectorAll("details.optional-fields").forEach(details => details.addEventListener("toggle", () => {
    if (details.open) track("technical_details_open", {location_code:"quotation"});
  }));

  let started = false;
  function start() {
    if (!started) { started = true; emit("rfq_start"); }
  }
  form.addEventListener("focusin", start);
  form.addEventListener("input", start);
  form.addEventListener("invalid", (event) => {
    const input = event.target;
    track("quotation_validation_error", {error_category:input.type === "number" ? "invalid_number" : "required_field", location_code:"quotation"});
    const details = input.closest("details");
    if (details) details.open = true;
    const error = document.getElementById(`${input.id}-error`);
    if (error) { error.textContent = input.validationMessage; error.hidden = false; }
    input.setAttribute("aria-invalid", "true");
  }, true);
  form.addEventListener("input", (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement || input instanceof HTMLSelectElement)) return;
    input.setCustomValidity("");
    input.removeAttribute("aria-invalid");
    const error = document.getElementById(`${input.id}-error`);
    if (error) { error.textContent = ""; error.hidden = true; }
  });

  // Unsupported browsers keep native form submission and native validation.
  if (!window.fetch || !window.FormData || !window.AbortController) return;
  const button = document.getElementById("quote-submit");
  const status = document.getElementById("quote-status");
  let state = "ready";
  const fieldStates = new Map();
  function freezeFields() {
    for (const field of form.querySelectorAll("input, select, textarea")) {
      if (field.type === "hidden") continue;
      fieldStates.set(field, field.disabled);
      field.disabled = true;
    }
  }
  function restoreFields() {
    for (const [field, disabled] of fieldStates) field.disabled = disabled;
    fieldStates.clear();
  }
  function setStatus(message, kind) {
    status.textContent = message;
    if (kind === "failed" || kind === "uncertain") {
      const email = document.createElement("a");
      email.href = "mailto:quotes@farpointenergy.com";
      email.textContent = "quotes@farpointenergy.com";
      status.append(" Email your requirement directly to ", email, kind === "uncertain"
        ? " and mention that the form’s status was uncertain."
        : ".");
    }
    status.dataset.state = kind;
    status.hidden = false;
  }
  function finish(kind, message) {
    state = kind;
    form.removeAttribute("aria-busy");
    if (kind !== "accepted") restoreFields();
    button.disabled = kind === "accepted";
    button.textContent = kind === "accepted" ? "Request submitted" : kind === "uncertain" ? "Retry request" : "Send request";
    setStatus(message, kind);
    status.focus();
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (state === "sending" || state === "accepted") return;
    for (const id of ["f-name", "f-company", "f-requirement"]) {
      const input = document.getElementById(id);
      input.setCustomValidity(input.value.trim() ? "" : "Please enter this required information.");
    }
    if (!form.reportValidity()) return;
    start();
    state = "sending";
    button.disabled = true;
    button.textContent = "Sending…";
    form.setAttribute("aria-busy", "true");
    setStatus("Sending your request. Please keep this page open.", "sending");
    const payload = Object.fromEntries(new FormData(form).entries());
    // Unit-only values do not represent a supplied electrical requirement.
    for (const [valueKey, unitKey] of [["Rating value", "Rating unit"], ["Primary voltage value", "Primary voltage unit"], ["Secondary voltage value", "Secondary voltage unit"]]) {
      if (!payload[valueKey]) delete payload[unitKey];
    }
    const reference = document.getElementById("f-reference").value.trim().replace(/[\r\n]/g, " ").slice(0, 160);
    if (reference) payload._subject = `Quotation request — ${reference}`;
    try { correlate(payload); } catch (_) { /* Correlation must never prevent a request. */ }
    track("quotation_attempt", {location_code:"quotation"});
    // Freeze only after taking the payload snapshot, so a successful response
    // cannot discard edits made while the request is in flight.
    freezeFields();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
      const response = await fetch(form.dataset.ajaxAction, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
        credentials: "omit",
        referrerPolicy: "strict-origin"
      });
      const result = await response.json();
      const accepted = result && typeof result === "object" ? result.success : null;
      if (response.ok && (accepted === true || accepted === "true")) {
        finish("accepted", "Your request was submitted. Farpoint reviews your requirement and follows up by email. Send supporting files using the email link above.");
        emit("rfq_submit_success");
        try {
          // Store confirmation state only; never store the inquiry contents.
          sessionStorage.setItem(confirmationKey, JSON.stringify({ accepted: true, at: Date.now() }));
          location.assign(form.dataset.thanks);
        } catch (_) { /* The inline confirmation remains available. */ }
      } else if (accepted === false || accepted === "false") {
        track("quotation_transport_error", {error_category:"provider_rejected", location_code:"quotation"});
        finish("failed", "The form service reported that it could not accept your request. Your entries are still here. You can try again.");
      } else {
        track("quotation_transport_error", {error_category:"malformed_response", location_code:"quotation"});
        finish("uncertain", "We could not confirm submission. Your request may still arrive. Your entries are still here, and you can retry.");
      }
    } catch (error) {
      track("quotation_transport_error", {error_category:error && error.name === "AbortError" ? "transport_timeout" : error instanceof SyntaxError ? "malformed_response" : "transport_error", location_code:"quotation"});
      finish("uncertain", "The connection ended before we could confirm submission. Your request may still arrive. Your entries are still here, and you can retry.");
    } finally {
      clearTimeout(timer);
    }
  });
})();
