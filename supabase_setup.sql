/* ==========================================================================
   Community-DB — Supabase backend (schema + RLS + publish workflow + storage)
   Shares the existing Supabase project with Takeoff Flow and the Vendor Portal.
   All objects are namespaced cdb_* so they never collide with tf_* / vendor tables.

   Run this whole file once in Supabase > SQL Editor. It is idempotent —
   safe to re-run after edits.

   Roles:
     viewer  – any signed-in @lennar.com user; sees only PUBLISHED community info
     editor  – may create/edit drafts, publish, and edit published sheets
     admin   – editor + user management (add users / reset links / roles)
   ========================================================================== */

create extension if not exists pgcrypto;

/* ---------------------------------------------------------------- roles --- */
create table if not exists public.cdb_app_roles (
  email      text primary key,
  role       text not null default 'viewer' check (role in ('viewer','editor','admin')),
  created_at timestamptz not null default now()
);

/* --------------------------------------------------------- helper funcs --- */
create or replace function public.cdb_email() returns text
  language sql stable as $$ select lower(coalesce(auth.jwt()->>'email','')) $$;

create or replace function public.cdb_is_lennar() returns boolean
  language sql stable as $$ select public.cdb_email() like '%@lennar.com' $$;

-- SECURITY DEFINER so the read of cdb_app_roles bypasses RLS. Without this the
-- cdb_app_roles read policy (which calls this function) would recurse endlessly
-- ("stack depth limit exceeded").
create or replace function public.cdb_role() returns text
  language sql stable security definer set search_path = public as $$
    select coalesce((select role from public.cdb_app_roles where email = public.cdb_email()), 'viewer')
  $$;

create or replace function public.cdb_is_editor() returns boolean
  language sql stable as $$ select public.cdb_role() in ('editor','admin') $$;

create or replace function public.cdb_is_admin() returns boolean
  language sql stable as $$ select public.cdb_role() = 'admin' $$;

/* ------------------------------------------------------------- tables ----- */
-- One row per community per status. At most one draft + one published each,
-- grouped by a stable community_id shared across the draft/published pair.
create table if not exists public.cdb_cis (
  id            uuid primary key default gen_random_uuid(),
  community_id  uuid not null default gen_random_uuid(),
  division      text not null default 'orlando',
  status        text not null check (status in ('draft','published')),
  name          text,
  jde           text,               -- JDE / community number
  project_name  text,
  hub           text,
  source        text not null default 'manual' check (source in ('CIS','DECK','manual')),
  model_start   date,
  needs_review  boolean not null default false,
  active        boolean not null default true,        -- inactive = hidden from viewers by default
  data          jsonb  not null default '{}'::jsonb,  -- all section field values
  updated_at    timestamptz not null default now(),
  updated_by    text,
  published_at  timestamptz,
  unique (community_id, status)
);
create index if not exists cdb_cis_status_idx on public.cdb_cis(status);
create index if not exists cdb_cis_comm_idx   on public.cdb_cis(community_id);

-- Immutable snapshots written each time a community is published (audit trail).
create table if not exists public.cdb_cis_revisions (
  id           uuid primary key default gen_random_uuid(),
  community_id uuid not null,
  name         text,
  jde          text,
  data         jsonb not null default '{}'::jsonb,
  published_by text,
  published_at timestamptz not null default now()
);
create index if not exists cdb_rev_comm_idx on public.cdb_cis_revisions(community_id, published_at desc);

-- Downsampled images stored in the cdb-images Storage bucket; row per image.
create table if not exists public.cdb_images (
  id           uuid primary key default gen_random_uuid(),
  community_id uuid not null,
  path         text not null,        -- object path within the cdb-images bucket
  caption      text,
  sort_order   int  not null default 0,
  published    boolean not null default false,
  w            int,
  h            int,
  created_by   text,
  created_at   timestamptz not null default now()
);
create index if not exists cdb_img_comm_idx on public.cdb_images(community_id);

