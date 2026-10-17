# Farpoint Energy — website content. Edit here, then run python3 build.py.
SITE = {'name': 'Farpoint Energy',
 'domain': 'https://farpointenergy.com',
 'email': 'quotes@farpointenergy.com',
 'founder_email': 'karan@farpointenergy.com',
 'phone': '+1 (217) 417-9345',
 'phone_raw': '+12174179345',
 'city': 'New York, NY',
 'form_action': 'https://formsubmit.co/quotes@farpointenergy.com'}

HERO = dict(
    eyebrow="Transformers for your project",
    h1="Power and distribution transformers, built to your specification.",
    sub="Farpoint supplies transformers for data centers, energy projects, utilities and industry. Send your specification and required site date for a proposal covering price, delivery and technical exceptions.",
)

PRODUCT_CATEGORIES = [
    dict(
        id="power", name="Power transformers", route="power-transformers.html",
        eyebrow="Main power · Substation · Generator step-up",
        summary="Main power, substation and generator step-up transformers for interconnection, generation and large-load projects. Step-up or step-down duty, specified for your system.",
        uses=["Utility and campus substations", "Solar, storage and wind interconnections", "Generator step-up and industrial supply"],
        inputs=["Rated MVA and cooling-stage ratings, if known", "Primary and secondary voltages", "Quantity and required delivery to site", "Single-line diagram and transformer specification", "Impedance, winding connections, taps and insulation levels", "Site conditions, installation constraints and required accessories"],
    ),
    dict(
        id="distribution", name="Distribution transformers", route="distribution-transformers.html",
        eyebrow="Site distribution · Medium voltage · Padmount",
        summary="Distribution transformers for data-center infrastructure, solar, storage and industry. Rating, voltages and installation arrangement are matched to the project requirement.",
        uses=["Data-center site distribution", "Solar and storage medium-voltage packages", "Industrial and facility distribution"],
        inputs=["Rated kVA or MVA, if known", "Primary and secondary voltages", "Quantity and delivery phasing", "Installation arrangement and available space", "Buyer specification, single-line diagram or equipment schedule", "Insulation medium, taps, impedance, terminals and accessories, where specified"],
    ),
]

STANDARD = dict(
    h="Power-transformer reference configurations",
    p="These FP-MPT examples provide a starting point for a specification discussion. Each rating sequence describes the cooling stages of one unit. Final ratings, insulation levels and configuration are set in the proposal.",
    lineup=[('FP-MPT-138-50', '30 / 40 / 50 MVA', '138 kV · 650 kV BIL', '34.5 kV · 200 kV BIL'),
 ('FP-MPT-115-50', '30 / 40 / 50 MVA', '115 kV · 550 kV BIL', '34.5 kV · 200 kV BIL'),
 ('FP-MPT-138-100', '60 / 80 / 100 MVA', '138 kV · 650 kV BIL', '34.5 kV · 200 kV BIL'),
 ('FP-MPT-115-100', '60 / 80 / 100 MVA', '115 kV · 550 kV BIL', '34.5 kV · 200 kV BIL')],
    common="Example basis: 60 Hz, 34.5 kV low side and three cooling-stage ratings. Project loading, utility requirements and the applicable specification determine the final design.",
    options="Specify the required taps, winding connections, impedance, insulation medium, sound limits, monitoring and accessories. Options and technical exceptions are identified in the proposal.",
)

