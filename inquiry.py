"""Accessible quotation markup for the static site generator."""

from html import escape
from urllib.parse import quote
from content import STANDARD


PRODUCT_VALUES = {"power", "distribution", "unsure"}
APPLICATION_VALUES = {"data-center", "solar", "storage", "hybrid", "utility", "industrial", "other"}
PRODUCT_OPTIONS = (
    {"value": "power", "name": "Power transformers"},
    {"value": "distribution", "name": "Distribution transformers"},
)
APPLICATION_OPTIONS = (
    {"value": "data-center", "name": "Data centers"},
    {"value": "solar", "name": "Solar"},
    {"value": "storage", "name": "Battery storage"},
    {"value": "hybrid", "name": "Hybrid solar + storage"},
    {"value": "utility", "name": "Utilities"},
    {"value": "industrial", "name": "Industrial"},
    {"value": "other", "name": "Other"},
)
REFERENCE_OPTIONS = tuple(
    {"value": code, "name": f"{primary.split(' kV')[0]} / {secondary.split(' kV')[0]} kV · {rating} — {code}"}
    for code, rating, primary, secondary in STANDARD["lineup"]
)


def _options(items, allowed, default):
    """Use the shared public labels while retaining stable submission values."""
    options = []
    seen = set()
    for item in items:
        value = item.get("value", item.get("application", item.get("id", "")))
        label = item.get("label", item.get("name", value))
        if value == "other":
            label = "Other"
        if value in allowed and value not in seen:
            selected = " selected" if value == default else ""
            options.append(f'<option value="{escape(value, quote=True)}"{selected}>{escape(label)}</option>')
            seen.add(value)
    return "".join(options)


