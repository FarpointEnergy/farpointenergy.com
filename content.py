# Farpoint Energy — website content. Edit text here; run build.py to regenerate pages.
SITE = dict(
    name="Farpoint Energy", domain="https://farpointenergy.com",
    email="quotes@farpointenergy.com", founder_email="karan@farpointenergy.com",
    phone="+1 (217) 417-9345", phone_raw="+12174179345", city="New York, NY · United States",
    catalog="Farpoint_Energy_Product_Catalog_2026_Solar_Storage_Edition.pdf",
    form_url=None,  # request-a-quotation form embed URL (to be added)
)

HOME = dict(
    eyebrow="Power transformers · United States",
    h1="Power transformers, engineered to your specification.",
    sub="To 250 MVA and 230 kV. Designed and tested to IEEE C57, delivered to site, commissioned, and warranted by Farpoint Energy for three years.",
    strip=["TO 250 MVA · 230 kV", "IEEE C57 DESIGN & TEST", "3-YEAR WARRANTY", "100 UNITS / YEAR CAPACITY"],
    tiles=[("250", "MVA · to 230 kV"), ("100", "units / year capacity"), ("3 yr", "warranty · 5 yr extended"), ("C57", "IEEE design & test")],
    edge_h="One product family, one job at a time.",
    edge=[
        "We build power transformers for the interconnection. The FP-MPT family covers 50 and 100 MW blocks at 115 and 138 kV in four standard configurations, each engineered ahead of time to the requirements interconnecting utilities actually issue — BIL, impedance windows, taps, sound, seismic. A quote comes back as a clause-by-clause compliance matrix, and we're able to commit, when you sign the order, to an actual delivery date.",
        "Beyond the standard line, every unit is engineered to your specification: generator step-up, substation, and auto transformers to 250 MVA and 230 kV, for renewable, storage, data center, industrial, and utility projects.",
    ],
    how_h="How it works",
    how=[
        ("Send what you have", "A configuration from the catalog, your specification, or a single-line diagram and site data. We return a quotation with a compliance matrix."),
        ("Drawings for approval", "Outline, nameplate, and test plan issued to your engineer and interconnecting utility; long-lead materials committed at order."),
        ("Manufacture and witnessed test", "The full IEEE C57.12.90 routine program on every unit. Witnessed FAT is standard."),
        ("Delivery and energization", "Transport to site, assembly, oil filling, site tests, and commissioning. Warranty and field service from Farpoint."),
    ],
)

MARKETS = [
    dict(id="solar", name="Utility-scale solar",
         lead="Main power transformers for the point of interconnection, 30–100 MVA at 115 and 138 kV.",
         body="Solar output builds through the morning and peaks mid-afternoon. The unit runs on natural cooling for most of the day and brings its fans on for the peak. We size it to the megawatts your grid connection allows, with the cooling stages split to follow that daily curve.",
         cta="FP-MPT standard configurations", href="products.html#fp-mpt"),
    dict(id="storage", name="Battery storage",
         lead="Point-of-interconnection transformers for standalone and hybrid storage.",
         body="A battery delivers full power for hours, then recharges at full power, on a daily cycle. The transformer warms and cools with every cycle, and inverter current carries harmonics. The thermal margin and conductor are designed for that duty, and monitoring can be added so you can follow the unit's condition from your control room.",
         cta="FP-MPT standard configurations", href="products.html#fp-mpt"),
    dict(id="hybrid", name="Hybrid PV + storage",
         lead="One grid connection, two duty cases.",
         body="Solar and a battery share one point of interconnection. The transformer carries the combined output and the charging case when the battery draws from the grid. Both cases go into the rating, and sites built in phases can energize the first block early.",
         cta="FP-MPT standard configurations", href="products.html#fp-mpt"),
    dict(id="wind", name="Wind",
         lead="Collector step-up transformers for onshore wind, to 230 kV.",
         body="Wind output arrives in long, variable runs with periods at full load. The collector transformer is rated for sustained output at the collector voltage, with the impedance and low-side grounding set to the collector system study and the interconnecting utility's requirements.",
         cta="Request a quotation", href="quote.html"),
    dict(id="datacenter", name="Data centers",
         lead="Substation transformers for campuses that need power on a construction schedule.",
         body="A data center substation carries a flat, high load with fast growth in steps. Units are rated for the campus build-out, with on-load tap changers for voltage regulation, low-sound designs where permits require them, and monitoring for owners who run condition-based maintenance.",
         cta="Request a quotation", href="quote.html"),
    dict(id="industrial", name="Industrial",
         lead="Step-down transformers for plants and process loads, 69–230 kV.",
         body="Industrial loads bring motor starting, harmonic content from drives, and duty that runs around the clock. Each unit is engineered to the plant's load profile, fault levels, and relaying scheme, with the accessories and interfaces your protection engineer specifies.",
         cta="Request a quotation", href="quote.html"),
    dict(id="utility", name="Utilities",
         lead="Substation and auto transformers to 250 MVA and 230 kV, built to your standard specification.",
         body="Utility purchases run on a standard specification and an approval cycle. Every quotation answers your specification clause by clause; outline, nameplate, control schematics, CT curves, and bushing drawings go to your engineers for approval, with your review time built into the schedule.",
         cta="Request a quotation", href="quote.html"),
    dict(id="replacement", name="Replacement and spares",
         lead="Replacement units and spare programs for operating fleets.",
         body="A failed unit or an aging fleet needs a replacement path shorter than a new-build lead time. We build to the nameplate and footprint of the unit being replaced, and hold reserved production capacity or a stocked spare against fleets that need it.",
         cta="Request a quotation", href="quote.html"),
]