APPLICATIONS = [
    dict(
        id="datacenter", name="Data centers", category="unsure", application="data-center", route="data-centers.html",
        lead="Incoming substation and site-distribution transformer packages.",
        body="Identify the package you are sourcing, from incoming utility transformation to distribution across the site. Share the electrical specification, unit quantities and delivery phases for a proposal aligned with your construction schedule.",
    ),
    dict(
        id="solar", name="Solar", category="unsure", application="solar", route="solar-storage.html?application=solar",
        lead="Main interconnection and medium-voltage transformer requirements.",
        body="Send the transformer specification and single-line diagram for the main interconnection package or the inverter-associated transformer package. Rating, voltage, duty and interface requirements are reviewed for the individual package.",
    ),
    dict(
        id="storage", name="Battery storage", category="unsure", application="storage", route="solar-storage.html?application=storage",
        lead="Main power and site-distribution transformers for storage projects.",
        body="Share charge and discharge duty, the equipment schedule and the required site dates. The proposal addresses the specified transformer scope, including electrical interfaces, losses and accessories where required.",
    ),
    dict(
        id="utilities", name="Utilities", category="unsure", application="utility", route="applications.html#utilities",
        lead="Substation and distribution transformers to your procurement specification.",
        body="Start with your standard specification, required ratings and approval process. The proposal identifies the offered configuration, technical exceptions, testing and documentation, with review milestones included in the proposed schedule.",
    ),
    dict(
        id="industrial", name="Industrial", category="unsure", application="industrial", route="applications.html#industrial",
        lead="Power and distribution transformers for plants and process loads.",
        body="Provide the load profile, voltage requirements and installation constraints. Include motor-starting, harmonic, protection and control requirements where they apply so these can be addressed in the proposal.",
    ),
    dict(
        id="hybrid", name="Hybrid solar + storage", category="unsure", application="other", route="solar-storage.html",
        lead="Transformer packages for shared interconnections and phased sites.",
        body="Share the operating cases for generation and charging, the single-line diagram and the project phases. Each transformer package is specified against its electrical duty and delivery requirement.",
    ),
    dict(
        id="wind", name="Wind", category="power", application="other", route="applications.html#wind",
        lead="Collector and interconnection transformer requirements.",
        body="Send the collector-system and interconnection specifications, including loading, voltage, impedance and grounding requirements. The proposal defines the transformer scope and proposed delivery schedule.",
    ),
    dict(
        id="replacement", name="Replacement and spares", category="unsure", application="other", route="applications.html#replacement",
        lead="Replacement inquiries based on your existing equipment and site.",
        body="A nameplate, outline drawing or equipment specification is a useful starting point. Include terminal locations, footprint constraints, operating duty and the required replacement window so fit and schedule can be assessed.",
    ),
]

APPLICATION_LANDINGS = {
    "data-center": dict(
        title="Transformers for data centers",
        intro="Source the transformer package your project needs, from incoming substation transformation to site distribution. Send a package specification and delivery phases to start the discussion.",
        packages=[
            ("Incoming utility and substation", "Power transformers for the campus incoming supply, with ratings, voltage transformation, impedance and interfaces defined by the project specification.", "power"),
            ("Site distribution", "Distribution transformers for the site's electrical packages. Specify voltage levels, kVA or MVA, quantities and installation arrangement for each requirement.", "distribution"),
        ],
        inputs=["Transformer package specification or equipment schedule", "Single-line diagram and voltage levels", "Rating and quantity for each transformer type", "Delivery phases and required site dates", "Installation constraints, terminals and required accessories"],
    ),
    "solar-storage": dict(
        title="Transformers for solar and storage",
        intro="Main interconnection and medium-voltage transformer packages for solar, standalone storage and hybrid projects. Define each package by its duty, electrical interfaces and required site date.",
        packages=[
            ("Main interconnection", "Power transformers for the grid connection, with the proposed rating and cooling stages based on the specified loading and operating cases.", "power"),
            ("Medium-voltage packages", "Transformers associated with inverter blocks and site distribution. Specify the transformer duty and interfaces to the project's inverter or battery equipment.", "distribution"),
        ],
        inputs=["Transformer specification and single-line diagram", "Package ratings, voltage levels and quantities", "Generation, charge and discharge operating cases", "Inverter interface and harmonic requirements, where specified", "Site conditions and delivery phases"],
    ),
}

PROPOSAL = [
    ("Configuration and scope", "Proposed transformer configuration, price, inclusions and commercial terms."),
    ("Specification response", "A response to your technical requirements, with compliance and exceptions identified."),
    ("Delivery schedule", "Proposed engineering, approval, testing and delivery milestones."),
    ("Testing and documentation", "The proposed test plan, document package and warranty scope and duration."),
]

PROCESS = [
    ("Requirement and proposal", "Send a specification or the project information you have. Farpoint clarifies the requirement and prepares the proposed technical and commercial scope."),
    ("Design and approvals", "The order defines the design submissions, review milestones and approval responsibilities before the relevant production stages."),
    ("Production and testing", "Progress reporting, inspections and factory acceptance testing follow the agreed order schedule and inspection and test plan."),
    ("Delivery and handover", "Shipment, receiving requirements, final documents and any site services are coordinated to the agreed scope."),
]

