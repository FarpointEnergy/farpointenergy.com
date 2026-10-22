# Farpoint Energy — website content. Edit here, then `python3 build.py`.
SITE = dict(
    name="Farpoint Energy", domain="https://farpointenergy.com",
    email="quotes@farpointenergy.com", founder_email="karan@farpointenergy.com",
    phone="+1 (217) 417-9345", phone_raw="+12174179345", city="New York, NY",
    form_action="https://formsubmit.co/quotes@farpointenergy.com",
)

HERO = dict(
    eyebrow="Power and distribution transformers",
    h1="Power and distribution transformers, engineered to your specification.",
    sub="Generator step-up, substation, main power and distribution transformers for utilities, energy projects, data centers and industry. Engineered to your requirements, delivered to site, and backed by Farpoint's three-year warranty.",
    strip=["POWER & DISTRIBUTION", "ENGINEERED TO ORDER", "3-YEAR WARRANTY", "SITE DELIVERY"],
)

ETO = dict(
    h="Engineered to order",
    p="Every Farpoint unit is designed to the buyer's specification and the applicable utility and site requirements. Send your specification or describe the requirement; the quotation identifies the offered configuration, compliance and technical exceptions.",
)

# Power-family reference ranges for design inquiries. Columns: family, kV class (HV), MVA, BIL, notes
CAPABILITY = [
    ("Main power transformers", "69 – 230 kV", "10 – 250 MVA", "350 – 900 kV", "Renewable and storage interconnections; 34.5 kV low side is a reference option; inverter duty reviewed against applicable IEEE C57.110 and C57.159 requirements"),
    ("Generator step-up", "69 – 230 kV", "10 – 250 MVA", "350 – 900 kV", "Renewable, storage, and thermal generation; impedance to your system study"),
    ("Substation transformers", "69 – 230 kV", "10 – 250 MVA", "350 – 900 kV", "Utility, industrial, and data-center substations; 4.16 – 34.5 kV low-side reference range; on-load tap changers and dual secondaries as specified"),
    ("Auto transformers", "115 / 138 / 161 / 230 kV", "to 250 MVA", "550 – 900 kV", "Transmission interconnection; tertiary windings for reactive support or station service"),
    ("Special duty", "to 230 kV", "per project", "per project", "Ester-filled units, furnace and rectifier duty, replacement units built to an existing nameplate and footprint"),
]
CAP_NOTE = "Power-family reference ranges for design inquiries. The quotation confirms the offered rating, voltage class and insulation level against the project specification; other requirements can be reviewed. MVA ranges are stated at the top cooling stage."

STANDARD = dict(
    h="FP-MPT reference configurations",
    p="Four reference configurations for solar and storage interconnections at 115 and 138 kV. The 30 / 40 / 50 and 60 / 80 / 100 MVA sequences are cooling-stage ratings of individual units. Loading, power factor, utility requirements and site conditions determine the final specification.",
    lineup=[("FP-MPT-138-50", "30 / 40 / 50 MVA", "138 kV · 650 kV BIL", "34.5 kV · 200 kV BIL"),
            ("FP-MPT-115-50", "30 / 40 / 50 MVA", "115 kV · 550 kV BIL", "34.5 kV · 200 kV BIL"),
            ("FP-MPT-138-100", "60 / 80 / 100 MVA", "138 kV · 650 kV BIL", "34.5 kV · 200 kV BIL"),
            ("FP-MPT-115-100", "60 / 80 / 100 MVA", "115 kV · 550 kV BIL", "34.5 kV · 200 kV BIL")],
    common="Reference basis: 60 Hz · ONAN/ONAF/ONAF three-stage cooling · 65 °C rise · DETC ±2 × 2.5 % · mineral oil · IEEE C57.12.00 and C57.12.90 design and test basis, with exact requirements confirmed in the technical response.",
    options="Configuration options: on-load tap changer, natural-ester fluid, reduced BIL with surge protection reviewed for insulation coordination, composite bushings, low-sound design, monitoring package, project spare-unit arrangements, extended warranty.",
    catalog_note="These reference configurations are starting points for design review, not stocked inventory or reserved production slots. The quotation defines the equipment supplied and its delivery schedule.",
)