def render_form(site, product_categories=None, applications=None):
    """Render a native POST form with optional progressive enhancement."""
    email = escape(site["email"], quote=True)
    action = escape(site["form_action"], quote=True)
    ajax_action = escape(site["form_action"].replace("https://formsubmit.co/", "https://formsubmit.co/ajax/", 1), quote=True)
    mailto = f'mailto:{email}?subject={quote("Transformer specification")}'
    products = _options(PRODUCT_OPTIONS if product_categories is None else product_categories, PRODUCT_VALUES - {"unsure"}, "")
    apps = _options(APPLICATION_OPTIONS if applications is None else applications, APPLICATION_VALUES, "")
    references = _options(REFERENCE_OPTIONS, {item["value"] for item in REFERENCE_OPTIONS}, "")
    return f'''<div class="formbox">
<form id="quote-form" class="q" action="{action}" method="POST" data-ajax-action="{ajax_action}" data-thanks="thanks.html">
<input type="hidden" name="_subject" value="Quotation request — farpointenergy.com">
<input type="hidden" name="_template" value="table">
<input type="hidden" name="_captcha" value="false">
<div hidden aria-hidden="true"><label for="f-honey">Leave this field empty</label><input id="f-honey" type="text" name="_honey" tabindex="-1" autocomplete="off"></div>
<input type="hidden" id="f-source" name="Source" value="" disabled>
<input type="hidden" id="f-campaign" name="Campaign" value="" disabled>
<p id="configuration-summary" class="small full" role="status" aria-live="polite" aria-atomic="true" hidden></p>
<div class="field"><label for="f-name">Name <span class="field-hint">(required)</span></label><input id="f-name" name="Name" required autocomplete="name" maxlength="160" aria-describedby="f-name-error"><p class="field-error" id="f-name-error" hidden></p></div>
<div class="field"><label for="f-company">Company <span class="field-hint">(required)</span></label><input id="f-company" name="Company" required autocomplete="organization" maxlength="200" aria-describedby="f-company-error"><p class="field-error" id="f-company-error" hidden></p></div>
<div class="field full"><label for="f-email">Email <span class="field-hint">(required)</span></label><input id="f-email" name="email" type="email" required autocomplete="email" maxlength="254" aria-describedby="f-email-error"><p class="field-error" id="f-email-error" hidden></p></div>
<div class="field full"><label for="f-requirement">Requirement or specification link <span class="field-hint">(required)</span></label><textarea id="f-requirement" name="Requirement or specification link" required rows="4" maxlength="20000" placeholder="Describe the transformer package or paste a specification link." aria-describedby="f-requirement-hint f-requirement-error"></textarea><p id="f-requirement-hint" class="small muted">For cooling-stage ratings, mixed transformer types or phased quantities, describe each unit here or share an equipment schedule. Leave single-value fields blank when they do not apply.</p><p class="field-error" id="f-requirement-error" hidden></p></div>
<div class="field"><label for="f-product">Transformer category <span class="field-hint">(optional)</span></label><select id="f-product" name="Transformer category"><option value="unsure" selected>Not sure</option>{products}</select></div>
<div class="field"><label for="f-application">Application <span class="field-hint">(optional)</span></label><select id="f-application" name="Application"><option value="" selected>Not sure</option>{apps}</select></div>
<div class="field full"><label for="f-configuration">Power-transformer reference configuration <span class="field-hint">(optional)</span></label><select id="f-configuration" name="Power-transformer reference configuration" aria-describedby="f-configuration-hint"><option value="" selected>Custom requirement / not sure</option>{references}</select><p id="f-configuration-hint" class="small muted">An optional starting point for power-transformer design review. Your project requirements determine the final specification.</p></div>
<details class="optional-fields full"><summary>Project and technical details (optional)</summary>
<div class="optional-grid">
<div class="field"><label for="f-quantity">Quantity</label><input id="f-quantity" name="Quantity" type="number" inputmode="numeric" min="1" step="1" placeholder="Number of units" aria-describedby="f-quantity-error"><p class="field-error" id="f-quantity-error" hidden></p></div>
<div class="field"><label for="f-rating">Transformer rating</label><div class="unit-pair"><input id="f-rating" name="Rating value" type="number" inputmode="decimal" min="0.001" step="any" placeholder="Rating" aria-describedby="f-rating-error"><select id="f-rating-unit" name="Rating unit" aria-label="Transformer rating unit"><option value="kVA">kVA</option><option value="MVA">MVA</option></select></div><p class="field-error" id="f-rating-error" hidden></p></div>
<div class="field"><label for="f-primary">Primary voltage</label><div class="unit-pair"><input id="f-primary" name="Primary voltage value" type="number" inputmode="decimal" min="0.001" step="any" placeholder="Voltage" aria-describedby="f-primary-error"><select id="f-primary-unit" name="Primary voltage unit" aria-label="Primary voltage unit"><option value="kV">kV</option><option value="V">V</option></select></div><p class="field-error" id="f-primary-error" hidden></p></div>
<div class="field"><label for="f-secondary">Secondary voltage</label><div class="unit-pair"><input id="f-secondary" name="Secondary voltage value" type="number" inputmode="decimal" min="0.001" step="any" placeholder="Voltage" aria-describedby="f-secondary-error"><select id="f-secondary-unit" name="Secondary voltage unit" aria-label="Secondary voltage unit"><option value="kV">kV</option><option value="V">V</option></select></div><p class="field-error" id="f-secondary-error" hidden></p></div>
<div class="field"><label for="f-delivery">Required delivery to site</label><input id="f-delivery" name="Required delivery to site" maxlength="160" placeholder="Date, quarter, range, or not fixed yet" aria-describedby="f-delivery-hint"><p id="f-delivery-hint" class="small muted">When the transformer needs to arrive.</p></div>
<div class="field"><label for="f-energization">Target energization</label><input id="f-energization" name="Target energization" maxlength="160" placeholder="Date, quarter, range, or not fixed yet" aria-describedby="f-energization-hint"><p id="f-energization-hint" class="small muted">When the installation is expected to enter service.</p></div>
<div class="field"><label for="f-location">Project location</label><input id="f-location" name="Project location" maxlength="240" placeholder="City, state, or region"></div>
<div class="field"><label for="f-reference">Project or package reference</label><input id="f-reference" name="Project or package reference" maxlength="160" placeholder="Your project name or RFQ reference"></div>
<div class="field"><label for="f-phone">Phone</label><input id="f-phone" name="Phone" type="tel" autocomplete="tel" maxlength="80"></div>
<div class="field full"><label for="f-details">Additional information</label><textarea id="f-details" name="Additional information" rows="3" maxlength="10000" placeholder="Installation arrangement, duty profile, altitude, ambient or seismic conditions, delivery phases, or other useful details."></textarea></div>
</div></details>
<div class="full form-actions"><button class="btn" type="submit" id="quote-submit">Send request</button><p class="small muted mt">Email drawings and specifications to <a href="{mailto}" data-spec-email data-email="{email}">{email}</a>, using the same project or package reference in the subject.</p><p class="small muted">This form uses FormSubmit to email your inquiry to Farpoint. <a href="privacy.html">Privacy</a>.</p><div id="quote-status" class="form-status" role="status" aria-live="polite" aria-atomic="true" tabindex="-1" hidden></div></div>
<noscript><p class="small full">This form works without JavaScript. After sending, follow the form service’s instructions. You can also send your requirement directly to <a href="mailto:{email}">{email}</a>.</p></noscript>
</form></div>'''


def thanks_content(site):
    """Neutral by default: opening a URL is not evidence of submission."""
    email = escape(site["email"], quote=True)
    mailto = f'mailto:{email}?subject={quote("Transformer specification")}'
    return f'''<section class="hero plain" data-inquiry-thanks><div class="wrap"><div class="eyebrow">Request a quotation</div><h1 id="thanks-heading">Continue your inquiry</h1><p id="thanks-message" class="sub">If you have just sent a request, follow the confirmation shown by the form service. Farpoint reviews submitted requirements and follows up by email.</p></div></section>
<section class="s"><div class="wrap"><p id="thanks-neutral" class="small muted">Opening this page on its own does not confirm that a request was submitted.</p><p>Email drawings and specifications to <a href="{mailto}" data-spec-email data-email="{email}">{email}</a>. Include the same project or package reference used in your request.</p><p><a href="quote.html">Return to the quotation form</a> · <a href="products.html">Explore transformers</a></p></div></section>'''