QUALITY = dict(
    h="A clear path from specification to acceptance",
    intro="The proposal identifies applicable standards, technical exceptions and the planned testing and documentation. The order establishes the approval, inspection and acceptance requirements for your transformer.",
    blocks=[
        ("Specification review", "Electrical ratings, duty, site conditions and interfaces are reviewed against the buyer's specification. The proposal identifies the offered configuration and any exceptions."),
        ("Approval documents", "The drawing and document schedule is agreed at order. It can include outlines, nameplates, winding connections, control schematics, terminal details and accessory information."),
        ("Inspection and testing", "The inspection and test plan defines the applicable tests, acceptance criteria, review points and any buyer witness requirements for the proposed product."),
        ("Final documentation", "The agreed handover package includes test records, final drawings and operating and maintenance information. Additional records are specified to suit the equipment and project."),
    ],
    tests=[
        ("Winding resistance and ratio", "Measurements and connection checks appropriate to the windings, taps and specified test standard."),
        ("Losses and impedance", "No-load and load measurements, excitation current and impedance at the specified conditions."),
        ("Dielectric tests", "The applicable applied, induced and impulse test scope is defined by the equipment, voltage class and agreed standard."),
        ("Mechanical and functional checks", "Checks for the supplied tank, terminals, cooling, controls, alarms and accessories, as applicable."),
        ("Liquid and insulation records", "Oil or other insulating-liquid tests and insulation measurements where required by the equipment and test plan."),
        ("Design and additional tests", "Temperature rise, sound, partial discharge, frequency response and other tests are addressed where applicable or specified; the proposal identifies the test or supporting report scope."),
    ],
    itp=["Material and component documentation", "Winding and active-part inspection", "Assembly, drying and filling, as applicable", "Final assembly and pre-test inspection", "Factory acceptance tests and buyer witness points", "Document review and release for shipment"],
    site=["Receiving inspection and transport-record review", "Assembly and liquid handling where required", "Site checks and comparison with factory records", "Pre-energization testing and commissioning support"],
    standards="Applicable IEEE C57, IEC 60076 or buyer-specified requirements are identified for the proposed product. The specification response records the standards, editions and any exceptions included in the offer.",
    interfaces="Specify protection and control interfaces, terminals, monitoring, auxiliary power and accessory requirements with your inquiry. Their scope and approval documents are defined in the proposal.",
)

DELIVERY = dict(
    intro="Delivery is quoted for the project. The proposed schedule includes engineering reviews, production, testing and transport, with the required delivery-to-site date kept distinct from target energization.",
    stages=[
        ("Order scope", "Confirm the configuration, commercial terms, responsibilities and agreed delivery milestones."),
        ("Engineering", "Issue approval documents and track the review dates needed for the production schedule."),
        ("Production", "Track manufacturing progress and inspection points through the agreed reporting schedule."),
        ("Factory acceptance", "Complete the agreed tests, review the records and confirm shipment release requirements."),
        ("Transport", "Coordinate packing, transport, site access and receiving responsibilities for the agreed delivery scope."),
        ("Handover", "Provide the final document package and coordinate any included assembly, testing or commissioning services."),
    ],
    warranty_h="Warranty defined in your proposal",
    warranty="Warranty scope, duration, start date and claim arrangements are included in the proposal and agreed in the order. Storage requirements, site responsibilities and any extended coverage are addressed for the project.",
    service=["Installation and commissioning support arranged according to project requirements", "Field testing, diagnostics, liquid processing and repair scope agreed per order", "Recommended spares and replacement components identified for the supplied equipment", "After-sales contacts, response arrangements and responsibilities defined in the order"],
)

QUOTE = dict(
    h="Request a quotation",
    sub="Send your specification or tell us what the project needs. Early inquiries are welcome.",
    ways=[
        ("Send a specification", "Share the transformer specification, equipment schedule or a link to the project documents."),
        ("Describe the requirement", "Tell us the transformer category, rating, voltages, quantity and required site date, where known."),
        ("Start with what you have", "A single-line diagram, existing nameplate or short description is enough to begin clarifying the requirement."),
    ],
    send=["Specification, single-line diagram or equipment schedule", "Rating, voltages and quantity, if known", "Required delivery to site and project location", "Duty profile, installation constraints and any special requirements"],
    back="Farpoint reviews the requirement and follows up by email. The proposal sets out configuration, price and scope, technical exceptions, the proposed schedule, and testing, documentation and warranty terms.",
)

ABOUT = {'h': 'Farpoint Energy',
 'intro': 'Farpoint Energy supplies power and distribution transformers for data centers, energy '
          'projects, utilities and industry. Based in New York, Farpoint is your point of contact '
          'for the proposal, agreed delivery scope and after-sales arrangements.',
 'founder_name': 'Karan Uppal',
 'founder_title': 'Founder',
 'founder': 'Before Farpoint, Karan was Chief Technology Officer at EvolutionIQ, a New York AI '
            'company, where he built and ran the engineering organization. He started Farpoint to '
            'bring the same operating discipline to grid equipment: committed dates, clear '
            'specifications, and one accountable supplier.',
 'advisors': "Farpoint's engineering advisors have designed and tested power transformers to 400 "
             'kV for more than three decades.'}
