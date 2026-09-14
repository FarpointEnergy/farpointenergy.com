# Farpoint Energy — website content. Edit here, then `python3 build.py`.
SITE = dict(
    name="Farpoint Energy", domain="https://farpointenergy.com",
    email="quotes@farpointenergy.com", founder_email="karan@farpointenergy.com",
    phone="+1 (217) 417-9345", phone_raw="+12174179345", city="New York, NY",
    form_action="https://formsubmit.co/quotes@farpointenergy.com",
)

HERO = dict(
    eyebrow="Power transformers",
    h1="Power transformers, engineered to your specification.",
    sub="Generator step-up, substation, auto, and main power transformers to 250 MVA and 230 kV. Designed and tested to IEEE C57, delivered to site, commissioned, and warranted by Farpoint Energy for three years.",
    strip=["TO 250 MVA · 230 kV", "IEEE C57 DESIGN & TEST", "3-YEAR WARRANTY", "100 UNITS / YEAR"],
)

ETO = dict(
    h="Engineered to order",
    p="Every Farpoint unit is designed to the buyer's specification and the interconnecting utility's requirements. Send your specification, or your utility's, and the quotation comes back with a clause-by-clause compliance matrix.",
)

# Capability ranges — family level. Columns: family, kV class (HV), MVA, BIL, notes
CAPABILITY = [
    ("Main power transformers", "69 – 230 kV", "10 – 250 MVA", "350 – 900 kV", "Renewable and storage interconnections; 34.5 kV low side typical; inverter duty per IEEE C57.110 and C57.159"),
    ("Generator step-up", "69 – 230 kV", "10 – 250 MVA", "350 – 900 kV", "Renewable, storage, and thermal generation; impedance to your system study"),
    ("Substation transformers", "69 – 230 kV", "10 – 250 MVA", "350 – 900 kV", "Utility, industrial, and data-center substations; 4.16 – 34.5 kV low side; on-load tap changers; dual secondaries"),
    ("Auto transformers", "115 / 138 / 161 / 230 kV", "to 250 MVA", "550 – 900 kV", "Transmission interconnection; tertiary windings for reactive support or station service"),
    ("Special duty", "to 230 kV", "per project", "per project", "Ester-filled units, furnace and rectifier duty, replacement units built to an existing nameplate and footprint"),
]
CAP_NOTE = "Higher voltage classes and ratings are engineered on request. Ratings are stated at the top cooling stage."

STANDARD = dict(
    h="FP-MPT standard line",
    p="Four pre-engineered configurations for 50 and 100 MW solar and storage interconnection blocks at 115 and 138 kV. Fully specified to IEEE C57, with the options interconnecting utilities most often require, so the quotation, drawings, and delivery date come faster.",
    lineup=[("FP-MPT-138-50", "30 / 40 / 50 MVA", "138 kV · 650 kV BIL", "34.5 kV · 200 kV BIL"),
            ("FP-MPT-115-50", "30 / 40 / 50 MVA", "115 kV · 550 kV BIL", "34.5 kV · 200 kV BIL"),
            ("FP-MPT-138-100", "60 / 80 / 100 MVA", "138 kV · 650 kV BIL", "34.5 kV · 200 kV BIL"),
            ("FP-MPT-115-100", "60 / 80 / 100 MVA", "115 kV · 550 kV BIL", "34.5 kV · 200 kV BIL")],
    common="60 Hz · ONAN/ONAF/ONAF three-stage cooling · 65 °C rise · DETC ±2 × 2.5 % · mineral oil · designed and tested to IEEE C57.12.00 and C57.12.90.",
    options="Options: on-load tap changer, natural-ester fluid, reduced BIL with surge arresters, composite bushings, low-sound design, monitoring package, spare-unit program, extended warranty.",
    catalog_note="The Solar & Storage Edition catalog, with datasheets and the full options list, is available on request.",
)

