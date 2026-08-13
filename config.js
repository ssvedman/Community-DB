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

  // Fallback roles if the cdb_app_roles table can't be read. The DB is authoritative.
  ROLES: { "stephen.svedman@lennar.com": { role: "admin" } },
  DEFAULT_ROLE: "viewer",

  IMAGE_BUCKET: "cdb-images",
  // Downsample uploads: longest edge capped, re-encoded as JPEG to protect the
  // Supabase free-tier storage while staying crisp on a 1080p display.
  IMAGE_MAX_EDGE: 1600,
  IMAGE_QUALITY: 0.82
};

/* ------------------------------------------------------------------
   CIS SCHEMA — one source of truth for both the viewer and the maker.
   Every field's value lives in the CIS row's `data` JSONB under its key.
   Identity fields (name/jde/project_name/hub/model_start) are ALSO mirrored
   to real columns for fast listing/search; the app keeps them in sync.
   ------------------------------------------------------------------ */
window.CIS_SCHEMA = {
  // quick-identity fields shown at the top of the maker form
  identity: [
    { k: "n",  label: "Community Name", col: "name",         required: true },
    { k: "p",  label: "Project Name",   col: "project_name" },
    { k: "j",  label: "JDE Community #",col: "jde" },
    { k: "hub",label: "Hub" }
  ],
  sections: [
    { id: "overview", title: "Community overview", type: "kv", fields: [
      { k: "alt",  label: "Additional JDE #(s)" },
      { k: "div",  label: "Division" },
      { k: "dev",  label: "Developer" },
      { k: "oe",   label: "Owning Entity" },
      { k: "mun",  label: "Permitting Municipality" },
      { k: "cty",  label: "City, State, Zip" },
      { k: "rev",  label: "Revision Date" },
      { k: "cd",   label: "CIS Date (printed)" },
      { k: "cb",   label: "Created By" },
      { k: "so",   label: "Sales Opening Date" },
      { k: "tr",   label: "Proj. Trench Date" },
      { k: "ms",   label: "Model Start", flag: "ms" },
      { k: "pace", label: "Sales Pace / Month" },
      { k: "hs",   label: "Total HS in Phase/Tract" },
      { k: "lot",  label: "Homesite AVG Size" },
      { k: "bs",   label: "Base Spec" },
      { k: "bp",   label: "BuildPro Template Type" },
      { k: "tn",   label: "Template Name to Use" }
    ]},
    { id: "plans", title: "Plans / elevations", type: "table",
      key: "pl", columns: ["Plan #","Plan Name / footprint","Elevations","Notes / VE"] },
    { id: "cs", title: "Community specific", type: "kvgroup", key: "cs", fields: [
      { k: "curb_type",                label: "Curb Type" },
      { k: "sod_type",                 label: "Sod Type" },
      { k: "landscaping",              label: "Landscaping" },
      { k: "waterstar_required",       label: "WaterStar Required" },
      { k: "darksky_required",         label: "DarkSky Required" },
      { k: "gas_or_electric_community",label: "Gas or Electric Community" },
      { k: "mail_boxes",               label: "Mail Boxes" },
      { k: "yard_fencing",             label: "Yard Fencing" },
      { k: "pools",                    label: "Pools" },
      { k: "pools_alternate_size",     label: "Pools - Alternate Size" },
      { k: "pools_spa",                label: "Pools - Spa" },
      { k: "upper_cabinets_42",        label: "42\" Upper Cabinets" }
    ]},
    { id: "up", title: "Utilities", type: "kvgroup", key: "up", fields: [
      { k: "power_provider",       label: "Power Provider" },
      { k: "power_tug",            label: "Power TUG" },
      { k: "water_meter_provider", label: "Water Meter Provider" },
      { k: "irrigation_meter",     label: "Irrigation Meter" },
      { k: "fision_x",             label: "Fision X" },
      { k: "water",                label: "Water" },
      { k: "sewer",                label: "Sewer" },
      { k: "electric",             label: "Electric" },
      { k: "gas",                  label: "Gas" },
      { k: "internet",             label: "Internet" }
    ]},
    { id: "notes", title: "Notes & caveats", type: "notes",
      textKey: "nt", listKey: "an", listLabel: "Annotations",
      caveatKey: "w", caveatLabel: "Source caveats (read-only)" }
  ]
};