FAMILIES = [
    dict(id="fp-mpt", name="FP-MPT main power transformers", tag="Standard line",
         body="Four standard configurations for 50 and 100 MW interconnection blocks: 30/40/50 and 60/80/100 MVA, 115 and 138 kV high side, 34.5 kV low side, three-stage cooling, inverter duty per IEEE C57.110 and C57.159. Fully specified, with the options interconnecting utilities most often require.",
         detail=True),
    dict(id="gsu", name="Generator step-up transformers", tag="Engineered to order",
         body="Step-up units for renewable, storage, and thermal generation, to 250 MVA and 230 kV. Rated to the generator or inverter output, with impedance to your system study and the low-side connection your collector or generator design calls for.",
         detail=False),
    dict(id="substation", name="Substation transformers", tag="Engineered to order",
         body="Step-down units for utility, industrial, and data center substations, 69–230 kV high side and 4.16–34.5 kV low side, to 250 MVA. On-load tap changers, dual secondaries, and the relaying interfaces your protection scheme specifies.",
         detail=False),
    dict(id="auto", name="Auto transformers", tag="Engineered to order",
         body="Transmission interconnection units between 69, 115, 138, 161, and 230 kV systems, with tertiary windings for reactive support or station service where the system study requires them.",
         detail=False),
]

LINEUP = [
    ("FP-MPT-138-50", "30 / 40 / 50", "138 kV · 650 kV BIL", "34.5 kV · 200 kV BIL", "Up to ~45 MW at the POI"),
    ("FP-MPT-115-50", "30 / 40 / 50", "115 kV · 550 kV BIL", "34.5 kV · 200 kV BIL", "Up to ~45 MW at the POI"),
    ("FP-MPT-138-100", "60 / 80 / 100", "138 kV · 650 kV BIL", "34.5 kV · 200 kV BIL", "Up to ~90 MW at the POI"),
    ("FP-MPT-115-100", "60 / 80 / 100", "115 kV · 550 kV BIL", "34.5 kV · 200 kV BIL", "Up to ~90 MW at the POI"),
    ("Two-unit yards", "2 × 50 or 2 × 100 class", "115 / 138 kV", "34.5 kV", "Larger sites; phased energization by block"),
    ("161 kV variant", "per project", "161 kV", "34.5 kV", "Engineered on request"),
]
COMMON = "Every FP-MPT unit: 60 Hz · ONAN/ONAF/ONAF three-stage cooling · 65 °C average winding rise · 34.5 kV delta low side (wye per project) · DETC ±2 × 2.5 % on the high side · mineral oil · inverter-connected duty per IEEE C57.110 and C57.159 · designed and tested to IEEE C57.12.00 and C57.12.90."

