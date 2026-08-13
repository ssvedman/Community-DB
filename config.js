/* ============================================================
   Community-DB — CONFIG
   Static site on GitHub Pages, backed by the shared Supabase project.
   Login is required; viewers see only PUBLISHED community info.
   ============================================================ */
window.APP_CONFIG = {
  SUPABASE_URL:  "https://memhzqphludiruovuzwt.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1lbWh6cXBobHVkaXJ1b3Z1end0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQyMTI3MjUsImV4cCI6MjA5OTc4ODcyNX0.hTJBtb3WtkgY66xqzZ22GT7V4VNllxPyb4C7qXRFFVI",

  ALLOWED_DOMAIN: "@lennar.com",
  DIVISION: { key: "orlando", label: "Orlando Division", code: "OLH" },

  ROLES: { "stephen.svedman@lennar.com": { role: "admin" } },
  DEFAULT_ROLE: "viewer",

  IMAGE_BUCKET: "cdb-images",
  IMAGE_MAX_EDGE: 1600,
  IMAGE_QUALITY: 0.82
};

/* ------------------------------------------------------------------
   CIS SCHEMA — mirrors the "Community Information Sheets" workbook.
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
      { k:"fision_x",       label:"Fision X" }
    ]},
    { id:"note", title:"Notes (Special Circumstances)", kind:"note" }
  ]
};

/* normalize a label for matching (lowercase, strip punctuation/whitespace/asterisks) */
window.CIS.norm = s => String(s==null?"":s).toLowerCase().replace(/[\s:*]+/g," ").replace(/[^a-z0-9 /&.'-]/g,"").trim();
/* normalized-label -> {sec,key} index for import */
window.CIS.labelIndex = (function(){
  const idx={};
  window.CIS.SECTIONS.forEach(sec=>{ (sec.fields||[]).forEach(f=>{ idx[window.CIS.norm(f.label)]={sec:sec.id,key:f.k}; }); });
  return () => idx;
})();