APPLICATIONS = [
    dict(id="utilities", name="Utilities",
         lead="Substation, auto and distribution transformers built to your standard specification.",
         body="Utility purchases run on a standard specification and an approval cycle. The quotation answers your specification clause by clause; outline, nameplate, control schematics, CT curves and bushing drawings are submitted as applicable, with review time built into the schedule. Taps, impedance and grounding are set for the system and loading requirements."),
    dict(id="solar", name="Utility-scale solar",
         lead="Main interconnection and medium-voltage transformer packages for solar projects.",
         body="Solar output varies with irradiance, site conditions and the plant operating limits. For main interconnection transformers, loading and power factor guide the MVA rating and cooling stages; natural and forced cooling are selected for that duty. Medium-voltage transformer packages connect inverter blocks to the collector system, with voltage, impedance, grounding and harmonic requirements matched to the equipment and system studies."),
    dict(id="storage", name="Battery storage",
         lead="Main power and medium-voltage transformers for standalone and hybrid storage.",
         body="Storage transformers carry charging and discharging duty, which can involve repeated periods at high load. The operating cycle, ambient conditions and inverter harmonics inform thermal margin, conductor design and cooling. Both main interconnection transformers and medium-voltage equipment packages are specified for that duty; monitoring can be added so the operator can follow the unit's condition from the control room."),
    dict(id="hybrid", name="Hybrid solar + storage",
         lead="Main interconnection and medium-voltage packages for generating and charging.",
         body="Solar and a battery may share a point of interconnection, with separate transformer packages for their equipment blocks. Export limits, simultaneous operating cases and grid charging determine the duty of the main transformer and each medium-voltage package. Both generating and charging cases go into the design, and unit quantities and delivery phases can follow the project build-out."),
    dict(id="datacenter", name="Data centers",
         lead="Incoming substation and downstream distribution transformers for phased campus delivery.",
         body="A data-center campus can combine sustained demand with changing loads as equipment and halls come online. Incoming substation transformers serve the utility connection; downstream distribution transformers supply the voltage levels required across the site. Ratings, quantities and delivery phases follow the electrical design and construction sequence. On-load tap changers, sound limits and monitoring are included where the package calls for them."),
    dict(id="industrial", name="Industrial",
         lead="Power and distribution transformers for plants and process loads.",
         body="Industrial loads can bring motor starting, harmonic content from drives and duty that runs around the clock. Each unit is engineered to the plant's load profile, fault levels and relaying scheme, with the accessories and interfaces your protection engineer specifies."),
    dict(id="wind", name="Wind",
         lead="Collector step-up transformers for onshore wind projects.",
         body="Wind output arrives in long, variable runs with periods at full load. The collector transformer is rated for sustained output at the collector voltage, with the impedance and low-side grounding set to the collector system study and the interconnecting utility's requirements."),
    dict(id="replacement", name="Replacement and spares",
         lead="Replacement units and spare programs for operating fleets.",
         body="A failed unit or an aging fleet needs a replacement that fits the existing installation. Nameplate ratings, footprint, terminal positions and transport access guide the replacement design. Spare-unit programs, production timing and any storage arrangements are agreed for the fleet and project."),
]