PARAMS = [
    ("Impedance", "To your system study", "Within the IEEE C57.12.10 range on the self-cooled base; values outside it are engineered to order"),
    ("HV BIL", "650 kV at 138 kV · 550 kV at 115 kV", "Reduced one level with surge arresters, where your insulation coordination study supports it"),
    ("LV connection", "34.5 kV delta", "34.5 kV wye with grounding per study; other low-side voltages engineered to order"),
    ("Taps", "DETC on HV, ±2 × 2.5 %, no-load", "On-load tap changer added where the utility requires regulation under load"),
    ("Sound", "NEMA TR-1", "Lower levels by low-sound design or enclosure, to your permit limit"),
    ("Seismic", "IEEE 693 Moderate", "IEEE 693 High with analysis and anchorage qualification"),
    ("Voltage class · rating", "115 / 138 kV · 30–100 MVA", "161 kV on request; other classes and ratings engineered to order"),
]
OPTIONS = [
    ("On-load tap changer", "LTC on HV or LV per study, ±10 % regulating range in 32 steps typical; DETC retained", "Utility requires voltage regulation under load"),
    ("Natural-ester fluid", "Biodegradable, high fire-point fluid per IEEE C57.147 in place of mineral oil", "Fire-safety setbacks, environmental permits"),
    ("Composite bushings", "Silicone-housed HV bushings in place of porcelain", "Seismic zones, coastal or high-contamination sites"),
    ("Low-sound design", "Sound level below NEMA TR-1 by design or enclosure", "Permit limits near residential areas"),
    ("Monitoring package", "Online dissolved-gas analysis, bushing monitoring, digital temperature and cooling control with SCADA points", "Owners running condition-based maintenance"),
    ("Spare-unit program", "Reserved production capacity or a stocked spare held against your operating fleet", "Fleets that need a replacement path shorter than a new-build lead time"),
    ("Extended warranty", "Coverage extended to five years from energization, same service terms", "Lender or owner requirements"),
]
ACCESSORIES = "ANSI outdoor bushings (resin-impregnated HV bushings) · Buchholz relay on conservator units · surge-arrester mounting provisions · control cabinet with cooling and alarm circuits · multi-ratio bushing current transformers (relay classes per project) · sudden-pressure relay · top-oil and winding temperature indicators with alarm/trip contacts · liquid-level gauge · pressure-relief device · dissolved-gas monitoring provision · drain and sampling valves · jacking pads and skid base with provision for rail or trailer transport · grounding pads · nameplate per IEEE C57.12.00."