APPLICATIONS = [
    dict(id="utilities", name="Utilities",
         lead="Substation and auto transformers to 250 MVA and 230 kV, built to your standard specification.",
         body="Utility purchases run on a standard specification and an approval cycle. Every quotation answers your specification clause by clause; outline, nameplate, control schematics, CT curves, and bushing drawings go to your engineers for approval, with your review time built into the schedule. Taps, impedance, and low-side grounding are set for a load application."),
    dict(id="solar", name="Utility-scale solar",
         lead="Main power transformers for the point of interconnection, 30 – 100 MVA at 115 and 138 kV.",
         body="Solar output builds through the morning and peaks mid-afternoon. The unit runs on natural cooling for most of the day and brings its fans on for the peak. We size it to the megawatts your grid connection allows, with the cooling stages split to follow that daily curve."),
    dict(id="storage", name="Battery storage",
         lead="Point-of-interconnection transformers for standalone and hybrid storage.",
         body="A battery delivers full power for hours, then recharges at full power, on a daily cycle. The transformer warms and cools with every cycle, and inverter current carries harmonics. The thermal margin and conductor are designed for that duty, and monitoring can be added so you can follow the unit's condition from your control room."),
    dict(id="hybrid", name="Hybrid solar + storage",
         lead="One grid connection, rated for generating and for charging.",
         body="Solar and a battery share one point of interconnection. The transformer carries the combined output and the charging case when the battery draws from the grid. Both cases go into the rating, and sites built in phases can energize the first block early."),
    dict(id="datacenter", name="Data centers",
         lead="Substation transformers for campuses that need power on a construction schedule.",
         body="A data-center substation carries a steady load that grows in steps as halls come online. Units are rated for the campus build-out, with on-load tap changers for voltage regulation, low-sound designs where permits require them, and monitoring for owners who run condition-based maintenance."),
    dict(id="industrial", name="Industrial",
         lead="Step-down transformers for plants and process loads, 69 – 230 kV.",
         body="Industrial loads bring motor starting, harmonic content from drives, and duty that runs around the clock. Each unit is engineered to the plant's load profile, fault levels, and relaying scheme, with the accessories and interfaces your protection engineer specifies."),
    dict(id="wind", name="Wind",
         lead="Collector step-up transformers for onshore wind, to 230 kV.",
         body="Wind output arrives in long, variable runs with periods at full load. The collector transformer is rated for sustained output at the collector voltage, with the impedance and low-side grounding set to the collector system study and the interconnecting utility's requirements."),
    dict(id="replacement", name="Replacement and spares",
         lead="Replacement units and spare programs for operating fleets.",
         body="A failed unit or an aging fleet needs a replacement path faster than a new build. We build to the nameplate and footprint of the unit being replaced, and hold reserved production capacity or a stocked spare against fleets that need it."),
]

BASE = dict(
    h="Manufacturing base",
    intro="Farpoint units are built across a qualified manufacturing base of established power-transformer plants, selected and audited by Farpoint, with every unit engineered, inspected, and tested under Farpoint's program.",
    facts=[
        ("100+ GVA", "combined annual capacity across the base"),
        ("250 MVA · 230 kV", "three-phase units built routinely; 400 kV class at selected plants"),
        ("ISO/IEC 17025", "accredited high-voltage laboratories at every plant"),
        ("25+ countries", "with units in service, including the USA and Canada"),
    ],
    lines=[
        "Plants with 200 – 300 tonne cranes, vapor-phase drying, and dedicated high-voltage test bays.",
        "Impulse test systems rated to 1,400 kV and above at selected plants; partial-discharge, temperature-rise, and sweep-frequency-response testing in house.",
        "Designs short-circuit type-tested at independent laboratories, including KEMA.",
        "Built to IEEE/ANSI C57, IEC 60076, and IS as the specification requires; management systems certified to ISO 9001, ISO 14001, and ISO 45001.",
        "Product breadth across power, generator step-up, auto, inverter-duty, ester-filled, furnace, and traction transformers.",
    ],
    model_h="How Farpoint works",
    model="Farpoint designs each unit to your specification, qualifies and audits the plants that build it, sets the inspection hold points, witnesses the tests, delivers and commissions the unit, and carries the contract and the warranty. You deal with Farpoint from quotation to service.",
)

QUALITY = dict(
    h="Engineered, inspected, and tested to IEEE C57",
    blocks=[
        ("Engineering", "Every design is engineered to IEEE C57 and your utility's requirements, with finite-element short-circuit force, thermal, and insulation-coordination analysis. Drawings, nameplate, and test plan are issued for your engineer's and your utility's approval before production; the calculation package is available for owner's-engineer review."),
        ("Inspection", "A stage-gated inspection and test plan with hold, witness, and review points is issued for your sign-off before production, from core build through winding, assembly, vacuum drying, and oil processing. Core steel, copper, and insulation are traceable by lot. Your inspector is welcome at any hold point."),
        ("Testing", "The full IEEE C57.12.90 routine program on every unit, including partial discharge, full and chopped-wave lightning impulse, and a sweep-frequency-response baseline, in an ISO/IEC 17025-accredited high-voltage laboratory. Witnessed FAT is standard; we schedule it with your engineer at order."),
        ("Documentation", "Certified test report, oil certificates, SFRA and DGA baselines, impact-recorder log, as-built drawings, O&M manual, and commissioning report, delivered as a digital dossier and kept on file by serial number."),
    ],
    tests=[
        ("Routine — every unit", [
            ("Winding resistance", "All windings, all taps"), ("Ratio, polarity, and phase relation", "All taps"),
            ("No-load loss and excitation current", "At rated voltage; 110 % excitation"), ("Load loss and impedance", "At rated current, each cooling stage"),
            ("Zero-sequence impedance", "For relay settings on grounded-wye systems"), ("Applied-voltage test", "Low-frequency dielectric"),
            ("Induced-voltage test with partial discharge", "PD measured throughout the enhancement and one-hour levels"),
            ("Lightning impulse", "Full and chopped wave, all line terminals"), ("Insulation power factor and resistance", "Windings and bushings (C1 / C2)"),
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
            ("Short-circuit test", "Per IEEE C57.12.90; every design carries a finite-element force calculation and similar-design justification"),
            ("Radio-influence voltage", "Corona check on bushings and terminals"), ("Extended temperature-rise or sound program", "Per your specification"),
        ]),
    ],
    itp=["Material receipt: core steel, copper, insulation — lot traceability", "Core stacking complete", "Winding completion, each winding", "Core-and-coil assembly, before drying", "Vacuum drying end point: moisture and dew point", "Tanking and oil filling under vacuum", "Final assembly and pre-test checks", "Factory acceptance test — witnessed", "Packing, impact recorders, and release for shipment"],
    site=["Impact-recorder review and receiving inspection", "Dew-point and oxygen check before oil filling", "SFRA compared with the factory baseline", "Pre-energization tests per IEEE C57.152", "DGA at energization and after the first month of service"],
    standards="IEEE C57.12.00 · C57.12.10 · C57.12.90 · C57.91 · C57.110 · C57.159 · C57.104 · C57.149 · C57.152 · C57.106 · C57.147 · C57.19.00 · C57.13 · C57.131 · C57.93 · IEEE 693 · NEMA TR-1 · ASTM D3487",
    interfaces="Bushing current transformers: multi-ratio, relay accuracy class C800 typical, neutral CT on grounded-wye windings · control power 125 V DC and 120/240 V AC, 480 V for cooling · alarm and trip contacts for temperature, pressure, liquid level, and gas · DNP3 or IEC 61850 on the monitoring package · approval package: outline, nameplate, control schematics, CT curves, and bushing drawings.",
)

