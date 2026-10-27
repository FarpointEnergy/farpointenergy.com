/* Synthetic review helper only. No request, submit, or storage is performed here. */
(() => {
  'use strict';
  const form = document.getElementById('quote-form');
  const button = document.getElementById('preview-fill');
  const status = document.getElementById('preview-fill-status');
  if (!form || !button || !status) return;
  const requiredQuery = {source:'website', campaign:'power', utm_medium:'referral'};
  const params = new URLSearchParams(location.search);
  const prepared = Object.entries(requiredQuery).every(([k,v]) => params.getAll(k).length === 1 && params.get(k) === v)
    && !params.has('utm_source') && !params.has('utm_campaign');
  if (!prepared) {
    button.disabled = true;
    status.textContent = 'Open the prepared test link above to include all eight source and correlation fields.';
    return;
  }
  button.addEventListener('click', () => {
    if (form.getAttribute('aria-busy') === 'true' || document.getElementById('quote-submit')?.disabled) {
      status.textContent = 'A submission is already in progress or accepted. Reload the prepared link for a new test.';
      return;
    }
    const reference = 'FP-SYNTHETIC-REVIEW-' + new Date().toISOString().replace(/[:.]/g,'-');
    const values = {
      'f-name': 'Karan — SYNTHETIC WEBSITE TEST',
      'f-company': 'SYNTHETIC TEST — Farpoint website QA',
      'f-email': 'karan@farpointenergy.com',
      'f-requirement': 'SYNTHETIC END-TO-END TEST ONLY. No commercial quotation or purchase is requested. Verify that all 28 business, source and correlation fields arrive intact. Reference: ' + reference,
      'f-product': 'power',
      'f-application': 'solar',
      'f-configuration': 'FP-MPT-138-50',
      'f-quantity': '2',
      'f-rating': '50',
      'f-rating-unit': 'MVA',
      'f-primary': '138',
      'f-primary-unit': 'kV',
      'f-secondary': '34.5',
      'f-secondary-unit': 'kV',
      'f-delivery': 'Synthetic date: Q3 2027',
      'f-energization': 'Synthetic date: Q4 2027',
      'f-location': 'SYNTHETIC TEST SITE — no actual project location',
      'f-reference': reference,
      'f-phone': '+1 202 555 0147',
      'f-details': 'SYNTHETIC TEST ONLY. Check Unicode (Ω, °C), punctuation, and line breaks.\nTesting, documentation and warranty are fixture text, not a real request.'
    };
    for (const id of Object.keys(values)) if (!document.getElementById(id)) {
      status.textContent = 'The test fixture no longer matches the form. No fields were filled.';
      return;
    }
    for (const [id,value] of Object.entries(values)) {
      const input = document.getElementById(id);
      input.value = value;
      input.dispatchEvent(new Event('input', {bubbles:true}));
      input.dispatchEvent(new Event('change', {bubbles:true}));
    }
    status.textContent = 'Filled 20 synthetic business fields. Source and Campaign come from this prepared link; six correlation fields are added by the normal submit handler. Review the form, then use Send request once. Nothing has been submitted. Test reference: ' + reference;
  });
})();