QUALITY = dict(
    h="Engineered, inspected, and tested to IEEE C57",
    blocks=[
        ("Engineering", "Every design is engineered to IEEE C57 and your utility's requirements, with finite-element short-circuit force, thermal, and insulation-coordination analysis. Drawings, nameplate, and test plan are issued for your engineer's and your utility's approval before production; the calculation package is available for owner's-engineer review."),
        ("Inspection", "A stage-gated inspection and test plan with hold, witness, and review points is issued for your sign-off before production, from core build through winding, assembly, vacuum drying, and oil processing. Core steel, copper, and insulation are traceable by lot."),
        ("Testing", "The full IEEE C57.12.90 routine program on every unit, including partial discharge, full and chopped-wave lightning impulse, and a sweep-frequency-response baseline, performed in an ISO/IEC 17025-accredited high-voltage laboratory. Witnessed FAT is standard; we schedule it with your engineer at order. Third-party inspection witness is available at any hold point."),
        ("Documentation", "Test reports, oil certificates, SFRA and DGA baselines, impact-recorder log, as-built drawings, and the O&M manual are delivered as a serialized digital dossier and kept on file by serial number."),
    ],
    standards=[
        ("Design and ratings", [
            ("IEEE C57.12.00", "General requirements for liquid-immersed transformers: ratings, tolerances, insulation levels, and which tests are routine, design, or other."),
            ("IEEE C57.12.10", "Requirements for power transformers 230 kV and below: standard impedances, tank pressures, bushings, accessories, and nameplate."),
            ("IEEE C57.12.90", "Test code: how every factory test is performed, measured, and judged."),
            ("IEEE C57.91", "Loading guide: how far the unit may be loaded beyond nameplate, and the hot-spot limits behind the rating."),
            ("IEEE C57.110", "Harmonic duty: sizing and derating for the non-sinusoidal currents inverters produce."),
            ("IEEE C57.159", "Transformers for distributed PV: duty, design, and application considerations for inverter-connected units."),
            ("IEEE C57.131", "Load tap changers (option): performance and test requirements."),
            ("IEEE C57.19.00 / .01", "Bushings: performance, dimensions, and test requirements."),
            ("IEEE C57.13", "Instrument transformers: accuracy classes of the bushing current transformers your relays see."),
            ("IEEE 693", "Seismic design of substation equipment. Moderate level is the design basis; High is available with analysis and anchorage qualification."),
            ("NEMA TR-1", "Audible sound levels for liquid-filled transformers."),
        ]),
        ("Fluids, diagnostics, and site", [
            ("ASTM D3487", "Mineral insulating oil: what goes in the tank."),
            ("IEEE C57.106", "Oil acceptance and maintenance: the limits new oil must meet and the limits it must hold in service."),
            ("IEEE C57.147", "Natural-ester fluids (option): acceptance and maintenance."),
            ("IEEE C57.104", "Dissolved-gas analysis: how gas-in-oil results are read to judge the condition of a unit."),
            ("IEEE C57.149", "Sweep-frequency response analysis: the fingerprint that shows whether windings moved in transport or after a fault."),
            ("IEEE C57.152", "Field diagnostics: the tests run at site before energization and during service."),
            ("IEEE C57.93", "Installation of liquid-immersed power transformers: receiving, assembly, oil filling, and energization."),
        ]),
        ("Quality system", [
            ("ISO 9001", "Quality management system under which every unit is engineered, built, and tested."),
            ("ISO/IEC 17025", "Test-laboratory accreditation: calibrated, traceable measurement behind every test report. Certificates and accreditation scope are furnished with the quotation."),
        ]),
    ],
    tests=[
        ("Routine — every unit", [
            ("Winding resistance", "All windings, all taps"), ("Ratio, polarity, and phase relation", "All taps"),
            ("No-load loss and excitation current", "At rated voltage; 110 % excitation"), ("Load loss and impedance", "At rated current, each cooling stage"),
            ("Zero-sequence impedance", "For relay settings on grounded-wye systems"), ("Applied-voltage test", "Low-frequency dielectric"),
            ("Induced-voltage test with partial discharge", "PD measured throughout the enhancement and one-hour levels"),
            ("Lightning impulse", "Full and chopped wave, all line terminals"), ("Insulation power factor and insulation resistance", "Windings and bushings (C1 / C2)"),
            ("Core ground insulation", "Core-to-ground and core-to-frame"), ("Leak and pressure test", "Tank and radiators"),
            ("Sweep-frequency response baseline", "Reference fingerprint before shipment, compared at site"),
            ("Oil tests", "Dielectric strength, moisture, power factor, corrosive sulfur, furans; DGA before and after dielectric tests"),
            ("Current transformers", "Ratio, polarity, excitation"), ("Functional checks", "Cooling, controls, alarms, and LTC operation where fitted"),
        ]),
        ("Design — per design; reports furnished with the quotation", [
            ("Temperature rise", "Each cooling stage; repeated on every unit when specified"), ("Audible sound", "Per NEMA TR-1; repeated on every unit when specified"),
            ("Lifting, jacking, and transport fixtures", "Mechanical verification"),
        ]),
        ("Other — when specified", [
            ("Short-circuit test", "Per IEEE C57.12.90 at an independent laboratory; every design carries a finite-element force calculation and similar-design justification"),
            ("Radio-influence voltage", "Corona check on bushings and terminals"), ("Extended temperature-rise or sound program", "Per your specification"),
        ]),
    ],
    itp=["Material receipt: core steel, copper, insulation — lot traceability", "Core stacking complete", "Winding completion, each winding", "Core-and-coil assembly, before drying", "Vacuum drying end point: moisture and dew point", "Tanking and oil filling under vacuum", "Final assembly and pre-test checks", "Factory acceptance test — witnessed", "Packing, impact recorders, and release for shipment"],
    site=["Impact-recorder review and receiving inspection", "Dew-point and oxygen check before oil filling", "SFRA compared with the factory baseline", "Pre-energization tests per IEEE C57.152", "DGA at energization and after the first month of service"],
    interfaces="Bushing current transformers: multi-ratio, relay accuracy class C800 typical, neutral CT on grounded-wye windings · control power 125 V DC and 120/240 V AC, 480 V for cooling · alarm and trip contacts for temperature, pressure, liquid level, and gas · DNP3 or IEC 61850 on the monitoring package · approval package: outline, nameplate, control schematics, CT curves, and bushing drawings, with your utility's review time built into the schedule.",
    dossier="Certified test report per IEEE C57.12.00 · nameplate data · SFRA and DGA baselines · oil certificates · calibration records · impact-recorder log · as-built drawings · O&M manual · commissioning report. Delivered digitally and kept on file by serial number.",
)

