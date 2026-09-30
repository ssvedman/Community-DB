/* ============================================================
   Community-DB — CONFIG
   Static site on GitHub Pages, backed by the shared Supabase project.
   Login is required; viewers see only PUBLISHED community info.
   ============================================================ */
window.APP_CONFIG = {
  SUPABASE_URL:  "https://memhzqphludiruovuzwt.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1lbWh6cXBobHVkaXJ1b3Z1end0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQyMTI3MjUsImV4cCI6MjA5OTc4ODcyNX0.hTJBtb3WtkgY66xqzZ22GT7V4VNllxPyb4C7qXRFFVI",

  // ---- Blueprint hub -------------------------------------------------------
  // Invite / password-reset links generated here land on Blueprint rather than
  // on this app, so one branded page sets the password and then shows the person
  // every tool they have access to. The token itself is unchanged — Blueprint
  // redeems it with the same function this app would have used.
  //
  // Capital B: GitHub Pages paths are case-sensitive.
  // If this is ever blank, link generation falls back to this app's own URL,
  // which is exactly the behaviour before the change.
  BLUEPRINT_URL: "https://ssvedman.github.io/Blueprint/",

  ALLOWED_DOMAIN: "@lennar.com",
  // Default division (first load, and the fallback if a remembered pick is gone).
  DIVISION: { key: "orlando", label: "Orlando Division", code: "OLH" },
  // Every division the switcher offers. Keys match cdb_cis.division, the
  // cdb_template id and the entries in cdb_app_roles.divisions.
  DIVISIONS: [
    { key: "orlando", label: "Orlando Division", code: "OLH" },
    { key: "tampa",   label: "Tampa Division",   code: "TPU" }
  ],

  ROLES: { "stephen.svedman@lennar.com": { role: "admin" } },
  DEFAULT_ROLE: "viewer",

  IMAGE_BUCKET: "cdb-images",
  IMAGE_MAX_EDGE: 1600,
  IMAGE_QUALITY: 0.82
};

/* ------------------------------------------------------------------
   CIS SCHEMA (default template) — mirrors the "Community Information Sheets" workbook.
   Every value lives in the CIS row's `data`:
     data.f[<key>]      – all key/value fields (across sections)
     data.plans[]       – Floor Plans rows (5 columns)
     data.note          – Notes (Special Circumstances) text
     data.extra[secId][]– any label/value not in the schema (import-safe)
     data.meta          – footer (created-by / source), if any
   Identity fields are ALSO mirrored to real columns for listing/search.
   ------------------------------------------------------------------ */
