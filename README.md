# Community-DB

A login-gated Community Information Sheet (CIS) portal for the Orlando Division, built as a
static site on GitHub Pages against the shared Supabase backend (same project as Takeoff Flow
and the Vendor Portal). All backend objects are namespaced `cdb_*`.

Two sides, one app:

- **Viewer** — any signed-in `@lennar.com` user sees only *published* community info.
- **Maker** (editors/admins) — draft with save-and-resume, publish to live, edit already-published
  sheets (which starts a fresh draft), plus **Gaps** and **Add / import** tabs. Toggle with the
  **Viewer / Maker** switch at the top right.

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

## PDF import

**Add / import** reads a CIS PDF's text layer and best-effort pre-fills a draft, flagged **needs
review**. Always verify every field before publishing — extraction is approximate.

## Files

| File | Purpose |
|------|---------|
| `index.html` | App shell + login card |
| `config.js` | Supabase keys, image settings, and the **CIS field schema** (one source of truth) |
| `styles.css` | Design language shared with the other portals |
| `app.js` | Auth, data loading, viewer, maker, notes, gaps, images, PDF import, admin |
| `supabase_setup.sql` | Backend: tables, RLS, publish/draft RPCs, Storage bucket, user admin |