DELIVERY = dict(
    intro="Production capacity for 100 units per year, with additional capacity coming online in 2027. Current lead time for FP-MPT standard configurations is 12–14 months; engineered-to-order units are quoted per project. The delivery date, inclusive of engineering, test, and transport, is committed in the order.",
    stages=[("Order", "Purchase order; production slot reserved, delivery date committed"),
            ("Engineering", "Drawings for approval; long-lead materials committed. Monthly order status reports from here to delivery: engineering, materials, production, test, transit"),
            ("Production", "Core, windings, assembly, vacuum drying, oil processing"),
            ("FAT", "Full routine test program, witnessed; test report issued"),
            ("Transport", "Packing with impact recorders; transport to your site"),
            ("Site", "Offloading, assembly, vacuum oil filling, site tests, and commissioning")],
    warranty_h="Three years, from energization",
    warranty="Every unit ships with a Farpoint warranty of 36 months from energization, with the unit stored to Farpoint's storage procedure before energization, covering materials, workmanship, and design. Repair or replacement is at Farpoint's cost, including transport and site labor. The warranty is assignable to your lender or a successor owner. Coverage extends to five years from energization as an option.",
    service=["Quotations optimized to your loss-evaluation factors; losses guaranteed within IEEE C57.12.00 tolerances",
             "Named service engineer assigned at order; 24/7 contact",
             "Technician on site within 72 hours, contiguous US",
             "Field oil handling, testing, diagnostics, and repair",
             "Spare bushings, gaskets, fans, and controls stocked against your fleet",
             "Parts support for the life of the unit"],
)

QUOTE = dict(
    h="Request a quotation.",
    sub="Pick a configuration, send your specification, or send a single-line diagram and site data. We return a quotation and compliance matrix for your project.",
    ways=[("Pick a configuration", "Choose the FP-MPT configuration that fits your block and tell us the project values — impedance, low-side connection, BIL, taps. We quote it."),
          ("Send your specification", "Your standard transformer specification and data sheet, or your utility's. We return a quotation with a clause-by-clause compliance matrix."),
          ("Send your single-line and site data", "Early in development? Send the single-line diagram, site conditions, and delivery window; we propose the configuration and quote it.")],
    send=["Single-line diagram", "MW and power factor at the point of interconnection", "Your or your utility's transformer specification", "Duty profile for storage", "Site data (altitude, ambient, seismic) and delivery window"],
)

ABOUT = dict(
    h="Farpoint Energy",
    body=[
        "Farpoint Energy builds power transformers for the US grid: main power transformers for renewable and storage interconnections, and generator step-up, substation, and auto transformers to 250 MVA and 230 kV for data center, industrial, and utility projects.",
        "Every unit is engineered to IEEE C57 and the buyer's specification, tested in full before it ships, delivered to site, commissioned, and covered by a three-year warranty with field service from Farpoint. Farpoint Energy is based in New York.",
    ],
)