BASE = dict(
    h="Manufacturing base",
    intro="Farpoint units are built across a qualified manufacturing base of established power and distribution transformer plants, selected and audited by Farpoint, with every unit engineered, inspected, and tested under Farpoint's program.",
    facts=[
        ("One contract", "Farpoint responsibility through delivery and warranty"),
        ("Plant access", "audits, inspection points and factory tests"),
        ("Design review", "electrical, mechanical and site requirements"),
        ("Traceability", "material records and unit documentation"),
    ],
    lines=[
        "Plants equipped with heavy-lifting equipment, drying facilities, and dedicated high-voltage test bays.",
        "Factory testing capabilities include impulse, partial-discharge, temperature-rise, and frequency-response measurements.",
        "Short-circuit design verification uses engineering calculations and applicable independent type-test reports.",
        "Units built to the applicable IEEE/ANSI C57, IEC 60076 or specified regional standards and project requirements, with documented quality controls and material traceability.",
        "Product breadth across power, generator step-up, auto and distribution transformers, including inverter-duty, ester-filled and other special-duty designs.",
    ],
    model_h="How Farpoint works",
    model="Farpoint designs each unit to your specification, qualifies and audits the plants that build it, sets the inspection hold points, witnesses the agreed factory tests, and carries the contract and warranty. Delivery and site services follow the order's scope. You deal with Farpoint from quotation to service.",
)

QUALITY = dict(
    test_scope="The detailed program below covers tests and records considered for power-transformer orders. Distribution transformers use the tests applicable to their design and specified standard. The agreed plan identifies required measurements, design evidence and additional tests for each package.",
    itp_scope="The stages below illustrate a liquid-filled power-transformer inspection plan. Equipment-specific plans identify the applicable stages and mark each point hold, witness or review.",
    site_scope="Site services and measurements are selected for the equipment, transport condition and agreed commissioning scope.",
    standards_scope="The applicable standards, editions and technical exceptions are identified in the quotation. The references below are selected according to product, voltage class, duty and supplied accessories.",
    h="Engineered, inspected, and tested for the duty",
    blocks=[
        ("Engineering", "Engineering review covers short-circuit withstand, thermal duty and insulation coordination against the applicable IEEE C57 or project requirements. Design calculations, including finite-element analysis where required, support the proposed design. Drawings, nameplate and test plan are issued for the specified buyer and utility approvals before the relevant production stages."),
        ("Inspection", "A stage-gated inspection and test plan with hold, witness and review points is issued for your sign-off before production. For liquid-filled power units, stages include core build, winding, assembly, drying and oil processing. Core steel, conductor and insulation traceability is included in the plan. Your inspector is welcome at the agreed hold and witness points."),
        ("Testing", "Factory tests verify the ordered transformer against its specification and applicable standard. The test plan defines the required electrical, dielectric and functional checks, supporting design tests, and any additional measurements. Buyer witness points are scheduled with your engineer at order."),
        ("Documentation", "Test reports, final drawings and the operating and maintenance manual form the digital dossier, kept by serial number. Oil certificates, frequency-response and dissolved-gas baselines, impact-recorder logs and commissioning reports are included where applicable to the equipment and supplied scope."),
    ],
    tests=[
        ("Factory measurements and checks — scope set for the equipment", [
            ("Winding resistance", "Specified windings and tap positions"), ("Ratio, polarity, and phase relation", "Specified tap positions and connections"),
            ("No-load loss and excitation current", "At rated voltage; 110 % excitation where required"), ("Load loss and impedance", "At rated current and specified taps and cooling-stage ratings"),
            ("Zero-sequence impedance", "Where specified for grounded-wye systems and relay settings"), ("Applied-voltage test", "Low-frequency dielectric; test levels for the specified insulation class"),
            ("Induced-voltage test with partial discharge", "Partial-discharge measurement, enhancement and one-hour levels where required by the selected test procedure"),
            ("Lightning impulse", "Full and chopped wave where required, at the specified terminals and test levels"), ("Insulation power factor and resistance", "Windings and bushings; C1 / C2 measurements where applicable"),
            ("Core ground insulation", "Core-to-ground and core-to-frame"), ("Leak and pressure test", "Liquid-filled tanks and radiators, as applicable"),
            ("Sweep-frequency response baseline", "When specified: reference fingerprint before shipment, compared at site"),
            ("Oil tests", "For liquid-filled equipment: specified dielectric strength, moisture, power factor, corrosive sulfur, furans and DGA tests; pre- and post-dielectric samples where required"),
            ("Current transformers", "Where fitted: ratio, polarity and excitation"), ("Functional checks", "Cooling, controls, alarms, and LTC operation where fitted"),
        ]),
        ("Design tests — applicable reports or project testing", [
            ("Temperature rise", "Specified cooling stages; repeated on individual units when required"), ("Audible sound", "Applicable sound standard and project limits; NEMA TR-1 where specified; unit repeat tests when required"),
            ("Lifting, jacking, and transport fixtures", "Mechanical verification"),
        ]),
        ("Other — when specified", [
            ("Short-circuit withstand verification", "Test or calculation and similar-design evidence to the agreed specification; IEEE C57.12.90 and finite-element force analysis where applicable"),
            ("Radio-influence voltage", "Corona check on bushings and terminals"), ("Extended temperature-rise or sound program", "Per your specification"),
        ]),
    ],
    itp=["Material receipt: core steel, conductor and insulation traceability", "Core stacking complete", "Winding completion, each winding", "Core-and-coil assembly, before drying", "Vacuum drying end point: moisture and dew point", "Tanking and oil filling under vacuum", "Final assembly and pre-test checks", "Factory acceptance test — agreed buyer witness points", "Packing, specified transport monitoring and release for shipment"],
    site=["Receiving inspection and any impact-recorder review", "For gas-shipped units: dew-point and oxygen check before oil filling", "SFRA compared with the factory baseline where specified", "Pre-energization tests for the equipment; IEEE C57.152 where applicable", "DGA at energization and after the first month of service when included in the site program"],
    standards="IEEE C57.12.00 · C57.12.10 · C57.12.90 · C57.91 · C57.110 · C57.159 · C57.104 · C57.149 · C57.152 · C57.106 · C57.147 · C57.19.00 · C57.13 · C57.131 · C57.93 · IEEE 693 · NEMA TR-1 · ASTM D3487",
    interfaces="Power-transformer interface examples: multi-ratio bushing current transformers, relay accuracy class C800 where specified, neutral CT on grounded-wye windings · control power 125 V DC and 120/240 V AC, 480 V for cooling where required · alarm and trip contacts for temperature, pressure, liquid level and gas · DNP3 or IEC 61850 monitoring options · approval package: outline, nameplate, control schematics, CT curves and bushing drawings as applicable. Distribution-package interfaces are set by the installation and equipment specification.",
)

