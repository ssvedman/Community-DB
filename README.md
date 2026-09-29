# Community-DB

A login-gated Community Information Sheet (CIS) portal for the Orlando Division, built as a
static site on GitHub Pages against the shared Supabase backend (same project as Takeoff Flow
and the Vendor Portal). All backend objects are namespaced `cdb_*`.

Two sides, one app:

- **Viewer** — any signed-in `@lennar.com` user sees only *published* community info.
- **Maker** (editors/admins) — draft with save-and-resume, publish to live, edit already-published
  sheets (which starts a fresh draft), **Publish all drafts** on the Communities toolbar, and the
  **Gaps** and **Template** tabs. Toggle with the **Viewer / Maker** switch at
  the top right.

## One-time setup

1. **Run the schema.** In Supabase → SQL Editor, paste and run `supabase_setup.sql`. It creates the
   tables, row-level security, the publish/draft functions, the image Storage bucket, and seeds
   `stephen.svedman@lennar.com` as the first admin.
2. **Deploy.** Push this folder to the `Community-DB` GitHub repo and enable GitHub Pages
   (Settings → Pages → deploy from `main`). `.nojekyll` is included so Pages serves the files as-is.
3. **Set your password.** Sign in requires a password. From the in-app **Admin → Add user / reset
   password**, generate a one-time link for yourself (or any user) and open it to set a password.
   No email is sent — share the link privately (the Lennar SMTP gateway blocks the sender).

## How editing works

- Editing any field auto-saves to a **draft**. Viewers keep seeing the current **published**
  version until you press **Publish**.
- **Edit** on a published community clones it into a draft; **Discard draft** reverts to live.
- Each publish writes an immutable snapshot to `cdb_cis_revisions` (audit trail).

## Images

Uploads are downsampled in the browser (longest edge `IMAGE_MAX_EDGE`, re-encoded JPEG at
`IMAGE_QUALITY` — see `config.js`) before going to the private `cdb-images` bucket, to stay crisp
on a 1080p display while conserving free-tier storage.

## Template editor

**Template** (editors and admins, Maker side) shows every section as the grid it becomes on a sheet.
Type straight into a section title, column heading or row label to rename it; use **+ Row** /
**+ Column** to add one at a time, the arrows to reorder, and **×** to remove. **+ Add section**
creates a table with a row-label column and one text column ("Value"). Nothing changes for anyone
until **Save template**. Requires `add_template.sql` (run once); until the first save, the default
layout in `config.js` is used.

- **Removing a section** deletes it from the template. Values already entered in it stay in the
  database but no longer show on any sheet.
- **Removing a row or column** hides it only on sheets where it's empty — sheets that already have a
  value keep it and still show (and export) it. Removed rows/columns can be restored.
- New rows get fresh keys and every column keeps a fixed storage slot that is never reused, so adding,
  reordering or removing rows and columns never moves an existing value.
- Identity fields (Community Name, JDE, Project Name, Product Type), the auto Revision Date, and the
  Plan Number / Plan Name columns can be renamed but not removed.
- Every section except Notes can take extra columns. On label/value sections the original **Value**
  column stays put (renameable, not removable) and extra columns store in `data.fc`; a section with only
  its Value column looks exactly as before.
- Every save writes a snapshot to `cdb_template_revisions`. Saving over someone else's newer save asks first.

## Files

| File | Purpose |
|------|---------|
| `index.html` | App shell + login card |
| `config.js` | Supabase keys, image settings, and the **default** CIS template |
| `styles.css` | Design language shared with the other portals |
| `app.js` | Auth, data loading, template, viewer, maker, gaps, images, template editor, admin |
| `add_template.sql` | Editable template tables (`cdb_template`, `cdb_template_revisions`) |
| `supabase_setup.sql` | Backend: tables, RLS, publish/draft RPCs, Storage bucket, user admin |
