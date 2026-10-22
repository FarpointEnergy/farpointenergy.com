/* Progressive enhancement; native HTML POST remains available without JavaScript. */
(() => {
  "use strict";
  const products = new Set(["power", "distribution", "unsure"]);
  const applications = new Set(["data-center", "solar", "storage", "hybrid", "utility", "industrial", "other"]);
  const publicSources = new Set(["website", "homepage", "products", "power-transformers", "distribution-transformers", "applications", "data-centers", "solar-storage", "quality", "delivery", "manufacturing", "about", "email"]);
  const publicCampaigns = new Set(["power", "distribution", "data-center", "solar", "storage", "hybrid", "utility", "industrial", "other"]);
  const confirmationKey = "farpoint-inquiry-accepted";
  const form = document.getElementById("quote-form");
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

  function emit(name) {
    // Disabled unless an approved destination explicitly supplies this callback.
    // No form contents, references, URL parameters, or contact details are sent.
    if (!eventNames.has(name) || typeof window.farpointAnalytics !== "function") return;
    try { window.farpointAnalytics(name, context()); } catch (_) { /* Analytics never blocks an inquiry. */ }
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
  });
  syncConfiguration();

  let started = false;
  function start() {
    if (!started) { started = true; emit("rfq_start"); }
  }
  form.addEventListener("focusin", start);
  form.addEventListener("input", start);
  form.addEventListener("invalid", (event) => {
    const input = event.target;
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
    button.disabled = kind !== "failed";
    button.textContent = kind === "accepted" ? "Request submitted" : kind === "uncertain" ? "Submission status uncertain" : "Send request";
    setStatus(message, kind);
    status.focus();
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (state === "sending" || state === "accepted" || state === "uncertain") return;
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
        finish("failed", "The form service reported that it could not accept your request. Your entries are still here. You can try again.");
      } else {
        finish("uncertain", "We could not confirm whether the form service accepted your request. Your entries are still here. To avoid a duplicate, do not submit again yet.");
      }
    } catch (_) {
      finish("uncertain", "The connection ended before we could confirm the result. Your request may have reached the form service, and your entries are still here. To avoid a duplicate, do not submit again yet.");
    } finally {
      clearTimeout(timer);
    }
  });
})();