DELIVERY = dict(
    intro="Lead time is quoted for the configuration, quantity and project schedule. The delivery date, including engineering, testing and transport, is agreed in the order. Required delivery to site and target energization are tracked separately, with phased shipments arranged where the project requires them.",
    stages=[("Order", "Purchase order; configuration, production schedule and delivery milestones agreed"),
            ("Engineering", "Drawings for approval; long-lead materials committed. Monthly order status reports from here to delivery: engineering, materials, production, test, transit"),
            ("Production", "Core, windings and assembly; drying and oil processing as required by the design"),
            ("FAT", "Agreed factory test program and buyer witness points; test report reviewed before release"),
            ("Transport", "Packing and transport monitoring as specified; delivery to the agreed site or delivery point"),
            ("Site", "Offloading, assembly, oil filling, site tests and commissioning as included in the project scope")],
    warranty_h="Three years, from energization",
    warranty="Every unit ships with a Farpoint warranty of 36 months from energization, covering materials, workmanship, and design. The unit is stored to Farpoint's storage procedure before energization. Repair or replacement is at Farpoint's cost, including transport and site labor. The warranty is assignable to your lender or a successor owner. Coverage extends to five years from energization as an option.",
    service=["Losses designed to your loss-evaluation factors, with guaranteed values and applicable tolerances in the quotation",
             "Named service contact assigned at order; response arrangements agreed for the project",
             "On-site technician support arranged for the project location and service requirements",
             "Field oil handling, testing, diagnostics and repair arranged according to project requirements",
             "Spare bushings, gaskets, fans and controls identified for the unit; stocking arrangements agreed per order",
             "Replacement-parts and service records managed by unit serial number"],
)