window.CIS = {
  PLAN_COLS: ["Plan Number","Plan Name - Footprint","Elevations","New Plan","New Add or Delete"],
  IDENTITY: { name:"community_name", jde:"jde", project:"project_name", product:"product_type" },
  SECTIONS: [
    { id:"proj", title:"Project Information", kind:"kv", fields:[
      { k:"division",       label:"Division" },
      { k:"date",           label:"Date" },
      { k:"rev_date",       label:"Revision Date", readonly:true },
      { k:"project_name",   label:"Project Name" },
      { k:"base_spec",      label:"Base Spec" },
      { k:"product_type",   label:"Product Type" },
      { k:"developer",      label:"Developer" },
      { k:"total_hs",       label:"Total HS in Phase/Tract" },
      { k:"homesite_avg",   label:"Homesite AVG Size" },
      { k:"community_name", label:"Community Name" },
      { k:"jde",            label:"JDE Community #" },
      { k:"trench_date",    label:"Proj. Trench Date" },
      { k:"municipality",   label:"Permitting Municipality" },
      { k:"city_state_zip", label:"City, State, Zip" },
      { k:"owning_entity",  label:"Owning Entity" }
    ]},
    { id:"plans", title:"Floor Plans", kind:"plans" },
    { id:"model", title:"Model and Sales Office Information", kind:"grid", key:"model", rowHeader:"Model",
      rowLabels:["Model Home Plan 1","Model Home Plan 2","Model Home Plan 3","Lot for Parking","WHC Homesite","Buffer Homesite"],
      columns:["Plan / Elevation / Swing","Homesite","Projected Start","Projected Completion"] },
    { id:"hcs", title:"Home Construction Specifications", kind:"kv", fields:[
      { k:"ext_wall",         label:"Exterior Wall Type" },
      { k:"foundation",       label:"Foundation Type" },
      { k:"insulation",       label:"Insulation - Wall / Ceiling" },
      { k:"water_heater",     label:"Water Heater Specifications" },
      { k:"front_door",       label:"Front Door Style" },
      { k:"front_door_glass", label:"Front Door Glass Option" },
      { k:"garage_door",      label:"Garage Door Style" },
      { k:"coach_lights",     label:"Coach Lights" },
      { k:"window_type",      label:"Window Type" },
      { k:"roof_material",    label:"Roof Material" },
      { k:"roof_color",       label:"Roof Color" },
      { k:"roof_sheathing",   label:"Roof Sheathing Type" },
      { k:"soffit",           label:"Soffit / Fascia / Drip Edge Color" },
      { k:"gutters",          label:"Gutters" },
      { k:"fw_drive",         label:"Flatwork - Drive & Leadwalk" },
      { k:"fw_front",         label:"Flatwork - Front Entry" },
      { k:"fw_lanai",         label:"Flatwork - Rear Lanai" },
      { k:"fw_paver",         label:"Flatwork - Paver Color" },
      { k:"ext_conc_patio",   label:"Ext Concrete Patio" },
      { k:"ext_paver_patio",  label:"Ext Paver Patio" },
      { k:"ext_paver_screen", label:"Ext Paver Patio w/ Screen" },
      { k:"screen_lanai",     label:"Screen Standard Lanai" }
    ]},
    { id:"cs", title:"Community Specific Specifications", kind:"kv", fields:[
      { k:"curb",          label:"Curb Type" },
      { k:"gas_electric",  label:"Gas or Electric Community" },
      { k:"solar",         label:"Solar" },
      { k:"sod",           label:"Sod Type" },
      { k:"landscaping",   label:"Landscaping" },
      { k:"waterstar",     label:"WaterStar Required" },
      { k:"mailboxes",     label:"Mail Boxes" }
    ]},
    { id:"up", title:"Utility Providers", kind:"kv", fields:[
      { k:"power_provider", label:"Power Provider" },
      { k:"power_tug",      label:"Power TUG" },
      { k:"water_meter",    label:"Water Meter Provider" },
      { k:"irrigation_meter", label:"Irrigation Meter" },
      { k:"metered_banks",  label:"Metered Banks" },
      { k:"individual_banks", label:"Individual Banks" },
      { k:"fision_x",       label:"Fision X" }
    ]},
    { id:"deck", title:"Site & Model Park (Deck)", kind:"kv", fields:[] },   // populated via data.extra.deck (CIS Portal / Deck merge)
    { id:"note", title:"Notes (Special Circumstances)", kind:"note" }
  ]
};

/* ------------------------------------------------------------------
   Per-division default templates. A division not listed here starts from the
   Orlando SECTIONS above. Same rules apply: once an admin saves that
   division's template, cdb_template (id = division key) wins.

   TAMPA mirrors the Tampa "A - CIS - Community Name - GA" workbook:
   Land Acq and Dev / Sales / Forward Planning / Entitlements / Land
   Development / sign-off block. Where a Tampa line means the same thing as an
   Orlando one it reuses the Orlando key (community_name, jde, municipality,
   city_state_zip, power_provider, water_meter), so the Community Map and
   Blueprint pick those values up for Tampa without any change on their side.
   ------------------------------------------------------------------ */