DELIVERY = dict(
    intro="Production capacity for 100 units per year, with additional capacity coming online in 2027. Current lead time for FP-MPT standard configurations is 12 – 14 months; engineered-to-order units are quoted per project. The delivery date, inclusive of engineering, test, and transport, is committed in the order.",
    stages=[("Order", "Purchase order; production slot reserved, delivery date committed"),
            ("Engineering", "Drawings for approval; long-lead materials committed. Monthly order status reports from here to delivery: engineering, materials, production, test, transit"),
            ("Production", "Core, windings, assembly, vacuum drying, oil processing"),
            ("FAT", "Full routine test program, witnessed; test report issued"),
            ("Transport", "Packing with impact recorders; transport to your site"),
            ("Site", "Offloading, assembly, vacuum oil filling, site tests, and commissioning")],
    warranty_h="Three years, from energization",
    warranty="Every unit ships with a Farpoint warranty of 36 months from energization, covering materials, workmanship, and design. The unit is stored to Farpoint's storage procedure before energization. Repair or replacement is at Farpoint's cost, including transport and site labor. The warranty is assignable to your lender or a successor owner. Coverage extends to five years from energization as an option.",
    service=["Losses designed to your loss-evaluation factors and guaranteed within IEEE C57.12.00 tolerances",
             "Named service engineer assigned at order; 24/7 contact",
             "Technician on site within 72 hours, contiguous US",
             "Field oil handling, testing, diagnostics, and repair",
             "Spare bushings, gaskets, fans, and controls stocked against your fleet",
             "Parts support for the life of the unit"],
)

QUOTE = dict(
    h="Request a quotation",
    sub="Send what you have. A quotation with a compliance matrix comes back.",
    ways=[("Pick a configuration", "Choose the FP-MPT configuration that fits your block and tell us the project values — impedance, low-side connection, BIL, taps."),
          ("Send your specification", "Your standard transformer specification and data sheet, or your utility's. The quotation answers it clause by clause."),
          ("Send your single-line and site data", "Early in development? Send the single-line diagram, site conditions, and delivery window; we propose the configuration and quote it.")],
    send=["Single-line diagram", "MW and power factor at the point of interconnection", "Your or your utility's transformer specification", "Duty profile for storage", "Site data (altitude, ambient, seismic) and delivery window"],
    back="What comes back: a quotation with the configuration, a clause-by-clause compliance matrix against your specification, and a committed delivery date. Reviewed by Farpoint engineering before it is sent.",
)

ABOUT = dict(
    h="Farpoint Energy",
    intro="Farpoint Energy builds power transformers for the US grid: main power transformers for renewable and storage interconnections, and generator step-up, substation, and auto transformers to 250 MVA and 230 kV for utility, data-center, and industrial projects. Farpoint is based in New York.",
    founder_name="Karan Uppal", founder_title="Founder",
    founder="Before Farpoint, Karan was Chief Technology Officer at EvolutionIQ, a New York AI company, where he built and ran the engineering organization. He started Farpoint to bring the same operating discipline to grid equipment: committed dates, clear specifications, and one accountable supplier.",
    advisors="Farpoint's engineering advisors have designed and tested power transformers to 400 kV for more than three decades.",
)