QUOTE = dict(
    h="Request a quotation",
    sub="Send what you have: a reference configuration, a specification or a project outline.",
    ways=[("Start from a reference configuration", "Choose an FP-MPT power-transformer reference in the form as an optional starting point. Final configuration follows your project requirements. For a custom power transformer or distribution package, describe what you need."),
          ("Send your specification", "Your transformer specification and data sheet, or your utility's, for power or distribution equipment. The quotation answers the applicable requirements clause by clause."),
          ("Send your single-line and site data", "Early in development? Send the single-line diagram or project outline, site conditions and delivery window; we clarify the transformer requirement and prepare a proposal.")],
    send=["Single-line diagram, equipment schedule or project outline",
          "Transformer rating in kVA or MVA, voltages and quantity, if known",
          "Your or your utility's transformer specification",
          "Duty profile; plant MW and power factor where relevant",
          "Site data (altitude, ambient, seismic), project location and required delivery window"],
    back="What comes back: a quotation with the proposed configuration, price and scope, a compliance response against your specification, and a proposed delivery schedule. Testing, documentation and warranty terms are included. Farpoint engineering reviews the technical response before it is sent; delivery commitments are agreed in the order.",
)

ABOUT = dict(
    h="Farpoint Energy",
    intro="Farpoint Energy supplies power and distribution transformers for the US grid and the sites it serves: main power transformers for renewable and storage interconnections, generator step-up, substation and auto transformers, and distribution packages for utility, data-center and industrial projects. Farpoint is based in New York.",
    founder_name="Karan Uppal", founder_title="Founder",
    founder="Before Farpoint, Karan was Chief Technology Officer at EvolutionIQ, a New York AI company, where he built and ran the engineering organization. He started Farpoint to bring the same operating discipline to grid equipment: committed dates, clear specifications, and one accountable supplier.",
    advisors="Farpoint's engineering advisors have designed and tested power transformers to 400 kV for more than three decades.",
)

PRODUCT_SUMMARY = [
    ("Power transformers", "Main power, generator step-up, substation and auto transformers for grid and large-load projects.", "power"),
    ("Distribution transformers", "Site distribution and medium-voltage packages for data centers, solar, storage and industry.", "distribution"),
]

DISTRIBUTION = dict(
    h="Distribution and medium-voltage transformers",
    intro="Site-distribution and medium-voltage transformer packages connect facility loads, inverter blocks and storage equipment to the site's electrical system. The transformer configuration follows the equipment duty and installation requirements.",
    choices=[
        ("Ratings and voltages", "kVA or MVA rating, voltage ratio and frequency are selected for the connected equipment and operating duty. Multiple unit types and quantities can form one project package."),
        ("Installation and terminals", "Padmounted and other installation arrangements are reviewed against the site's layout, access and connection requirements."),
        ("Insulation and cooling", "Insulation medium, cooling, temperature rise and sound requirements follow the load profile, site environment and installation specification."),
        ("Electrical configuration", "Winding connections, impedance, taps, losses and grounding are specified for the system. Inverter-associated units also account for the defined harmonic and operating requirements."),
        ("Accessories and interfaces", "Protection, monitoring, terminal arrangements and accessories are selected for the equipment package and its interfaces."),
        ("Quantities and delivery phases", "Unit quantities and delivery groups can follow the construction sequence, with package identification carried through drawings, testing and shipment."),
    ],
    uses=["Data-center downstream distribution", "Solar inverter and collector-system packages", "Storage equipment and site-distribution packages", "Utility and industrial distribution"],
)