window.CIS.DIVISION_SECTIONS = {
  tampa: [
    { id:"lad", title:"Land Acq and Dev", kind:"kv", fields:[
      { k:"community_name",     label:"Community Name" },
      { k:"jde",                label:"Community Number" },
      { k:"homesite_count",     label:"Homesite Count" },
      { k:"city_state_zip",     label:"City / Zip Code" },
      { k:"municipality",       label:"Municipality" },
      { k:"coordinates",        label:"Coordinates" },
      { k:"spec_level",         label:"Spec Level" },
      { k:"internet",           label:"Internet" },
      { k:"power_provider",     label:"Power Company" },
      { k:"water_meter",        label:"Water / Sewer" },
      { k:"wind_speed",         label:"Wind Speed / Exposure" },
      { k:"hurricane_shutters", label:"Hurricane Shutters Req?" },
      { k:"rev_date",           label:"Revision Date", readonly:true }
    ]},
    { id:"sales", title:"Sales", kind:"kv", fields:[
      { k:"model_hs",            label:"Model HS" },
      { k:"parking_hs",          label:"Parking HS" },
      { k:"community_standards", label:"Community Standards" }
    ]},
    { id:"plans", title:"Plan / Elev Lineup", kind:"plans",
      columns:["Plan Number","Plan Name","Elevations"] },
    { id:"fp", title:"Forward Planning", kind:"kv", fields:[
      { k:"color_scheme",     label:"Color Scheme" },
      { k:"stone_color",      label:"Stone Color" },
      { k:"driveways",        label:"Driveways (Paver/Concrete)" },
      { k:"driveway_widths",  label:"Driveway width requirements?" },
      { k:"paver_apron",      label:"If paver, concrete apron required?" },
      { k:"roof_spec",        label:"Roof Type & Spec" },
      { k:"soffit_size",      label:"Required 12\" (typ) or 16\" soffit?" },
      { k:"fascia_size",      label:"Required 4\" (typ) or 6\" fascia?" },
      { k:"sod_req",          label:"Sod Requirements" },
      { k:"coach_lighting",   label:"Coach Lighting?" }
    ]},
    { id:"ent", title:"Entitlements", kind:"kv", fields:[
      { k:"foundation_type",   label:"Foundations (Mono or Stemwall)" },
      { k:"design_guidelines", label:"Design Guidelines" },
      { k:"special_req",       label:"Special Requirements" },
      { k:"arc_plan",          label:"ARC Plan Approval" },
      { k:"arc_color",         label:"ARC Color Approval" },
      { k:"arc_landscape",     label:"ARC Landscape Approval" },
      { k:"lot_fit",           label:"Lot Fit Issues" },
      { k:"fence",             label:"Fence (Style, color, etc.)" },
      { k:"banding_limits",    label:"Banding Limitations (Min/Max SF)" },
      { k:"monotony",          label:"Monotony Standards" },
      { k:"gutters_req",       label:"Gutters required?" },
      { k:"stucco_finish",     label:"Stucco finish requirements?" },
      { k:"decorative_trim",   label:"Decorative Trim/Accent requirements?" },
      { k:"corner_hs",         label:"Corner homesite requirements?" },
      { k:"lal_street_trees",  label:"LAL Requirements for Street Trees?" },
      { k:"lal_lot_trees",     label:"LAL Requirements for Lot Trees?" },
      { k:"cbu",               label:"CBU (Homebuilding, Land, or Developer?)" },
      { k:"raised_entry",      label:"Raised Entry Requirements" },
      { k:"raising_porches",   label:"If yes, are we raising porches?" }
    ]},
    { id:"ld", title:"Land Development", kind:"kv", fields:[
      { k:"potable_meter",   label:"Potable Meter (Individual or Master Meter)" },
      { k:"sub_meters",      label:"If Master, will there be sub-meters?" },
      { k:"electric_meter",  label:"Electric Meter (Individual or Banked)" },
      { k:"irrigation",      label:"Irrigation (Potable, Reclaim, Well)" },
      { k:"reclaim_provider",label:"If Reclaim, who is the provider?" },
      { k:"well_mainline",   label:"If Well, Mainline by who?" },
      { k:"gas",             label:"Gas (If yes, please send agreement to Forward Planning)" }
    ]},
    { id:"signoff", title:"Sign-Off", kind:"grid", key:"signoff", rowHeader:"Department",
      rowLabels:["Land Development","Construction","Sales","Sales Admin","Purchasing","Division President"],
      columns:["Signature","Date"] },
    { id:"note", title:"Notes", kind:"note" }
  ]
};

/* SECTIONS above is the DEFAULT template. Once an admin saves the template in
   the app's Template tab, the saved layout (table cdb_template) is used instead
   and this list is only the fallback. */