-- Meeting notes, optionally tagged to a community.
create table if not exists public.cdb_notes (
  id           uuid primary key default gen_random_uuid(),
  division     text not null default 'orlando',
  note_date    date,
  subject      text,
  community_id uuid,
  attendees    text,
  body         text,
  created_by   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists cdb_notes_comm_idx on public.cdb_notes(community_id);

/* --------------------------------------------------------------- RLS ------ */
alter table public.cdb_app_roles     enable row level security;
alter table public.cdb_cis           enable row level security;
alter table public.cdb_cis_revisions enable row level security;
alter table public.cdb_images        enable row level security;
alter table public.cdb_notes         enable row level security;

-- roles: a user can read their own row; admins read all; only admins write
drop policy if exists cdb_roles_read on public.cdb_app_roles;
create policy cdb_roles_read on public.cdb_app_roles for select
  using (email = public.cdb_email() or public.cdb_is_admin());
drop policy if exists cdb_roles_write on public.cdb_app_roles;
create policy cdb_roles_write on public.cdb_app_roles for all
  using (public.cdb_is_admin()) with check (public.cdb_is_admin());

-- CIS: viewers see published only; editors see everything and may write
drop policy if exists cdb_cis_read on public.cdb_cis;
create policy cdb_cis_read on public.cdb_cis for select
  using (public.cdb_is_lennar() and (status = 'published' or public.cdb_is_editor()));
drop policy if exists cdb_cis_write on public.cdb_cis;
create policy cdb_cis_write on public.cdb_cis for all
  using (public.cdb_is_editor()) with check (public.cdb_is_editor());

-- revisions: editors only (written by the publish RPC)
drop policy if exists cdb_rev_read on public.cdb_cis_revisions;
create policy cdb_rev_read on public.cdb_cis_revisions for select
  using (public.cdb_is_editor());

-- images: viewers see published; editors see all and may write
drop policy if exists cdb_img_read on public.cdb_images;
create policy cdb_img_read on public.cdb_images for select
  using (public.cdb_is_lennar() and (published or public.cdb_is_editor()));
drop policy if exists cdb_img_write on public.cdb_images;
create policy cdb_img_write on public.cdb_images for all
  using (public.cdb_is_editor()) with check (public.cdb_is_editor());

-- notes: any signed-in @lennar.com user may read; editors may write
drop policy if exists cdb_notes_read on public.cdb_notes;
create policy cdb_notes_read on public.cdb_notes for select
  using (public.cdb_is_lennar());
drop policy if exists cdb_notes_write on public.cdb_notes;
create policy cdb_notes_write on public.cdb_notes for all
  using (public.cdb_is_editor()) with check (public.cdb_is_editor());

/* --------------------------------------------------- publish workflow ----- */
-- Copy a community's draft onto its published row, snapshot a revision,
-- publish that community's images, and clear the draft. Editors/admins only.
create or replace function public.cdb_publish(p_community_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d public.cdb_cis; v_rev text; v_data jsonb; begin
  if not public.cdb_is_editor() then
    return jsonb_build_object('ok', false, 'error', 'Not authorized.');
  end if;
  select * into d from public.cdb_cis where community_id = p_community_id and status = 'draft';
  if not found then
    return jsonb_build_object('ok', false, 'error', 'No draft to publish.');
  end if;

  -- stamp the published copy with a revision date (M.D.YY, Eastern time)
  v_rev := to_char((now() at time zone 'America/New_York'), 'FMMM.FMDD.YY');
  v_data := coalesce(d.data, '{}'::jsonb);
  if not (v_data ? 'f') then v_data := v_data || '{"f":{}}'::jsonb; end if;
  v_data := jsonb_set(v_data, '{f,rev_date}', to_jsonb(v_rev), true);

  insert into public.cdb_cis
        (community_id, division, status, name, jde, project_name, hub, source,
         model_start, needs_review, active, data, updated_at, updated_by, published_at)
  values (d.community_id, d.division, 'published', d.name, d.jde, d.project_name, d.hub, d.source,
         d.model_start, false, d.active, v_data, now(), public.cdb_email(), now())
  on conflict (community_id, status) do update set
        division=excluded.division, name=excluded.name, jde=excluded.jde,
        project_name=excluded.project_name, hub=excluded.hub, source=excluded.source,
        model_start=excluded.model_start, needs_review=false, active=excluded.active, data=excluded.data,
        updated_at=now(), updated_by=public.cdb_email(), published_at=now();

  insert into public.cdb_cis_revisions (community_id, name, jde, data, published_by)
  values (d.community_id, d.name, d.jde, v_data, public.cdb_email());

  update public.cdb_images set published = true where community_id = d.community_id;

  delete from public.cdb_cis where community_id = p_community_id and status = 'draft';
  return jsonb_build_object('ok', true);
end $$;

-- Start (or resume) an editable draft for an already-published community by
-- cloning the published row into a draft the editor can work on.
create or replace function public.cdb_start_draft(p_community_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p public.cdb_cis; begin
  if not public.cdb_is_editor() then
    return jsonb_build_object('ok', false, 'error', 'Not authorized.');
  end if;
  if exists (select 1 from public.cdb_cis where community_id = p_community_id and status='draft') then
    return jsonb_build_object('ok', true, 'note', 'Draft already exists.');
  end if;
  select * into p from public.cdb_cis where community_id = p_community_id and status='published';
  if not found then return jsonb_build_object('ok', false, 'error', 'Nothing published to edit.'); end if;
  insert into public.cdb_cis
        (community_id, division, status, name, jde, project_name, hub, source,
         model_start, needs_review, data, updated_at, updated_by)
  values (p.community_id, p.division, 'draft', p.name, p.jde, p.project_name, p.hub, p.source,
         p.model_start, p.needs_review, p.data, now(), public.cdb_email());
  return jsonb_build_object('ok', true);
end $$;

-- Unpublish: remove a community from the live viewer side and return it to a
-- draft. If a draft already exists it becomes the working copy (the published
-- row is dropped); otherwise the published row is converted to a draft.
-- Images for the community are hidden from viewers again.
create or replace function public.cdb_unpublish(p_community_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.cdb_is_editor() then
    return jsonb_build_object('ok', false, 'error', 'Not authorized.');
  end if;
  if not exists (select 1 from public.cdb_cis where community_id = p_community_id and status='published') then
    return jsonb_build_object('ok', false, 'error', 'Nothing published to unpublish.');
  end if;
  if exists (select 1 from public.cdb_cis where community_id = p_community_id and status='draft') then
    delete from public.cdb_cis where community_id = p_community_id and status='published';
  else
    update public.cdb_cis set status='draft', published_at=null, updated_at=now(), updated_by=public.cdb_email()
      where community_id = p_community_id and status='published';
  end if;
  update public.cdb_images set published=false where community_id = p_community_id;
  return jsonb_build_object('ok', true);
end $$;

-- Delete a community entirely: draft + published + revisions + image rows.
-- Returns the image storage paths so the client can remove the files too.
create or replace function public.cdb_delete_community(p_community_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_paths text[]; begin
  if not public.cdb_is_editor() then
    return jsonb_build_object('ok', false, 'error', 'Not authorized.');
  end if;
  select coalesce(array_agg(path), '{}') into v_paths
    from public.cdb_images where community_id = p_community_id;
  delete from public.cdb_images        where community_id = p_community_id;
  delete from public.cdb_cis_revisions where community_id = p_community_id;
  delete from public.cdb_cis           where community_id = p_community_id;
  return jsonb_build_object('ok', true, 'paths', to_jsonb(v_paths));
end $$;

/* ---------------------------------------- user admin (reset-link flow) ----
   Self-contained (cdb_-scoped) copy of the add-user / password-reset flow used
   by the other portals. No email is sent — the admin shares the one-time link.
   ------------------------------------------------------------------------- */
create table if not exists public.cdb_reset_tokens (
  token      text primary key,
  email      text not null,
  created_at timestamptz not null default now(),
  used_at    timestamptz
);
alter table public.cdb_reset_tokens enable row level security;  -- no direct client access

create or replace function public.cdb_admin_add_or_reset(target_email text)
returns jsonb language plpgsql security definer set search_path = public, auth, extensions as $$
declare v_email text := lower(trim(target_email)); v_uid uuid; v_token text; begin
  if not public.cdb_is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Not authorized.');
  end if;
  if v_email not like '%@lennar.com' then
    return jsonb_build_object('ok', false, 'error', 'Email must be @lennar.com.');
  end if;

  select id into v_uid from auth.users where lower(email) = v_email;
  if v_uid is null then
    v_uid := gen_random_uuid();
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                            email_confirmed_at, created_at, updated_at,
                            raw_app_meta_data, raw_user_meta_data,
                            confirmation_token, recovery_token, email_change,
                            email_change_token_new, email_change_token_current,
                            phone_change, phone_change_token, reauthentication_token)
    values (v_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            v_email, crypt(gen_random_uuid()::text, gen_salt('bf')),
            now(), now(), now(),
            '{"provider":"email","providers":["email"]}', '{}',
            '', '', '', '', '', '', '', '');   -- GoTrue requires these to be '' (not NULL)
  end if;

  insert into public.cdb_app_roles (email, role)
  values (v_email, 'viewer') on conflict (email) do nothing;

  v_token := encode(gen_random_bytes(24), 'hex');
  insert into public.cdb_reset_tokens (token, email) values (v_token, v_email);
  return jsonb_build_object('ok', true, 'token', v_token, 'email', v_email);
end $$;

create or replace function public.cdb_redeem_reset_token(p_token text, p_new_password text)
returns jsonb language plpgsql security definer set search_path = public, auth, extensions as $$
declare v_email text; v_created timestamptz; v_used timestamptz; begin
  if length(coalesce(p_new_password,'')) < 8 then
    return jsonb_build_object('ok', false, 'error', 'Password must be at least 8 characters.');
  end if;
  select email, created_at, used_at into v_email, v_created, v_used
    from public.cdb_reset_tokens where token = p_token;
  if v_email is null then return jsonb_build_object('ok', false, 'error', 'Invalid link.'); end if;
  if v_used is not null then return jsonb_build_object('ok', false, 'error', 'This link was already used.'); end if;
  if now() - v_created > interval '14 days' then
    return jsonb_build_object('ok', false, 'error', 'This link has expired.');
  end if;
  update auth.users
     set encrypted_password = crypt(p_new_password, gen_salt('bf')),
         email_confirmed_at = coalesce(email_confirmed_at, now()),
         updated_at = now()
   where lower(email) = v_email;
  update public.cdb_reset_tokens set used_at = now() where token = p_token;
  return jsonb_build_object('ok', true);
end $$;

-- List every existing auth user (shared across the portals) with their role,
-- defaulting to 'viewer' — same behavior as the other two sites.
create or replace function public.cdb_admin_list_users()
returns table(email text, role text) language sql security definer set search_path = public, auth as $$
  select lower(u.email) as email, coalesce(r.role, 'viewer') as role
  from auth.users u
  left join public.cdb_app_roles r on lower(r.email) = lower(u.email)
  where public.cdb_is_admin() and u.email is not null
  order by lower(u.email)
$$;

/* -------------------------------------------------------- storage bucket -- */
insert into storage.buckets (id, name, public)
  values ('cdb-images','cdb-images', false)
  on conflict (id) do nothing;

drop policy if exists cdb_img_obj_read on storage.objects;
create policy cdb_img_obj_read on storage.objects for select
  using (bucket_id = 'cdb-images' and public.cdb_is_lennar());
drop policy if exists cdb_img_obj_write on storage.objects;
create policy cdb_img_obj_write on storage.objects for insert
  with check (bucket_id = 'cdb-images' and public.cdb_is_editor());
drop policy if exists cdb_img_obj_del on storage.objects;
create policy cdb_img_obj_del on storage.objects for delete
  using (bucket_id = 'cdb-images' and public.cdb_is_editor());

/* --------------------------------------------------------------- seed ----- */
-- Make the first admin. Change the email if needed, then this row lets you
-- sign in and manage everyone else from the in-app Admin page.
insert into public.cdb_app_roles (email, role)
  values ('stephen.svedman@lennar.com','admin')
  on conflict (email) do update set role = 'admin';

/* Done. Next: create the auth user's password with a reset link from the
   Admin page (or Supabase > Authentication > Users), then sign in. */
