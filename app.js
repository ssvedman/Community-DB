/* ============================================================
   Community-DB — app
   Login-gated. Viewers see PUBLISHED community info only.
   Editors/admins draft, save-and-resume, publish, and edit published.
   ============================================================ */
"use strict";
const CFG = window.APP_CONFIG;
const SCHEMA = window.CIS;
const DEMO = !CFG.SUPABASE_URL || CFG.SUPABASE_URL.startsWith("YOUR_");
let sb = null;
if (!DEMO && window.supabase) sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
  auth: { persistSession:true, autoRefreshToken:true, detectSessionInUrl:true, storageKey:"lennar-vendor-portal-auth" }
});
/* Sign out in one app signs out of all of them. All four sites share an origin and
   the storageKey above, so clearing the session raises a storage event in every
   other open tab. Without this an already-open tab keeps its in-memory session and
   its cached JWT stays valid until expiry — it would look signed in for up to an
   hour after you signed out elsewhere. */
if (!DEMO && window.supabase) {
  window.addEventListener("storage", function (e) {
    if (e.key === "lennar-vendor-portal-auth" && !e.newValue) location.reload();
  });
}

const state = { changeLog:[], encCompare:false, email:null, role:"viewer", mode:"view", view:"browse",
                items:[], notes:[], imgs:{}, imgUrls:{}, sel:null, q:"", showInactive:false, draftsOnly:false, users:[],
                pubq:[], pubqOpen:true, pubqBusy:false,
                tpl:null, tplNew:{}, tplMeta:{}, tplBusy:false };
const $  = id => document.getElementById(id);
const esc = s => String(s==null?"":s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const lc = s => String(s==null?"":s).toLowerCase();
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : "id"+Date.now()+Math.random().toString(16).slice(2));
// date helpers — canonical display format is M.D.YY
const DATE_KEYS = { date:1, trench_date:1 };
function normDate(s){ const m=String(s==null?"":s).trim().match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})$/);
  if(!m) return String(s==null?"":s).trim(); let y=(+m[3])%100; return `${+m[1]}.${+m[2]}.${String(y).padStart(2,"0")}`; }
function dateToISO(s){ const m=String(s==null?"":s).trim().match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})$/);
  if(!m) return ""; let y=+m[3]; if(y<100) y+=2000; return `${y}-${String(+m[1]).padStart(2,"0")}-${String(+m[2]).padStart(2,"0")}`; }
function isoToDate(iso){ const m=String(iso||"").match(/^(\d{4})-(\d{2})-(\d{2})$/); return m?`${+m[2]}.${+m[3]}.${String((+m[1])%100).padStart(2,"0")}`:iso; }
/* ---------------- TEMPLATE ----------------
   The section/row layout every sheet renders with. Defaults come from config.js;
   an admin-saved layout in cdb_template replaces them at sign-in.
   Template edits never touch community data:
   - a removed row/section is marked `retired` — it drops off sheets where it's
     empty, and sheets that already hold a value keep it and keep showing it;
   - grid (Model) rows carry either `pos` (the original positional rows, cells in
     d.model[pos]) or `k` (rows added by the template, cells in d.gridx[key][k]),
     so adding/reordering template rows never shifts existing cell data. Per-sheet
     custom rows stay at d.model[presetBase + j] with labels in d.model_labels. */
const TPL_ID = (CFG.DIVISION && CFG.DIVISION.key) || "orlando";
const clone = o => JSON.parse(JSON.stringify(o));
function normTemplate(secs){
  return (Array.isArray(secs)?secs:[]).filter(s=>s&&s.id&&s.kind).map(s0=>{ const s=clone(s0);
    s.title=String(s.title||"");
    if(s.kind==="kv") s.fields=(Array.isArray(s.fields)?s.fields:[]).filter(f=>f&&f.k).map(f=>({...f,label:String(f.label||"")}));
    if(s.kind==="grid"){
      if(!Array.isArray(s.rows)) s.rows=(s.rowLabels||[]).map((l,i)=>({label:String(l||""),pos:i}));
      if(typeof s.presetBase!=="number") s.presetBase=Array.isArray(s.rowLabels)?s.rowLabels.length
        : s.rows.reduce((m,r)=>typeof r.pos==="number"?Math.max(m,r.pos+1):m,0);
      delete s.rowLabels; s.columns=Array.isArray(s.columns)?s.columns:[];
    }
    return s; });
}
SCHEMA.DEFAULT_SECTIONS = normTemplate(SCHEMA.SECTIONS);
SCHEMA.SECTIONS = clone(SCHEMA.DEFAULT_SECTIONS);
async function loadTemplate(){
  state.tplMeta={ updated_at:null, updated_by:null, saved:false };
  if(DEMO||!sb) return;
  try{ const { data, error }=await sb.from("cdb_template").select("*").eq("id",TPL_ID).maybeSingle();
    if(error){ console.warn("template load failed — using defaults",error); return; }
    if(data && Array.isArray(data.sections) && data.sections.length){
      SCHEMA.SECTIONS=normTemplate(data.sections);
      state.tplMeta={ updated_at:data.updated_at, updated_by:data.updated_by, saved:true };
    }
  }catch(e){ console.warn("template load failed — using defaults",e); }
}
const isEditor = () => state.role==="editor" || state.role==="admin";
const isAdmin  = () => state.role==="admin";
const making   = () => state.mode==="make" && isEditor();

/* ---------------- custom modal dialogs (replace browser prompt/confirm/alert) ---------------- */
function openModal({title, body, buttons}){
  return new Promise(resolve=>{
    const scrim=document.createElement("div"); scrim.className="modal-scrim";
    const card=document.createElement("div"); card.className="modal-card";
    card.innerHTML=`<div class="modal-h">${esc(title||"")}</div><div class="modal-b">${body||""}</div><div class="modal-f"></div>`;
    const foot=card.querySelector(".modal-f");
    const close=v=>{ document.removeEventListener("keydown",onKey); scrim.remove(); resolve(v); };
    (buttons||[]).forEach(b=>{ const btn=document.createElement("button");
      btn.className="modal-btn"+(b.primary?" primary":"")+(b.danger?" danger":"");
      btn.textContent=b.label;
      btn.onclick=()=>close(typeof b.value==="function"?b.value(card):b.value);
      foot.appendChild(btn); });
    scrim.appendChild(card); document.body.appendChild(scrim);
    scrim.addEventListener("mousedown",e=>{ if(e.target===scrim) close(undefined); });
    const onKey=e=>{ if(e.key==="Escape") close(undefined); };
    document.addEventListener("keydown",onKey);
    const inp=card.querySelector("input,textarea");
    const primary=foot.querySelector(".modal-btn.primary");
    if(inp){ inp.focus(); if(inp.select) inp.select();
      inp.addEventListener("keydown",e=>{ if(e.key==="Enter"&&inp.tagName!=="TEXTAREA"){ e.preventDefault(); primary&&primary.click(); } }); }
  });
}
function uiAlert(message,title){ return openModal({title:title||"Community-DB",body:`<p>${esc(message)}</p>`,buttons:[{label:"OK",value:true,primary:true}]}); }
function uiConfirm(message,opts){ opts=opts||{};
  return openModal({title:opts.title||"Please confirm",body:`<p>${esc(message)}</p>`,
    buttons:[{label:opts.cancelText||"Cancel",value:false},{label:opts.okText||"OK",value:true,primary:!opts.danger,danger:!!opts.danger}]
  }).then(v=>v===true); }
function uiPrompt(label,opts){ opts=opts||{};
  return openModal({title:opts.title||"Enter a value",
    body:`<label class="fld">${esc(label)}</label><input type="text" class="modal-input" placeholder="${esc(opts.placeholder||"")}" value="${esc(opts.value||"")}">`,
    buttons:[{label:opts.cancelText||"Cancel",value:null},
             {label:opts.okText||"Save",primary:true,value:card=>{ const el=card.querySelector(".modal-input"); return el?el.value.trim():null; }}]
  }); }
function uiTextarea(label,value,opts){ opts=opts||{};
  return openModal({title:opts.title||label||"Edit",
    body:`<label class="fld">${esc(label||"")}</label><textarea class="modal-input" rows="4" style="resize:vertical">${esc(value||"")}</textarea>`,
    buttons:[{label:opts.cancelText||"Cancel",value:null},
             {label:opts.okText||"Save",primary:true,value:card=>{ const el=card.querySelector(".modal-input"); return el?el.value:null; }}]
  }); }

/* theme */
(function(){ try{ const t=localStorage.getItem("cdb_theme"); if(t) document.documentElement.setAttribute("data-theme",t); }catch(e){} })();
function toggleTheme(){ const d=document.documentElement.getAttribute("data-theme")==="dark"; const n=d?"light":"dark";
  document.documentElement.setAttribute("data-theme",n); try{localStorage.setItem("cdb_theme",n);}catch(e){}
  const b=$("themeBtn"); if(b) b.textContent=n==="dark"?"Light":"Dark"; }

/* ---------------- AUTH ---------------- */
function authMsg(t,k){ const m=$("authMsg"); m.className="msg "+(k||"info"); m.textContent=t; }
function clearAuth(){ const m=$("authMsg"); m.className="msg"; m.textContent=""; }
$("signinBtn").addEventListener("click", signIn);
$("email").addEventListener("keydown", e=>{ if(e.key==="Enter") $("password").focus(); });
$("password").addEventListener("keydown", e=>{ if(e.key==="Enter") signIn(); });

async function signIn(){
  const email=lc($("email").value.trim()), password=$("password").value; clearAuth();
  if(!email||!email.includes("@")) return authMsg("Please enter your email address.","err");
  if(!email.endsWith(CFG.ALLOWED_DOMAIN)) return authMsg("Access is limited to "+CFG.ALLOWED_DOMAIN+" addresses.","err");
  if(!password) return authMsg("Please enter your password.","err");
  $("signinBtn").disabled=true; $("signinBtn").textContent="Signing in…";
  try{
    if(DEMO){ await new Promise(r=>setTimeout(r,250)); return enterApp(email); }
    const {error}=await sb.auth.signInWithPassword({email,password}); if(error) throw error;
    enterApp(email);
  }catch(e){ const m=(e&&e.message)||"";
    authMsg(/invalid login credentials/i.test(m)?"Incorrect email or password.":
      /email not confirmed/i.test(m)?"Your account isn't activated yet — contact the admin.":(m||"Sign-in failed."),"err");
  }finally{ $("signinBtn").disabled=false; $("signinBtn").textContent="Sign in"; }
}
async function checkSession(){ if(DEMO||!sb) return;
  const {data}=await sb.auth.getSession();
  if(data&&data.session&&data.session.user) enterApp(data.session.user.email);
  sb.auth.onAuthStateChange((_e,s)=>{ if(s&&s.user) enterApp(s.user.email); });
}
function getRecoverToken(){ const m=(location.hash||"").match(/[#&]recover=([^&]+)/); return m?decodeURIComponent(m[1]):null; }
function initRecovery(){
  const tok=getRecoverToken(); if(!tok) return false;
  window._recovering=true; $("app").classList.add("hidden"); $("auth").classList.remove("hidden");
  const sub=document.querySelector(".auth-sub"); if(sub) sub.textContent="Set a new password for your account.";
  $("stepSignin").classList.add("hidden"); $("stepRecover").classList.remove("hidden");
  $("setPassBtn").addEventListener("click",()=>redeemReset(tok));
  $("newPass2").addEventListener("keydown",e=>{ if(e.key==="Enter") redeemReset(tok); });
  return true;
}
async function redeemReset(tok){
  const p1=$("newPass").value,p2=$("newPass2").value; clearAuth();
  if(!p1||p1.length<8) return authMsg("Password must be at least 8 characters.","err");
  if(p1!==p2) return authMsg("Passwords don't match.","err");
  $("setPassBtn").disabled=true; $("setPassBtn").textContent="Saving…";
  try{
    const {data,error}=await sb.rpc("cdb_redeem_reset_token",{p_token:tok,p_new_password:p1});
    if(error) throw error; if(!data||!data.ok) throw new Error((data&&data.error)||"Could not set your password.");
    const sub=document.querySelector(".auth-sub"); if(sub) sub.textContent="Password set. You can sign in now.";
    authMsg("Password updated — taking you to sign in…","ok");
    setTimeout(()=>{ location.hash=""; location.reload(); },1500);
  }catch(e){ authMsg((e&&e.message)||"Could not set your password.","err"); }
  finally{ $("setPassBtn").disabled=false; $("setPassBtn").textContent="Set password"; }
}
async function logout(){ if(!DEMO&&sb){ try{ await sb.auth.signOut({scope:"global"}); }catch(e){} try{ localStorage.removeItem("lennar-vendor-portal-auth"); }catch(e){} } location.reload(); }

/* ---------------- ENTER APP ---------------- */
let entered=false;
async function enterApp(email){
  if(window._recovering||entered) return; entered=true;
  state.email=lc(email);
  const fb=CFG.ROLES[state.email]; if(fb) state.role=fb.role||"viewer";
  if(!DEMO&&sb){ try{ const {data}=await sb.from("cdb_app_roles").select("role").eq("email",state.email).maybeSingle();
    if(data&&data.role) state.role=data.role; }catch(e){} }
  $("auth").classList.add("hidden"); $("app").classList.remove("hidden");
  $("userChip").innerHTML=esc(state.email)+` <span class="role-tag">${esc(state.role)}</span>`;
  $("themeBtn").textContent=document.documentElement.getAttribute("data-theme")==="dark"?"Light":"Dark";
  if(isEditor()){ $("modeToggle").classList.remove("hidden"); }
  if(isAdmin()) $("adminLink").classList.remove("hidden");
  wireChrome(); syncEditorTabs(); pubqLoad();
  await loadTemplate(); await loadAll(); render(); refreshWhatsNewBadge();
  applyDeepLink();
}
/* ---------------- DEEP LINK ----------------
   Sibling apps link straight to a community with `#jde=<number>`. Same origin
   and the same shared session, so the link lands inside the record rather than
   on a sign-in screen.

   The hash is cleared once it has been acted on: leaving it in place would
   re-open the same community on every later refresh, which reads as the app
   refusing to let go of a record the user has moved on from.

   An unmatched or unpublished community falls back to putting the number in
   the search box, so the link explains itself instead of doing nothing. */
function applyDeepLink(){
  const m=(location.hash||"").match(/[#&](?:jde|cis)=([^&]+)/);
  if(!m) return false;
  const key=decodeURIComponent(m[1]).trim();
  history.replaceState(null,"",location.pathname+location.search);
  if(!key) return false;
  state.view="browse"; setTab(); showDash();
  const want=lc(key);
  const hit = state.items.find(it=>lc(it.jde)===want)
           || state.items.find(it=>lc(it.name)===want);
  if(!hit){ state.q=key; render(); return true; }
  // a viewer can only see published, active records — relax the toggles rather
  // than opening a detail pane the list doesn't contain
  if(!making()){
    if(!hit.hasPub){ state.q=key; render(); return true; }
    if(!hit.active) state.showInactive=true;
  }
  state.sel=hit.id; render(); openDetail(hit.id);
  return true;
}
// also honour a link pasted into a tab that is already open and signed in
window.addEventListener("hashchange", ()=>{ if(state.email) applyDeepLink(); });
// Gaps and Template live on the maker side only (editors + admins).
function syncEditorTabs(){
  document.querySelectorAll(".editoronly").forEach(el=>el.classList.toggle("hidden", !making()));
}
window.addEventListener("beforeunload", e=>{ if(state.tpl && tplDirty()){ e.preventDefault(); e.returnValue=""; } });
function wireChrome(){
  $("logoutBtn").onclick=logout; $("themeBtn").onclick=toggleTheme;
  if($("whatsNewBtn")) $("whatsNewBtn").onclick=openWhatsNew;
  $("homeLogo").onclick=()=>{ showDash(); state.view="browse"; setTab(); render(); };
  $("adminLink").onclick=showAdmin; $("dashLink").onclick=()=>{ showDash(); render(); };
  $("modeToggle").querySelectorAll(".mode").forEach(b=>b.onclick=()=>{
    state.mode=b.dataset.mode; $("modeToggle").querySelectorAll(".mode").forEach(x=>x.classList.toggle("on",x===b));
    if(state.mode==="view" && (state.view==="gaps"||state.view==="template")){ state.view="browse"; setTab(); }
    syncEditorTabs(); render();
  });
  $("tabs").querySelectorAll(".tab").forEach(t=>t.onclick=()=>{ state.view=t.dataset.view; setTab(); showDash(); render(); });
  $("lightbox").onclick=()=>$("lightbox").classList.remove("on");
}
function setTab(){ $("tabs").querySelectorAll(".tab").forEach(t=>t.classList.toggle("active",t.dataset.view===state.view)); }
function showDash(){ $("dashboard").classList.remove("hidden"); $("admin").classList.add("hidden"); $("dashLink").classList.add("hidden"); }
function showAdmin(){ if(!isAdmin())return; $("dashboard").classList.add("hidden"); $("admin").classList.remove("hidden"); $("dashLink").classList.remove("hidden"); renderResetLink(); renderPerms(); }

/* ---------------- DATA ---------------- */
async function loadAll(){
  state.items=[]; state.notes=[]; state.imgs={}; state.imgUrls={};   // signed URLs last 1h — re-sign every load
  if(DEMO||!sb) return;
  try{
    const { data:cis } = await sb.from("cdb_cis").select("*");
    const byComm=new Map();
    (cis||[]).forEach(r=>{ let e=byComm.get(r.community_id);
      if(!e){ e={ community_id:r.community_id, pub:null, draft:null }; byComm.set(r.community_id,e); }
      if(r.status==="published") e.pub=r; else e.draft=r; });
    state.items=[...byComm.values()].map(e=>{
      const primary = making() ? (e.draft||e.pub) : (e.pub||e.draft);
      const activeRow = e.pub || e.draft;
      return { id:e.community_id, pub:e.pub, draft:e.draft, primary,
        name:(primary&&primary.name)||"", jde:(primary&&primary.jde)||"",
        hub:(primary&&primary.hub)||"", source:(primary&&primary.source)||"manual",
        active: activeRow ? activeRow.active!==false : true,
        hasPub:!!e.pub, hasDraft:!!e.draft };
    }).filter(it=> it.pub || it.draft ).sort((a,b)=>String(a.name).localeCompare(String(b.name)));

    const { data:imgs } = await sb.from("cdb_images").select("*").order("sort_order");
    (imgs||[]).forEach(im=>{ (state.imgs[im.community_id]=state.imgs[im.community_id]||[]).push(im); });
    await signImages(imgs||[]);
  }catch(e){ console.error(e); }
  // recent publish history (drives the What's New feed + unread row dots)
  try{
    const since=new Date(Date.now()-90*864e5).toISOString();
    const { data:log } = await sb.from("cdb_change_log").select("*").gte("at",since).order("at",{ascending:false}).limit(300);
    state.changeLog=log||[];
  }catch(e){ state.changeLog=[]; }
}
async function signImages(imgs){
  const need=imgs.filter(im=>!state.imgUrls[im.path]).map(im=>im.path);
  if(!need.length||!sb) return;
  try{ const { data } = await sb.storage.from(CFG.IMAGE_BUCKET).createSignedUrls(need, 3600);
    (data||[]).forEach(d=>{ if(d&&d.signedUrl) state.imgUrls[d.path]=d.signedUrl; }); }catch(e){}
}
// Full-text haystack for a community: name, JDE, every field value, plan cells, note.
function itemHay(it){
  const row = making() ? (it.draft||it.pub) : (it.pub||it.draft);
  const parts=[it.name, it.jde];
  const d=(row&&row.data)||{};
  if(d.f) for(const k in d.f) parts.push(d.f[k]);
  if(Array.isArray(d.plans)) d.plans.forEach(r=>Array.isArray(r)&&r.forEach(c=>parts.push(c)));
  if(d.note) parts.push(d.note);
  if(d.extra) for(const s in d.extra) (d.extra[s]||[]).forEach(pr=>{ parts.push(pr[0]); parts.push(pr[1]); });
  return lc(parts.join(" "));
}
function visibleItems(){
  // viewer: only published, active-only unless "show inactive"; maker: everything
  let list = making() ? (state.draftsOnly ? state.items.filter(it=>it.hasDraft) : state.items)
                      : state.items.filter(it=>it.hasPub && (state.showInactive || it.active));
  const q=lc(state.q);
  if(q) list=list.filter(it=>itemHay(it).includes(q));
  return list;
}

/* ---------------- RENDER ROUTER ---------------- */
function render(){
  updateCounts(); renderPubq();
  const a=$("viewArea");
  a.classList.remove("mob-detail");   // reset mobile detail state on any view change
  if(state.view==="browse") return renderBrowse(a);
  if(state.view==="gaps"  && making()) return renderGaps(a);
  if(state.view==="template" && making()) return renderTemplate(a);
  state.view="browse"; setTab(); renderBrowse(a);
}
function updateCounts(){
  $("cBrowse").textContent = clusterList().length;
  const g=$("cGaps"); if(g) g.textContent = making()? gapRows().length : "";
  const t=$("cTpl"); if(t) t.classList.toggle("hidden", !(state.tpl && tplDirty()));
}

/* ---------------- COMMUNITY CLUSTERS (enclaves) ----------------
   One community can be split into enclaves (Crossprairie 50's / 32's / 25ft TH).
   The records already share data.f.community_name while name/project_name differ,
   so grouping is DERIVED — one cdb_cis row per enclave, no schema change, and
   drafts/publish/What's New keep working per record. The selector shows one row
   per group; the sheet shows shared values once and puts an enclave dropdown on
   sections that hold enclave-specific values. */
function clusterNameOf(it){ const row=shownRow(it); const d=(row&&row.data)||{};
  return (fval(d,"community_name")||it.name||"").trim(); }
function clusterKeyOf(it){ const n=lc(clusterNameOf(it)).trim(); return n||("solo:"+it.id); }
function encLabel(grp,it){
  const row=shownRow(it); const gn=(grp.name||"").trim();
  const cands=[String(it.name||""), String((row&&row.project_name)||""), fval((row&&row.data)||{},"project_name")];
  for(const c0 of cands){ const c=c0.trim(); if(!c) continue;
    if(gn && lc(c).startsWith(lc(gn))){ const s=c.slice(gn.length).replace(/^[\s\-–—·:,]+/,"").trim(); if(s) return s; }
    else if(lc(c)!==lc(gn)) return c;
  }
  return it.jde?("JDE "+it.jde):"(enclave)";
}
/* the browse-eligibility rules WITHOUT the search filter (search is applied per
   group so a JDE hit still opens the whole community with that enclave selected) */
function eligibleItems(){
  return making() ? (state.draftsOnly ? state.items.filter(it=>it.hasDraft) : state.items)
                  : state.items.filter(it=>it.hasPub && (state.showInactive || it.active));
}
function sortEnclaves(g){ g.items.sort((a,b)=>String(encLabel(g,a)).localeCompare(String(encLabel(g,b)),undefined,{numeric:true})); }
function clusterList(){
  const q=lc(state.q);
  const map=new Map();
  eligibleItems().forEach(it=>{ const k=clusterKeyOf(it);
    let g=map.get(k); if(!g){ g={key:k, name:clusterNameOf(it)||it.name||"(untitled)", items:[], hit:null}; map.set(k,g); }
    g.items.push(it); });
  const out=[];
  map.forEach(g=>{ sortEnclaves(g);
    if(q){ g.hit=g.items.find(it=>itemHay(it).includes(q))||null; if(!g.hit) return; }
    out.push(g); });
  out.sort((a,b)=>String(a.name).localeCompare(String(b.name)));
  return out;
}
function clusterFor(id){
  const it=itemById(id); if(!it) return null;
  const k=clusterKeyOf(it);
  const g={key:k, name:clusterNameOf(it)||it.name||"(untitled)", items:eligibleItems().filter(x=>clusterKeyOf(x)===k)};
  if(!g.items.some(x=>x.id===id)) g.items.push(it);
  sortEnclaves(g);
  return g;
}

/* ---------------- BROWSE ---------------- */
function renderBrowse(a){
  const groups=clusterList();
  const draftN=making()?state.items.filter(it=>it.hasDraft).length:0;
  a.innerHTML = `
    <div class="bar">
      <input type="search" id="q" placeholder="Search name, JDE, plan #, or any field (e.g. H006)…" value="${esc(state.q)}">
      ${making()?`<button class="btn mini solid" id="newComm">+ New community</button>
                  ${draftN?`<button class="btn mini ghost" id="pubAll" title="Make every current draft live for viewers">Publish all drafts (${draftN})</button>`:""}
                  <label class="hint" style="display:inline-flex;align-items:center;gap:5px"><input type="checkbox" id="draftsOnly" ${state.draftsOnly?"checked":""}> Drafts only</label>`
                :`<label class="hint" style="display:inline-flex;align-items:center;gap:5px"><input type="checkbox" id="showInactive" ${state.showInactive?"checked":""}> Show inactive</label>`}
      <span class="hint">${groups.length} ${groups.length===1?"community":"communities"}${making()?" · editing drafts":""}</span>
    </div>
    <div class="split" id="split">
      <div class="list" id="list">${groups.map(groupRowHTML).join("")||`<div class="empty">No communities${state.q?" match your search":making()?" yet — add one":" published yet"}.</div>`}</div>
      <div class="panel" id="detail"><div class="empty">Select a community.</div></div>
    </div>`;
  const repaintList=()=>{ const l=$("list"); const gs=clusterList();
    l.innerHTML=gs.map(groupRowHTML).join("")||`<div class="empty">No matches.</div>`; wireRows(); updateCounts(); };
  $("q").addEventListener("input",e=>{ state.q=e.target.value; repaintList(); });
  if(making()){ $("newComm").onclick=newCommunity;
    if($("pubAll")) $("pubAll").onclick=()=>publishAllDrafts();
    if($("draftsOnly")) $("draftsOnly").onclick=e=>{ state.draftsOnly=e.target.checked; repaintList(); }; }
  else if($("showInactive")) $("showInactive").onclick=e=>{ state.showInactive=e.target.checked; repaintList(); };
  wireRows();
  if(state.sel && groups.some(g=>g.items.some(x=>x.id===state.sel))) openDetail(state.sel);
}
function groupRowHTML(g){
  const multi=g.items.length>1;
  const it0=g.items[0];
  const selected=g.items.some(it=>it.id===state.sel);
  const unseen=g.items.some(it=>commUnseen(it.id));
  const pills=[];
  if(multi) pills.push(`<span class="pill enc">${g.items.length} enclaves</span>`);
  if(multi ? g.items.every(x=>!x.active) : !it0.active) pills.push(`<span class="pill off">Inactive</span>`);
  if(!multi && it0.source==="DECK") pills.push(`<span class="pill deck">Deck</span>`);
  if(making()){ if(g.items.some(x=>x.hasDraft)) pills.push(`<span class="pill draft">Draft</span>`);
    if(g.items.some(x=>x.hasPub)) pills.push(`<span class="pill pub">Published</span>`); }
  const label = multi ? g.name : (it0.name||g.name||"(untitled)");
  const openId = (g.hit&&g.hit.id) || (selected?state.sel:it0.id);
  return `<div class="row ${selected?"sel":""}" data-id="${openId}" data-gkey="${esc(g.key)}">
    ${unseen?`<span class="row-dot" title="Updated recently — open to mark as read"></span>`:""}
    <div class="nm">${esc(label)}</div>
    <div class="mt">${!multi&&it0.jde?`JDE ${esc(it0.jde)}`:""} ${pills.join(" ")}</div></div>`;
}
function wireRows(){ $("list")&&$("list").querySelectorAll(".row").forEach(r=>r.onclick=()=>openDetail(r.dataset.id)); }
/* dropdown menus in the detail header (Export / Enclaves / More) */
function wireMenu(btnId, menuId){
  const b=$(btnId), m=$(menuId); if(!b||!m) return;
  b.onclick=e=>{ e.stopPropagation();
    document.querySelectorAll(".exp-menu").forEach(x=>{ if(x!==m) x.classList.add("hidden"); });
    m.classList.toggle("hidden");
    if(!m.classList.contains("hidden")) document.addEventListener("click",()=>m.classList.add("hidden"),{once:true}); };
}

function itemById(id){ return state.items.find(it=>it.id===id); }
function shownRow(it){ return making() ? (it.draft||it.pub) : (it.pub||it.draft); }

function openDetail(id){
  state.sel=id; const it=itemById(id); if(!it) return;
  const grp=clusterFor(id)||{key:null,name:it.name,items:[it]};
  const multi=grp.items.length>1;
  if(!multi) state.encCompare=false;
  grp.items.forEach(x=>markCommSeen(x.id));   // opening a community clears its unread dot
  $("list")&&$("list").querySelectorAll(".row").forEach(r=>{
    const on = grp.key && r.dataset.gkey ? r.dataset.gkey===grp.key : r.dataset.id===id;
    r.classList.toggle("sel",on);
    if(on){ const dot=r.querySelector(".row-dot"); if(dot) dot.remove(); r.dataset.id=id; } });
  const row=shownRow(it); const d=row?row.data||{}:{};
  const editing = making();
  const actLbl = multi ? encLabel(grp,it) : "";
  const acts=[];
  if(!editing){   // exports only on the viewer side (a cluster exports the selected enclave, or the whole community)
    acts.push(`<span class="exp-wrap"><button class="btn mini ghost" id="btnExport">&#8681; Export &#9662;</button>
      <div class="exp-menu hidden" id="expMenu">
        <button data-exp="pdf">PDF${multi?" — "+esc(actLbl):""}</button>
        <button data-exp="xlsx">Excel${multi?" — "+esc(actLbl):""}</button>
        ${multi?`<button data-exp="pdfall">PDF — all enclaves</button>
        <button data-exp="xlsxall">Excel — all enclaves</button>`:""}
      </div></span>`);
  }
  if(editing){
    if(it.hasDraft) acts.push(`<button class="btn mini solid" id="btnPublish">Publish${multi?" "+esc(actLbl):""}</button>`);
    else if(it.hasPub) acts.push(`<button class="btn mini" id="btnEdit">Edit${multi?" "+esc(actLbl):""}</button>`);
    acts.push(`<span class="exp-wrap"><button class="btn mini ghost" id="btnEncMenu">Enclaves &#9662;</button>
      <div class="exp-menu hidden" id="encMenu">
        <button data-enc="add">+ Add enclave</button>
        <button data-enc="attach">Attach existing sheet…</button>
        ${multi?`<button data-enc="rename">Rename community</button>
        <button data-enc="detach">Detach ${esc(actLbl)}</button>`:""}
      </div></span>`);
    acts.push(`<span class="exp-wrap"><button class="btn mini ghost" id="btnMore">More &#9662;</button>
      <div class="exp-menu hidden" id="moreMenu">
        ${it.hasDraft?`<button data-more="discard">Discard draft</button>`:""}
        <button data-more="active">${it.active?"Set inactive":"Set active"}</button>
        ${it.hasPub?`<button data-more="unpublish">Unpublish</button>`:""}
        <button data-more="delete" class="danger-item">Delete${multi?" "+esc(actLbl):""}</button>
      </div></span>`);
  }
  const inactivePill = it.active ? "" : ` <span class="pill off">Inactive</span>`;
  const statusLine = (editing
    ? (it.hasDraft?`<span class="pill draft">Editing draft</span>`:"")+(it.hasPub?` <span class="pill pub">Live version published</span>`:` <span class="pill draft">Not yet published</span>`)
    : `<span class="pill pub">Published</span>`) + inactivePill;
  const statusMini = (editing
    ? (it.hasDraft?`<span class="pill draft">Draft</span>`:"")+(it.hasPub?` <span class="pill pub">Published</span>`:` <span class="pill draft">Not published</span>`)
    : `<span class="pill pub">Published</span>`) + inactivePill;

  const heading = multi ? grp.name : ((fval(d,"project_name") || (row&&row.name) || "").trim() || "(untitled)");
  const sub = multi
    ? `${grp.items.length} enclaves &nbsp;·&nbsp; <b>${esc(actLbl)}</b> ${statusMini}`
    : `${row&&row.jde?"JDE "+esc(row.jde):""} · ${statusLine}`;
  let h=`<div class="ptitle"><div class="ptitle-main"><button class="mob-back" id="mobBack">&#8592; List</button>
      <div>${esc(heading)}<span class="s">${sub}</span></div></div>
      <div class="acts">${acts.join("")}</div></div>`;

  // a retired (removed-from-template) section only shows where it still holds data
  if(!multi){ SCHEMA.SECTIONS.forEach(sec=>{ if(sec.retired && !secHasData(sec,d)) return; h+=renderSection(sec, d, editing, id); }); }
  else { const cx=clusterContext(grp); SCHEMA.SECTIONS.forEach(sec=>{
    if(sec.retired && !cx.datas.some(dd=>secHasData(sec,dd))) return; h+=renderClusterSection(sec, cx, it, editing); }); }
  // images (per enclave — a cluster shows the selected enclave's images)
  h+=`<div class="sec"><span>Images${multi?` — ${esc(actLbl)}`:""}</span><span class="sec-right">${editing?`<button data-imgadd>Add image</button>`:""}${multi?encWrapHTML(grp,it):""}</span></div>`;
  h+=imagesHTML(id, editing);
  $("detail").innerHTML=h;
  const sp=$("split"); if(sp) sp.classList.add("show-detail");        // mobile: reveal detail
  const va=$("viewArea"); if(va) va.classList.add("mob-detail");      // mobile: hide the search bar
  if($("mobBack")) $("mobBack").onclick=()=>{ const s=$("split"); if(s) s.classList.remove("show-detail"); if(va) va.classList.remove("mob-detail"); };
  // enclave dropdowns: one selection drives every section (viewer and maker alike)
  $("detail").querySelectorAll("[data-encsel]").forEach(s=>s.onchange=()=>{
    if(s.value==="__cmp"){ state.encCompare=true; openDetail(state.sel); }
    else { state.encCompare=false; openDetail(s.value); } });
  wirePlanNames(id, editing);
  wireMenu("btnExport","expMenu");
  const xm=$("expMenu");
  if(xm) xm.querySelectorAll("[data-exp]").forEach(b=>b.onclick=()=>{ xm.classList.add("hidden");
    if(b.dataset.exp==="pdf") exportCISpdf(id);
    else if(b.dataset.exp==="xlsx") exportCIS(id);
    else if(b.dataset.exp==="pdfall") exportClusterPDF(grp);
    else exportClusterXLSX(grp); });
  if(editing){
    wireMenu("btnEncMenu","encMenu"); wireMenu("btnMore","moreMenu");
    const enm=$("encMenu");
    if(enm) enm.querySelectorAll("[data-enc]").forEach(b=>b.onclick=()=>{ enm.classList.add("hidden");
      if(b.dataset.enc==="add") addEnclave(id);
      else if(b.dataset.enc==="attach") attachEnclave(id);
      else if(b.dataset.enc==="rename") renameGroup(id);
      else detachEnclave(id); });
    const mom=$("moreMenu");
    if(mom) mom.querySelectorAll("[data-more]").forEach(b=>b.onclick=()=>{ mom.classList.add("hidden");
      if(b.dataset.more==="discard") discardDraft(id);
      else if(b.dataset.more==="active") setActive(id, !(itemById(id).active));
      else if(b.dataset.more==="unpublish") unpublish(id);
      else deleteCommunity(id); });
    if($("btnPublish")) $("btnPublish").onclick=()=>publish(id);
    if($("btnEdit"))    $("btnEdit").onclick=()=>startDraft(id);
    wireEditables(id);
    const ia=$("detail").querySelector("[data-imgadd]"); if(ia) ia.onclick=()=>pickImages(id);
    $("detail").querySelectorAll("[data-capedit]").forEach(inp=>inp.onchange=()=>saveCaption(inp.dataset.capedit,inp.value));
    $("detail").querySelectorAll("[data-imgdel]").forEach(b=>b.onclick=()=>delImage(id,b.dataset.imgdel));
  }
  $("detail").querySelectorAll(".card img").forEach(im=>im.onclick=()=>{ $("lbImg").src=im.src; $("lbCap").textContent=im.dataset.cap||""; $("lightbox").classList.add("on"); });
}

/* ---------- section renderers (data model: data.f / data.plans / data.note / data.extra) ---------- */
function fval(d,k){ const v=(d.f||{})[k]; return (v==null||v==="")?"":String(v); }
function evCell(id,path,v,shared){ // editable value span; shared=1 asks "all enclaves or just this one" on commit
  return `<span class="ev" data-ev="${esc(path)}" data-id="${id}"${shared?' data-shared="1"':""}>${v?esc(v):'<span class="none">—</span>'}</span>`;
}
/* A spec line can be removed when it has something in it, isn't the auto-stamped
   Revision Date, and isn't the Community Name — that one names the record in the
   list, so it stays renameable but not removable. */
function kvRemovable(f, v){ return !!v && !f.readonly && f.k!==SCHEMA.IDENTITY.name; }
const hasCells = c => Array.isArray(c) && c.some(x=>x!=null && String(x).trim()!=="");
/* Every row of a grid (Model) section for one record, in display order:
   template rows first (original positional `pos` rows and template-added `k`
   rows, in the template's order), then this sheet's own custom rows.
     type   'preset' | 'tpl' | 'custom'
     path   edit-path prefix — append "."+columnIndex
     clr    data-attribute value for the row X (clear or remove) */
function gridAll(sec, d){
  d=d||{}; const arr=Array.isArray(d[sec.key])?d[sec.key]:[];
  const gx=((d.gridx||{})[sec.key])||{};
  const out=[];
  (sec.rows||[]).forEach(r=>{
    if(typeof r.pos==="number") out.push({type:"preset", label:r.label, cells:arr[r.pos]||[], retired:!!r.retired, path:`m.${r.pos}`, clr:`m:${r.pos}`});
    else if(r.k) out.push({type:"tpl", label:r.label, cells:gx[r.k]||[], retired:!!r.retired, path:`mx.${sec.key}.${r.k}`, clr:`x:${r.k}`});
  });
  const P=sec.presetBase||0;
  (Array.isArray(d.model_labels)?d.model_labels:[]).forEach((lbl,j)=>
    out.push({type:"custom", label:lbl, cells:arr[P+j]||[], j, path:`m.${P+j}`}));
  return out;
}
/* does this record hold anything in this section? (drives retired-section visibility) */
function secHasData(sec, d){
  d=d||{};
  if(sec.kind==="kv") return (sec.fields||[]).some(f=>fval(d,f.k)) || ((d.extra||{})[sec.id]||[]).some(p=>p&&String(p[1]||"").trim());
  if(sec.kind==="plans") return Array.isArray(d.plans) && d.plans.some(hasCells);
  if(sec.kind==="grid") return gridAll(sec,d).some(r=>hasCells(r.cells) || (r.type==="custom" && String(r.label||"").trim()));
  if(sec.kind==="note") return String(d.note==null?"":d.note).trim()!=="";
  return false;
}
/* The maker's row X — the same control on plan rows, spec lines and model rows.
   `on` is false for a row there's nothing to remove from: the cell still renders
   so the column stays aligned, just without a button. */
function rowXCell(editing, on, attrs, label, shared){
  if(!editing) return "";
  if(!on) return `<td class="rowx"></td>`;
  const l=String(label==null?"this line":label);
  return `<td class="rowx"><button class="rowdel" ${attrs} data-rowlabel="${esc(l)}"${shared?' data-shared="1"':""} title="Remove this line" aria-label="Remove ${esc(l)}">&times;</button></td>`;
}
/* One section's header button + body, so the single view and the cluster view
   (which puts an enclave dropdown in the header) share the exact same bodies.
   Returns {btn, body}; body==="" means the section is hidden for this record. */
function sectionParts(sec, d, editing, id){
  if(sec.kind==="kv"){
    let rows=sec.fields.map(f=>{ const v=fval(d,f.k); if(!v && (!editing || f.readonly || f.retired)) return "";
      const disp = (editing && !f.readonly) ? evCell(id,"f."+f.k,v)
                 : (f.readonly ? `${esc(v)||'<span class="none">—</span>'}<span class="autotag">auto</span>` : esc(v));
      return `<tr><td class="k">${esc(f.label)}</td><td class="v">${disp||'<span class="none">—</span>'}</td>${
        rowXCell(editing, kvRemovable(f,v), `data-kvdel="f.${esc(f.k)}"`, f.label)}</tr>`; }).join("");
    const ex=(d.extra&&d.extra[sec.id])||[];
    ex.forEach((pair,xi)=>{ const v=pair[1]||""; rows+=`<tr><td class="k">${esc(pair[0])}</td><td class="v">${editing?evCell(id,"x."+sec.id+"."+xi,v):esc(v)}</td>${
      rowXCell(editing, true, `data-xdel="${esc(sec.id)}.${xi}"`, pair[0]||"this line")}</tr>`; });
    return { btn:"", body: rows?`<table>${rows}</table>`:(editing?`<table></table>`:"") };
  }
  if(sec.kind==="plans"){
    const arr=Array.isArray(d.plans)?d.plans:[]; const cols=SCHEMA.PLAN_COLS;
    if(!arr.length && !editing) return { btn:"", body:"" };
    let head=`<tr>${cols.map(c=>`<th class="nowrap">${esc(c)}</th>`).join("")}${editing?"<th></th>":""}</tr>`;
    const cell=(ri,ci,raw)=>{ const v=raw||"";
      if(ci===1){ // Plan Name / footprint: truncated label, click opens a popup (view or edit)
        return `<td class="v"><span class="plname" data-planopen="${ri}" data-full="${esc(v)}">${v?esc(v):'<span class="none">—</span>'}</span></td>`; }
      return `<td class="v">${editing?evCell(id,`p.${ri}.${ci}`,v):esc(v)}</td>`; };
    let body=arr.map((r,ri)=>`<tr>${cols.map((c,ci)=>cell(ri,ci,r[ci])).join("")}${
      rowXCell(editing, true, `data-pldel="${ri}"`, _planRowLabel(r)||"this row")}</tr>`).join("");
    return { btn: (editing && !sec.retired)?`<button data-pladd="1">Add row</button>`:"",
             body: `<div class="tscroll"><table class="plans-t">${head}${body}</table></div>` };
  }
  if(sec.kind==="grid"){
    const all=gridAll(sec, d);
    if(!secHasData(sec,d) && !editing) return { btn:"", body:"" };
    // Blank template rows never show on the viewer side (same as the kv lines).
    // In maker mode a template row shows when it has data, or when "Show all rows"
    // is on (so empty rows can be filled on demand). A row removed from the
    // template (retired) only ever shows where it still has data.
    // Per-sheet custom rows are always shown in maker mode and are fully removable.
    const showAll = editing && state.gridShowAll && state.gridShowAll[sec.key];
    const tplRows=all.filter(r=>r.type!=="custom");
    const vis=r=> hasCells(r.cells) || (editing && showAll && !r.retired);
    const hiddenN=editing?tplRows.filter(r=>!r.retired && !hasCells(r.cells)).length:0;
    let head=`<tr><th class="nowrap">${esc(sec.rowHeader||"")}</th>${sec.columns.map(c=>`<th class="nowrap">${esc(c)}</th>`).join("")}${editing?"<th></th>":""}</tr>`;
    const cells=r=>sec.columns.map((c,ci)=>`<td class="v">${editing?evCell(id,`${r.path}.${ci}`,r.cells[ci]||""):esc(r.cells[ci]||"")}</td>`).join("");
    // template rows: fixed label; the X clears the row (label is kept so it can be refilled)
    let body=tplRows.map(r=>{ if(!vis(r)) return "";
      return `<tr><td class="k">${esc(r.label)}</td>${cells(r)}${
        rowXCell(editing, hasCells(r.cells), `data-mdel="${esc(sec.key)}|${esc(r.clr)}"`, r.label)}</tr>`; }).join("");
    // custom rows: editable label + the X fully removes the row (like the Plans table)
    body+=all.filter(r=>r.type==="custom").map(r=>{ const lbl=r.label;
      if(!editing && !hasCells(r.cells) && String(lbl||"").trim()==="") return "";
      const labelCell=editing?evCell(id,`ml.${r.j}`,lbl||""):(esc(lbl||"")||'<span class="none">—</span>');
      return `<tr><td class="k">${labelCell}</td>${cells(r)}${
        rowXCell(editing, true, `data-mrowdel="${esc(sec.key)}.${r.j}"`, lbl||"this row", true)}</tr>`; }).join("");
    const addBtn=(editing && !sec.retired)?`<button data-gridadd="${esc(sec.key)}">Add row</button>`:"";
    const moreBtn=(editing && (hiddenN||showAll))?` <button data-gridall="${esc(sec.key)}">${showAll?"Show fewer rows":`Show all rows${hiddenN?` (${hiddenN} more)`:""}`}</button>`:"";
    return { btn: addBtn+moreBtn,
             body: `<div class="tscroll"><table class="plans-t model-t">${head}${body}</table></div>` };
  }
  if(sec.kind==="note"){
    const t=(d.note==null?"":String(d.note));
    if(!editing && !t) return { btn:"", body:"" };
    return { btn:"", body:`<table><tr><td class="v">${editing?evCell(id,"note",t):(esc(t)||'<span class="none">—</span>')}</td></tr></table>` };
  }
  return { btn:"", body:"" };
}
function renderSection(sec, d, editing, id){
  const p=sectionParts(sec, d, editing, id);
  if(!p.body) return "";
  return `<div class="sec"><span>${esc(sec.title)}</span>${p.btn}</div>${p.body}`;
}

/* ---------- cluster (enclave) rendering ---------- */
/* Per-section shared-vs-different analysis of a group's records. */
function clusterContext(grp){
  const rows=grp.items.map(x=>shownRow(x));
  const datas=rows.map(r=>(r&&r.data)||{});
  const S=v=>String(v==null?"":v).trim();
  const same=vals=>vals.every(v=>S(v)===S(vals[0]));
  const cx={ grp, rows, datas, labels:grp.items.map(x=>encLabel(grp,x)), diff:{}, fieldDiff:{}, extraDiff:{} };
  SCHEMA.SECTIONS.forEach(sec=>{
    if(sec.kind==="kv"){
      let dif=false;
      (sec.fields||[]).forEach(f=>{ const vals=datas.map(d=>fval(d,f.k)); const dd=!same(vals);
        cx.fieldDiff[f.k]=dd; if(dd && f.k!=="rev_date") dif=true; });   // rev_date is a publish stamp — never the reason for a dropdown
      const exJ=datas.map(d=>JSON.stringify((d.extra||{})[sec.id]||[]));
      cx.extraDiff[sec.id]=!exJ.every(x=>x===exJ[0]);
      if(cx.extraDiff[sec.id]) dif=true;
      cx.diff[sec.id]=dif;
    } else if(sec.kind==="plans"){ const js=datas.map(d=>JSON.stringify(d.plans||[])); cx.diff[sec.id]=!js.every(x=>x===js[0]); }
    else if(sec.kind==="grid"){ const js=datas.map(d=>JSON.stringify(gridAll(sec,d).map(r=>[r.label,r.cells]))); cx.diff[sec.id]=!js.every(x=>x===js[0]); }
    else if(sec.kind==="note"){ cx.diff[sec.id]=!same(datas.map(d=>d.note||"")); }
  });
  return cx;
}
function encWrapHTML(grp, act){
  const opts=grp.items.map(x=>`<option value="${x.id}"${(!state.encCompare&&x.id===act.id)?" selected":""}>${esc(encLabel(grp,x))}</option>`).join("");
  return `<span class="enc-wrap">Enclave<select class="enc-sel" data-encsel>${opts}<option value="__cmp"${state.encCompare?" selected":""}>Compare all</option></select></span>`;
}
function encTag(lbl){ return `<span class="enctag">${esc(lbl)}</span>`; }
/* kv body for a cluster: shared rows render once (editing asks all-or-one), rows
   that differ show the selected enclave's value with a small enclave tag. */
function kvClusterBody(sec, cx, ai, editing){
  const d=cx.datas[ai]; const id=cx.grp.items[ai].id; const lbl=cx.labels[ai];
  let rows=sec.fields.map(f=>{
    const v=fval(d,f.k); const fd=!!cx.fieldDiff[f.k];
    if(!v && !editing && !fd) return "";                            // shared blank: hidden as always
    if(!v && f.retired) return "";                                  // removed from the template: only filled sheets keep it
    const showDash = !v && !editing && fd;                          // differs elsewhere: keep the row so switching enclaves makes sense
    const disp = (editing && !f.readonly) ? evCell(id,"f."+f.k,v,!fd)
               : (f.readonly ? `${esc(v)||'<span class="none">—</span>'}<span class="autotag">auto</span>`
                             : (esc(v)||(showDash?'<span class="none">—</span>':"")));
    if(!disp) return "";
    return `<tr><td class="k">${esc(f.label)}</td><td class="v">${disp}${fd?encTag(lbl):""}</td>${
      rowXCell(editing, kvRemovable(f,v), `data-kvdel="f.${esc(f.k)}"`, f.label, !fd)}</tr>`; }).join("");
  const exDiff=!!cx.extraDiff[sec.id];
  const ex=(d.extra&&d.extra[sec.id])||[];
  ex.forEach((pair,xi)=>{ const v=pair[1]||"";
    rows+=`<tr><td class="k">${esc(pair[0])}</td><td class="v">${editing?evCell(id,"x."+sec.id+"."+xi,v,!exDiff):esc(v)}${exDiff?encTag(lbl):""}</td>${
      rowXCell(editing, true, `data-xdel="${esc(sec.id)}.${xi}"`, pair[0]||"this line", !exDiff)}</tr>`; });
  return rows?`<table>${rows}</table>`:(editing?`<table></table>`:"");
}
/* read-only side-by-side of just the values that differ inside one section */
function compareBody(sec, cx){
  const n=cx.labels.length; const S=v=>String(v==null?"":v).trim();
  const odd=vals=>{ if(n<3) return -1; const c={}; vals.forEach(v=>c[S(v)]=(c[S(v)]||0)+1);
    const ks=Object.keys(c); if(ks.length!==2) return -1; const rare=ks.find(k=>c[k]===1);
    return rare==null?-1:vals.findIndex(v=>S(v)===rare); };
  const tds=vals=>{ const o=odd(vals); return vals.map((v,i)=>`<td class="v${i===o?" enc-odd":""}">${esc(S(v))||'<span class="none">—</span>'}</td>`).join(""); };
  let head=`<tr><th style="min-width:170px"></th>${cx.labels.map(l=>`<th>${esc(l)}</th>`).join("")}</tr>`;
  let rows="";
  if(sec.kind==="kv"){
    (sec.fields||[]).forEach(f=>{ if(!cx.fieldDiff[f.k]) return;
      rows+=`<tr><td class="k">${esc(f.label)}</td>${tds(cx.datas.map(d=>fval(d,f.k)))}</tr>`; });
    if(cx.extraDiff[sec.id]){
      const lists=cx.datas.map(d=>(d.extra||{})[sec.id]||[]);
      const labels=[]; lists.forEach(l=>l.forEach(p=>{ if(!labels.some(x=>lc(x)===lc(p[0]))) labels.push(p[0]); }));
      labels.forEach(L=>{ const vals=lists.map(l=>{ const p=l.find(x=>lc(x[0])===lc(L)); return p?p[1]:""; });
        if(vals.every(v=>S(v)===S(vals[0]))) return;
        rows+=`<tr><td class="k">${esc(L)}</td>${tds(vals)}</tr>`; });
    }
  } else if(sec.kind==="plans"){
    rows+=`<tr><td class="k">Plans</td>${cx.datas.map(d=>{
      const arr=Array.isArray(d.plans)?d.plans:[];
      return `<td class="v">${arr.map(r=>`<span class="enc-chip">${esc([r[0],(r[1]||"").split("(")[0].trim()].filter(Boolean).join(" "))}</span>`).join("")||'<span class="none">—</span>'}</td>`; }).join("")}</tr>`;
  } else if(sec.kind==="grid"){
    // Pair rows by LABEL, not by position — custom rows differ per enclave, so a
    // shared index would show one enclave's row under another's label. Build a
    // per-enclave label->cells map and a union of labels (presets first).
    const maps=cx.datas.map(d=>{ const m=new Map();
      gridAll(sec,d).forEach(r=>{ const lbl=String(r.label||""); if(lbl.trim()!=="" && !m.has(lbl.toLowerCase())) m.set(lbl.toLowerCase(), {lbl, cells:r.cells}); }); return m; });
    const order=[]; const seen=new Set();
    (sec.rows||[]).forEach(r=>{ const l=String(r.label||""); const k=l.toLowerCase(); if(l && !seen.has(k)){ seen.add(k); order.push({k, lbl:l}); } });
    maps.forEach(m=>m.forEach((v,k)=>{ if(!seen.has(k)){ seen.add(k); order.push({k, lbl:v.lbl}); } }));
    order.forEach(({k,lbl})=>{
      const vals=maps.map(m=>{ const e=m.get(k); return e?e.cells.filter(x=>S(x)).join(" · "):""; });
      if(vals.every(v=>!v) || vals.every(v=>v===vals[0])) return;
      rows+=`<tr><td class="k">${esc(lbl)}</td>${tds(vals)}</tr>`; });
  } else if(sec.kind==="note"){
    rows+=`<tr><td class="k">Notes</td>${cx.datas.map(d=>`<td class="v">${esc(String(d.note||""))||'<span class="none">—</span>'}</td>`).join("")}</tr>`;
  }
  if(!rows) rows=`<tr><td class="v" colspan="${n+1}"><span class="none">No differing values in this section.</span></td></tr>`;
  return `<div class="tscroll"><table class="plans-t">${head}${rows}</table></div>`;
}
function renderClusterSection(sec, cx, act, editing){
  const grp=cx.grp;
  const ai=grp.items.findIndex(x=>x.id===act.id); if(ai<0) return "";
  const d=cx.datas[ai]; const id=act.id;
  const dif=!!cx.diff[sec.id];
  const head=btn=>`<div class="sec"><span>${esc(sec.title)}</span><span class="sec-right">${btn||""}${dif?encWrapHTML(grp,act):""}</span></div>`;
  if(dif && state.encCompare) return head("")+compareBody(sec, cx);
  if(sec.kind==="kv"){
    const body=kvClusterBody(sec, cx, ai, editing);
    if(!body) return "";
    return head("")+body;
  }
  const p=sectionParts(sec, d, editing, id);
  if(!dif) return p.body?`<div class="sec"><span>${esc(sec.title)}</span>${p.btn}</div>${p.body}`:"";
  // section differs: keep the header (with dropdown) even when this enclave has nothing yet
  const body=p.body || `<table><tr><td class="v"><span class="none">— none for ${esc(cx.labels[ai])} —</span></td></tr></table>`;
  return head(p.btn)+body;
}

/* ---------- inline editing (maker) ---------- */
function wireEditables(id){
  $("detail").querySelectorAll(".ev").forEach(sp=>sp.onclick=()=>beginEdit(sp,id));
  const add=$("detail").querySelector("[data-pladd]"); if(add) add.onclick=()=>plAdd(id);
  $("detail").querySelectorAll("[data-pldel]").forEach(b=>b.onclick=()=>plDel(id,+b.dataset.pldel));
  $("detail").querySelectorAll("[data-kvdel]").forEach(b=>b.onclick=()=>kvDel(id,b.dataset.kvdel,b.dataset.shared==="1",b.dataset.rowlabel));
  $("detail").querySelectorAll("[data-xdel]").forEach(b=>b.onclick=()=>{ const p=b.dataset.xdel.split(".");
    xDel(id,p[0],+p[1],b.dataset.shared==="1",b.dataset.rowlabel); });
  $("detail").querySelectorAll("[data-mdel]").forEach(b=>b.onclick=()=>{ const p=b.dataset.mdel.split("|");
    gridDel(id,p[0],p[1],b.dataset.shared==="1",b.dataset.rowlabel); });
  $("detail").querySelectorAll("[data-gridadd]").forEach(b=>b.onclick=()=>gridAdd(id,b.dataset.gridadd));
  $("detail").querySelectorAll("[data-mrowdel]").forEach(b=>b.onclick=()=>{ const p=b.dataset.mrowdel.split("."); gridRowDel(id,p[0],+p[1],b.dataset.rowlabel,b.dataset.shared==="1"); });
  $("detail").querySelectorAll("[data-gridall]").forEach(b=>b.onclick=()=>{
    state.gridShowAll=state.gridShowAll||{}; state.gridShowAll[b.dataset.gridall]=!state.gridShowAll[b.dataset.gridall]; openDetail(id); });
}
// Plan Name / footprint popup — read-only in viewer, editable textarea in maker.
function wirePlanNames(id, editing){
  $("detail").querySelectorAll("[data-planopen]").forEach(sp=>sp.onclick=async()=>{
    const ri=+sp.dataset.planopen; const cur=sp.dataset.full||"";
    if(editing){ const v=await uiTextarea("Plan name / footprint", cur, {okText:"Save"});
      if(v!=null){ await setPath(id,`p.${ri}.1`,v); openDetail(id); } }
    else { uiAlert(cur||"—","Plan name / footprint"); }
  });
}
/* Commit an edited value. A value marked shared (identical across a cluster's
   enclaves) asks whether the change applies to every enclave or just this one —
   "just this one" simply makes the field enclave-specific from then on. */
async function commitPath(id, path, value, shared, cur){
  if(shared && String(value)!==String(cur||"")){
    const grp=clusterFor(id);
    if(grp && grp.items.length>1){
      const c=await openModal({ title:"Shared value",
        body:`<p>This value is the same in every enclave of <b>${esc(grp.name)}</b>. Apply the change to:</p>`,
        buttons:[{label:"Cancel",value:"x"},
                 {label:`Only ${encLabel(grp,itemById(id))}`,value:"one"},
                 {label:`All ${grp.items.length} enclaves`,value:"all",primary:true}] });
      if(c==null||c==="x") return;
      if(c==="all"){ for(const x of grp.items) await setPath(x.id,path,value); return; }
    }
  }
  await setPath(id,path,value);
}
function beginEdit(sp,id){
  const path=sp.dataset.ev; const cur=getPath(id,path); const shared=sp.dataset.shared==="1";
  const p=path.split("."); if(p[0]==="f" && DATE_KEYS[p[1]]) return beginDateEdit(sp,id,path,cur,shared);
  const long=(path==="note");
  const inp=document.createElement(long?"textarea":"input"); inp.className="ed-in"; inp.value=cur||"";
  sp.replaceWith(inp); inp.focus();
  let done=false;
  const finish=async(save)=>{ if(done) return; done=true; if(save){ await commitPath(id,path,inp.value,shared,cur); } openDetail(id); };
  inp.addEventListener("keydown",e=>{ if(e.key==="Enter"&&!long){ e.preventDefault(); finish(true);} else if(e.key==="Escape") finish(false); });
  inp.addEventListener("blur",()=>finish(true));
}
// Date fields: one text box (free typing, incl. "TBD") with a calendar button in
// the corner that opens a native picker. Always saved as M.D.YY.
function beginDateEdit(sp,id,path,cur,shared){
  const wrap=document.createElement("span"); wrap.className="ev-date";
  const txt=document.createElement("input"); txt.type="text"; txt.className="ed-in"; txt.value=cur||""; txt.placeholder="M.D.YY or TBD";
  const btn=document.createElement("button"); btn.type="button"; btn.className="ed-calbtn"; btn.title="Pick a date";
  btn.innerHTML='<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M3 9h18M8 2.5v4M16 2.5v4"/></svg>';
  const cal=document.createElement("input"); cal.type="date"; cal.className="ed-calhidden"; const iso=dateToISO(cur); if(iso) cal.value=iso;
  wrap.appendChild(txt); wrap.appendChild(btn); wrap.appendChild(cal);
  sp.replaceWith(wrap); txt.focus(); txt.select();
  let done=false;
  const finish=async(save)=>{ if(done) return; done=true; if(save){ await commitPath(id,path,txt.value,shared,cur); } openDetail(id); };
  btn.addEventListener("click",()=>{ try{ cal.showPicker(); }catch(e){ cal.focus(); cal.click(); } });
  cal.addEventListener("change",()=>{ if(cal.value){ txt.value=isoToDate(cal.value); finish(true); } });
  txt.addEventListener("keydown",e=>{ if(e.key==="Enter"){ e.preventDefault(); finish(true);} else if(e.key==="Escape") finish(false); });
  wrap.addEventListener("focusout",()=>setTimeout(()=>{ if(!wrap.contains(document.activeElement)) finish(true); },150));
}
function getPath(id,path){ const it=itemById(id); const row=it.draft||it.pub; const d=(row&&row.data)||{};
  const p=path.split("."); const kind=p[0];
  if(kind==="f") return (d.f||{})[p[1]];
  if(kind==="note") return d.note||"";
  if(kind==="p"){ const r=(d.plans||[])[+p[1]]||[]; return r[+p[2]]; }
  if(kind==="m"){ const r=(d.model||[])[+p[1]]||[]; return r[+p[2]]; }
  if(kind==="ml"){ return (d.model_labels||[])[+p[1]]; }
  if(kind==="mx"){ const r=(((d.gridx||{})[p[1]])||{})[p[2]]||[]; return r[+p[3]]; }
  if(kind==="x"){ const arr=(d.extra||{})[p[1]]||[]; const pair=arr[+p[2]]||[]; return pair[1]; }
  return "";
}
async function setPath(id,path,value){
  const row=await ensureDraft(id); if(!row) return; const d=row.data=row.data||{}; d.f=d.f||{};
  const p=path.split("."); const kind=p[0];
  if(kind==="f"){ if(DATE_KEYS[p[1]]) value=normDate(value); d.f[p[1]]=value;
    const I=SCHEMA.IDENTITY;
    if(p[1]===I.name) row.name=value; if(p[1]===I.jde) row.jde=value;
    if(p[1]===I.project) row.project_name=value; if(p[1]===I.product) row.hub=value;
  }
  else if(kind==="note") d.note=value;
  else if(kind==="p"){ d.plans=d.plans||[]; const r=d.plans[+p[1]]=d.plans[+p[1]]||["","","","",""]; r[+p[2]]=value; }
  else if(kind==="m"){ d.model=d.model||[]; const r=d.model[+p[1]]=d.model[+p[1]]||["","","",""]; r[+p[2]]=value; }
  else if(kind==="ml"){ d.model_labels=d.model_labels||[]; d.model_labels[+p[1]]=value; }
  else if(kind==="mx"){ d.gridx=d.gridx||{}; const g=d.gridx[p[1]]=d.gridx[p[1]]||{};
    const sec=SCHEMA.SECTIONS.find(s=>s.kind==="grid"&&s.key===p[1]); const n=sec?sec.columns.length:4;
    const r=g[p[2]]=Array.isArray(g[p[2]])?g[p[2]]:Array.from({length:n},()=>""); r[+p[3]]=value; }
  else if(kind==="x"){ d.extra=d.extra||{}; const arr=d.extra[p[1]]=d.extra[p[1]]||[]; const pair=arr[+p[2]]=arr[+p[2]]||["",""]; pair[1]=value; }
  await saveDraft(row); refreshItemMeta(id);
}
async function plAdd(id){ const row=await ensureDraft(id); if(!row) return; const d=row.data=row.data||{}; (d.plans=d.plans||[]).push(["","","","",""]); await saveDraft(row); openDetail(id); }
async function plDel(id,ri){ const row=await ensureDraft(id); if(!row) return; const d=row.data||{}; (d.plans||[]).splice(ri,1); await saveDraft(row); openDetail(id); }
/* Add a custom row to a grid (Model) section: a blank editable label + blank cells,
   appended after the positional preset rows. Slots are padded so the new cells
   land at presetBase + j, matching gridAll(). */
async function gridAdd(id, key){
  const row=await ensureDraft(id); if(!row) return; const d=row.data=row.data||{};
  const sec=SCHEMA.SECTIONS.find(s=>s.kind==="grid"&&s.key===key); const P=sec?sec.presetBase:0;
  d[key]=Array.isArray(d[key])?d[key]:[];
  const at=P+(Array.isArray(d.model_labels)?d.model_labels.length:0);
  while(d[key].length<at) d[key].push([]);
  d[key][at]=(sec?sec.columns:[0,0,0,0]).map(()=>"");
  d.model_labels=Array.isArray(d.model_labels)?d.model_labels:[];
  d.model_labels.push("");
  await saveDraft(row); openDetail(id);
}
/* Fully remove a custom grid row (label + cells). j is the index within the custom
   rows of the shown record; its cell array sits at preset-count + j. In a cluster
   this asks "only this enclave / all N" like every other removal, and when applied
   to all it removes the row with the SAME LABEL from each enclave (custom rows sit
   at different indices per enclave, so they're matched by label, not position). */
async function gridRowDel(id, key, j, label, shared){
  const ids = shared ? await delScope(id, shared, label) : [id];
  if(!ids) return;
  const sec=SCHEMA.SECTIONS.find(s=>s.kind==="grid"&&s.key===key); const P=sec?sec.presetBase:0;
  for(const x of ids){
    const row=await ensureDraft(x); if(!row) continue; const d=row.data||{};
    const labels=Array.isArray(d.model_labels)?d.model_labels:[];
    const jj = (x===id) ? j : labels.findIndex(l=>String(l||"").toLowerCase()===String(label||"").toLowerCase());
    if(jj<0 || jj>=labels.length) continue;
    if(Array.isArray(d[key])) d[key].splice(P+jj,1);
    labels.splice(jj,1);
    await saveDraft(row); refreshItemMeta(x);
  }
  openDetail(id);
}

/* ---------- removing a line (maker) ---------- */
/* The row X, for the rows that aren't free-form plan rows:
   - a schema line always exists in the field list, so removing it means clearing
     its value — the line then drops off the viewer's sheet and every export, and
     the label stays in maker mode so it can be refilled later;
   - an imported custom line is spliced out of data.extra for good;
   - a model / grid row is blanked back to an empty row (its label is fixed, and
     blank rows are hidden the same way they always were).
   All three go through the draft, so Discard draft still undoes them. */
/* Which records the removal applies to. A value that's identical across a
   cluster's enclaves asks all-or-one, exactly like editing it does. */
async function delScope(id, shared, what){
  if(!shared) return [id];
  const grp=clusterFor(id);
  if(!grp || grp.items.length<2) return [id];
  const c=await openModal({ title:"Shared value",
    body:`<p><b>${esc(what||"This line")}</b> is the same in every enclave of <b>${esc(grp.name)}</b>. Remove it from:</p>`,
    buttons:[{label:"Cancel",value:"x"},
             {label:`Only ${encLabel(grp,itemById(id))}`,value:"one"},
             {label:`All ${grp.items.length} enclaves`,value:"all",primary:true}] });
  if(c==null||c==="x") return null;
  return c==="all" ? grp.items.map(x=>x.id) : [id];
}
async function kvDel(id, path, shared, label){
  const ids=await delScope(id, shared, label); if(!ids) return;
  for(const x of ids) await setPath(x, path, "");
  openDetail(id);
}
async function xDel(id, secId, xi, shared, label){
  const ids=await delScope(id, shared, label); if(!ids) return;
  for(const x of ids){
    const row=await ensureDraft(x); if(!row) continue;
    const arr=((row.data=row.data||{}).extra||{})[secId];
    if(Array.isArray(arr)) arr.splice(xi,1);
    await saveDraft(row); refreshItemMeta(x);
  }
  openDetail(id);
}
/* ref is "m:<pos>" (original positional row) or "x:<k>" (template-added row) */
async function gridDel(id, key, ref, shared, label){
  const ids=await delScope(id, shared, label); if(!ids) return;
  const [t,v]=String(ref).split(":");
  for(const x of ids){
    const row=await ensureDraft(x); if(!row) continue;
    const d=row.data=row.data||{};
    if(t==="m"){ const arr=d[key]; const ri=+v;
      if(Array.isArray(arr) && Array.isArray(arr[ri])) arr[ri]=arr[ri].map(()=>""); }
    else { const gx=(d.gridx||{})[key];
      if(gx && Array.isArray(gx[v])) gx[v]=gx[v].map(()=>""); }
    await saveDraft(row); refreshItemMeta(x);
  }
  openDetail(id);
}

/* ---------- export a CIS to a themed .xlsx (matches the PDF styling) ---------- */
function exportCIS(id){
  if(!window.XLSX){ uiAlert("Spreadsheet library didn't load — refresh and try again.","Export"); return; }
  const it=itemById(id); const row=shownRow(it); if(!row) return; const d=row.data||{};
  const NC=5;
  const BORDER={ style:"thin", color:{rgb:"D8DEE8"} }, BOX={top:BORDER,bottom:BORDER,left:BORDER,right:BORDER};
  const stTitle ={ font:{bold:true, sz:15, color:{rgb:"1F3864"}} };
  const stSection={ font:{bold:true, sz:11, color:{rgb:"FFFFFF"}}, fill:{fgColor:{rgb:"2E5C8A"}}, alignment:{vertical:"center"} };
  const stKey    ={ font:{bold:true, sz:10, color:{rgb:"42536E"}}, fill:{fgColor:{rgb:"F4F6FA"}}, alignment:{vertical:"top", wrapText:true}, border:BOX };
  const stVal    ={ font:{sz:10, color:{rgb:"16233A"}}, alignment:{vertical:"top", wrapText:true}, border:BOX };
  const stPHdr   ={ font:{bold:true, sz:9, color:{rgb:"42536E"}}, fill:{fgColor:{rgb:"F4F6FA"}}, alignment:{vertical:"top", wrapText:true}, border:BOX };
  const stPCell  ={ font:{sz:9, color:{rgb:"16233A"}}, alignment:{vertical:"top", wrapText:true}, border:BOX };
  const stMeta   ={ font:{italic:true, sz:9, color:{rgb:"6B7794"}} };

  const ws={}, merges=[]; let R=0; const range={s:{r:0,c:0},e:{r:0,c:NC-1}};
  const put=(r,c,v,s)=>{ ws[XLSX.utils.encode_cell({r,c})]={t:"s", v:(v==null?"":String(v)), s}; if(r>range.e.r) range.e.r=r; };
  const fullRow=(v,s)=>{ put(R,0,v,s); for(let c=1;c<NC;c++) put(R,c,"",s); merges.push({s:{r:R,c:0},e:{r:R,c:NC-1}}); R++; };
  const kv=(label,val)=>{ put(R,0,label,stKey); put(R,1,val,stVal); for(let c=2;c<NC;c++) put(R,c,"",stVal); merges.push({s:{r:R,c:1},e:{r:R,c:NC-1}}); R++; };

  fullRow(row.name||"(untitled)", stTitle); R++;   // title + blank row
  SCHEMA.SECTIONS.forEach(sec=>{
    if(sec.kind==="kv"){
      const fields=sec.fields.filter(f=>fval(d,f.k)); const ex=(d.extra&&d.extra[sec.id])||[];
      if(!fields.length && !ex.length) return;
      fullRow(sec.title, stSection);
      fields.forEach(f=>kv(f.label, fval(d,f.k)));
      ex.forEach(pr=>kv(pr[0], pr[1]||"")); R++;
    } else if(sec.kind==="plans"){
      const arr=d.plans||[]; if(!arr.length) return;
      fullRow(sec.title, stSection);
      SCHEMA.PLAN_COLS.forEach((c,ci)=>put(R,ci,c,stPHdr)); R++;
      arr.forEach(r=>{ SCHEMA.PLAN_COLS.forEach((c,ci)=>put(R,ci,r[ci]||"",stPCell)); R++; }); R++;
    } else if(sec.kind==="grid"){
      const rows=gridAll(sec,d).filter(r=>hasCells(r.cells)); if(!rows.length) return;   // blank rows don't print
      fullRow(sec.title, stSection);
      put(R,0,sec.rowHeader||"",stPHdr); sec.columns.forEach((c,ci)=>put(R,ci+1,c,stPHdr)); R++;
      rows.forEach(r=>{ put(R,0,r.label,stKey); sec.columns.forEach((c,ci)=>put(R,ci+1,r.cells[ci]||"",stPCell)); R++; }); R++;
    } else if(sec.kind==="note"){
      const t=d.note==null?"":String(d.note); if(!t) return;
      fullRow(sec.title, stSection); fullRow(t, stVal); R++;
    }
  });
  if(d.meta){ R++; fullRow(String(d.meta), stMeta); }

  ws["!ref"]=XLSX.utils.encode_range({s:{r:0,c:0},e:{r:Math.max(R-1,0),c:NC-1}});
  ws["!merges"]=merges;
  ws["!cols"]=[{wch:32},{wch:54},{wch:22},{wch:14},{wch:22}];
  const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "CIS");
  XLSX.writeFile(wb, `CIS_${(row.name||"CIS").replace(/[^\w\-]+/g,"_").slice(0,40)}_${new Date().toISOString().slice(0,10)}.xlsx`);
}

/* ---------- export a CIS to PDF (jsPDF + autotable) ----------
   opts.preferPublished picks the live row over an in-progress draft (the publish
   queue downloads what was published, even if the maker has since re-drafted).
   opts.quiet suppresses the modal so batch callers can report once at the end.
   Returns true when a file was saved. */
function exportCISpdf(id, opts){
  opts=opts||{};
  const jsPDF=(window.jspdf&&window.jspdf.jsPDF)||window.jsPDF;
  const it=itemById(id); if(!it) return false;
  const row=opts.preferPublished ? (it.pub||it.draft) : shownRow(it); if(!row) return false;
  if(!jsPDF){ if(!opts.quiet) uiAlert("PDF library didn't load — refresh and try again.","Export"); return false; }
  const d=row.data||{}; const doc=new jsPDF({unit:"pt",format:"letter"});
  const M=40; const navy=[31,56,100], blue=[46,92,138], grey=[244,246,250];
  doc.setFont("helvetica","bold").setFontSize(15).text(String(row.name||"CIS"),M,46);
  doc.setFont("helvetica","normal").setFontSize(9).setTextColor(120)
     .text("Community Information Sheet"+(row.status?" — "+row.status:""),M,60); doc.setTextColor(0);
  let y=76;
  const sectionTable=(title, body, opts)=>{ opts=opts||{};
    doc.autoTable(Object.assign({ startY:y,
      head:[[{content:title,colSpan:(opts.cols||2),styles:{fillColor:blue,textColor:255,halign:"left",fontStyle:"bold"}}]],
      body, styles:{fontSize:8,cellPadding:3,overflow:"linebreak",valign:"top"},
      margin:{left:M,right:M}, theme:"grid",
      columnStyles: opts.columnStyles || {0:{cellWidth:150,fontStyle:"bold",fillColor:grey}}
    },opts.extra||{}));
    y=doc.lastAutoTable.finalY+10; };
  SCHEMA.SECTIONS.forEach(sec=>{
    if(sec.kind==="kv"){
      const body=[]; sec.fields.forEach(f=>{ const v=fval(d,f.k); if(v) body.push([f.label,v]); });
      ((d.extra&&d.extra[sec.id])||[]).forEach(pr=>{ if(pr[1]) body.push([pr[0],pr[1]]); });
      if(body.length) sectionTable(sec.title, body);
    } else if(sec.kind==="plans"){
      const arr=d.plans||[]; if(arr.length){
        sectionTable(sec.title, arr.map(r=>SCHEMA.PLAN_COLS.map((c,ci)=>r[ci]||"")),
          {cols:SCHEMA.PLAN_COLS.length, columnStyles:{}, extra:{ head:[[
            {content:sec.title,colSpan:SCHEMA.PLAN_COLS.length,styles:{fillColor:blue,textColor:255,halign:"left",fontStyle:"bold"}}],
            SCHEMA.PLAN_COLS.map(c=>({content:c,styles:{fillColor:grey,textColor:[66,83,110],fontStyle:"bold"}}))]}});
      }
    } else if(sec.kind==="grid"){
      const body=gridAll(sec,d).filter(r=>hasCells(r.cells))   // blank rows don't print
        .map(r=>[r.label, ...sec.columns.map((c,ci)=>r.cells[ci]||"")]);
      if(body.length){
        sectionTable(sec.title, body, { cols:sec.columns.length+1, columnStyles:{0:{fontStyle:"bold",fillColor:grey,cellWidth:110}}, extra:{ head:[[
          {content:sec.title,colSpan:sec.columns.length+1,styles:{fillColor:blue,textColor:255,halign:"left",fontStyle:"bold"}}],
          [{content:sec.rowHeader||"",styles:{fillColor:grey,textColor:[66,83,110],fontStyle:"bold"}}, ...sec.columns.map(c=>({content:c,styles:{fillColor:grey,textColor:[66,83,110],fontStyle:"bold"}}))]]}});
      }
    } else if(sec.kind==="note"){
      const t=d.note==null?"":String(d.note); if(t) sectionTable(sec.title, [[t]], {cols:1, columnStyles:{0:{cellWidth:"auto"}}});
    }
  });
  doc.save(`CIS_${(row.name||"CIS").replace(/[^\w\-]+/g,"_").slice(0,40)}_${new Date().toISOString().slice(0,10)}.pdf`);
  return true;
}

/* ---------- export the whole community — every enclave in one file ----------
   Shared values print once; values that differ print as a per-enclave
   comparison; plans / model tables / notes print per enclave when they differ
   (once when identical). Mirrors the on-screen "Compare all" view. */
function clusterExportModel(grp){
  const cx=clusterContext(grp);
  const S=v=>String(v==null?"":v).trim();
  const secs=[];
  SCHEMA.SECTIONS.forEach(sec=>{
    if(sec.kind==="kv"){
      const shared=[], diff=[];
      (sec.fields||[]).forEach(f=>{
        const vals=cx.datas.map(d=>fval(d,f.k));
        if(!vals.some(v=>S(v))) return;
        if(!cx.fieldDiff[f.k]) shared.push([f.label, S(vals[0])]);
        else diff.push([f.label, ...vals.map(S)]);
      });
      const lists=cx.datas.map(d=>(d.extra||{})[sec.id]||[]);
      const labels=[]; lists.forEach(l=>l.forEach(p=>{ if(!labels.some(x=>lc(x)===lc(p[0]))) labels.push(p[0]); }));
      labels.forEach(L=>{ const vals=lists.map(l=>{ const p=l.find(x=>lc(x[0])===lc(L)); return p?S(p[1]):""; });
        if(!vals.some(v=>v)) return;
        if(vals.every(v=>v===vals[0])) shared.push([L, vals[0]]); else diff.push([L, ...vals]); });
      if(shared.length||diff.length) secs.push({kind:"kv", title:sec.title, shared, diff});
    } else if(sec.kind==="plans"){
      const js=cx.datas.map(d=>JSON.stringify(d.plans||[]));
      const tabs=(js.every(x=>x===js[0]) ? [{label:null, rows:cx.datas[0].plans||[]}]
        : cx.datas.map((d,i)=>({label:cx.labels[i], rows:d.plans||[]}))).filter(t=>t.rows.length);
      if(tabs.length) secs.push({kind:"plans", title:sec.title, tabs});
    } else if(sec.kind==="grid"){
      const rowsOf=d=>gridAll(sec,d).map(r=>[r.label, ...sec.columns.map((c,ci)=>S(r.cells[ci]))]).filter(r=>r.slice(1).some(x=>x));
      const js=cx.datas.map(d=>JSON.stringify(rowsOf(d)));
      const tabs=(js.every(x=>x===js[0]) ? [{label:null, rows:rowsOf(cx.datas[0])}]
        : cx.datas.map((d,i)=>({label:cx.labels[i], rows:rowsOf(d)}))).filter(t=>t.rows.length);
      if(tabs.length) secs.push({kind:"grid", title:sec.title, sec, tabs});
    } else if(sec.kind==="note"){
      const vals=cx.datas.map(d=>S(d.note));
      if(!vals.some(v=>v)) return;
      const notes=vals.every(v=>v===vals[0]) ? [{label:null, text:vals[0]}]
        : cx.datas.map((d,i)=>({label:cx.labels[i], text:vals[i]})).filter(n=>n.text);
      secs.push({kind:"note", title:sec.title, notes});
    }
  });
  return { cx, secs };
}
function exportClusterXLSX(grp){
  if(!window.XLSX){ uiAlert("Spreadsheet library didn't load — refresh and try again.","Export"); return; }
  const { cx, secs }=clusterExportModel(grp);
  const n=cx.labels.length; const NC=Math.max(5, n+1);
  const BORDER={ style:"thin", color:{rgb:"D8DEE8"} }, BOX={top:BORDER,bottom:BORDER,left:BORDER,right:BORDER};
  const stTitle ={ font:{bold:true, sz:15, color:{rgb:"1F3864"}} };
  const stSub   ={ font:{italic:true, sz:9, color:{rgb:"6B7794"}} };
  const stSection={ font:{bold:true, sz:11, color:{rgb:"FFFFFF"}}, fill:{fgColor:{rgb:"2E5C8A"}}, alignment:{vertical:"center"} };
  const stKey   ={ font:{bold:true, sz:10, color:{rgb:"42536E"}}, fill:{fgColor:{rgb:"F4F6FA"}}, alignment:{vertical:"top", wrapText:true}, border:BOX };
  const stVal   ={ font:{sz:10, color:{rgb:"16233A"}}, alignment:{vertical:"top", wrapText:true}, border:BOX };
  const stHdr   ={ font:{bold:true, sz:9, color:{rgb:"42536E"}}, fill:{fgColor:{rgb:"F4F6FA"}}, alignment:{vertical:"top", wrapText:true}, border:BOX };
  const ws={}, merges=[]; let R=0;
  const put=(r,c,v,s)=>{ ws[XLSX.utils.encode_cell({r,c})]={t:"s", v:(v==null?"":String(v)), s}; };
  const fullRow=(v,s)=>{ put(R,0,v,s); for(let c=1;c<NC;c++) put(R,c,"",s); merges.push({s:{r:R,c:0},e:{r:R,c:NC-1}}); R++; };
  const kvRow=(label,val)=>{ put(R,0,label,stKey); put(R,1,val,stVal); for(let c=2;c<NC;c++) put(R,c,"",stVal); merges.push({s:{r:R,c:1},e:{r:R,c:NC-1}}); R++; };
  const padRow=(cells,keyStyle)=>{ cells.forEach((v,ci)=>put(R,ci,v,ci===0?(keyStyle||stKey):stVal)); for(let c=cells.length;c<NC;c++) put(R,c,"",stVal); R++; };
  fullRow(grp.name||"Community", stTitle);
  fullRow(`All enclaves: ${cx.labels.join(" · ")}`, stSub); R++;
  secs.forEach(s=>{
    if(s.kind==="kv"){
      fullRow(s.title, stSection);
      s.shared.forEach(r=>kvRow(r[0], r[1]));
      if(s.diff.length){
        padRow(["Per enclave", ...cx.labels], stHdr);
        s.diff.forEach(r=>padRow(r));
      }
      R++;
    } else if(s.kind==="plans"){
      s.tabs.forEach(t=>{
        fullRow(s.title+(t.label?` — ${t.label}`:""), stSection);
        SCHEMA.PLAN_COLS.forEach((c,ci)=>put(R,ci,c,stHdr)); for(let c=SCHEMA.PLAN_COLS.length;c<NC;c++) put(R,c,"",stHdr); R++;
        t.rows.forEach(r=>{ SCHEMA.PLAN_COLS.forEach((c,ci)=>put(R,ci,r[ci]||"",stVal)); for(let c=SCHEMA.PLAN_COLS.length;c<NC;c++) put(R,c,"",stVal); R++; }); R++;
      });
    } else if(s.kind==="grid"){
      s.tabs.forEach(t=>{
        fullRow(s.title+(t.label?` — ${t.label}`:""), stSection);
        padRow([s.sec.rowHeader||"", ...s.sec.columns], stHdr);
        t.rows.forEach(r=>padRow(r)); R++;
      });
    } else if(s.kind==="note"){
      fullRow(s.title, stSection);
      s.notes.forEach(nt=>{ if(nt.label) kvRow(nt.label, nt.text); else fullRow(nt.text, stVal); }); R++;
    }
  });
  ws["!ref"]=XLSX.utils.encode_range({s:{r:0,c:0},e:{r:Math.max(R-1,0),c:NC-1}});
  ws["!merges"]=merges;
  ws["!cols"]=[{wch:30}, ...Array.from({length:NC-1},()=>({wch:Math.max(18, Math.floor(96/(NC-1)))}))];
  const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "CIS — all enclaves");
  XLSX.writeFile(wb, `CIS_${(grp.name||"Community").replace(/[^\w\-]+/g,"_").slice(0,40)}_all_${new Date().toISOString().slice(0,10)}.xlsx`);
}
function exportClusterPDF(grp){
  const jsPDF=(window.jspdf&&window.jspdf.jsPDF)||window.jsPDF;
  if(!jsPDF){ uiAlert("PDF library didn't load — refresh and try again.","Export"); return; }
  const { cx, secs }=clusterExportModel(grp);
  const n=cx.labels.length;
  const doc=new jsPDF({unit:"pt",format:"letter",orientation:n>=4?"landscape":"portrait"});
  const M=40; const blue=[46,92,138], grey=[244,246,250], hdTx=[66,83,110];
  doc.setFont("helvetica","bold").setFontSize(15).text(String(grp.name||"Community"),M,46);
  doc.setFont("helvetica","normal").setFontSize(9).setTextColor(120)
     .text(`Community Information Sheet — all enclaves (${cx.labels.join(" · ")})`,M,60); doc.setTextColor(0);
  let y=76;
  const table=(title, head2, body, opts)=>{ opts=opts||{};
    const cols=opts.cols||2;
    const head=[[{content:title,colSpan:cols,styles:{fillColor:blue,textColor:255,halign:"left",fontStyle:"bold"}}]];
    if(head2) head.push(head2.map(c=>({content:c,styles:{fillColor:grey,textColor:hdTx,fontStyle:"bold"}})));
    doc.autoTable({ startY:y, head, body,
      styles:{fontSize:8,cellPadding:3,overflow:"linebreak",valign:"top"},
      margin:{left:M,right:M}, theme:"grid",
      columnStyles: opts.columnStyles || {0:{cellWidth:140,fontStyle:"bold",fillColor:grey}} });
    y=doc.lastAutoTable.finalY+10; };
  secs.forEach(s=>{
    if(s.kind==="kv"){
      if(s.shared.length) table(s.title, null, s.shared);
      if(s.diff.length) table(s.title+" — by enclave", ["", ...cx.labels], s.diff, {cols:n+1, columnStyles:{0:{cellWidth:110,fontStyle:"bold",fillColor:grey}}});
    } else if(s.kind==="plans"){
      s.tabs.forEach(t=>table(s.title+(t.label?` — ${t.label}`:""), SCHEMA.PLAN_COLS,
        t.rows.map(r=>SCHEMA.PLAN_COLS.map((c,ci)=>r[ci]||"")), {cols:SCHEMA.PLAN_COLS.length, columnStyles:{}}));
    } else if(s.kind==="grid"){
      s.tabs.forEach(t=>table(s.title+(t.label?` — ${t.label}`:""), [s.sec.rowHeader||"", ...s.sec.columns],
        t.rows, {cols:s.sec.columns.length+1, columnStyles:{0:{cellWidth:110,fontStyle:"bold",fillColor:grey}}}));
    } else if(s.kind==="note"){
      s.notes.forEach(nt=>table(s.title+(nt.label?` — ${nt.label}`:""), null, [[nt.text]], {cols:1, columnStyles:{0:{cellWidth:"auto"}}}));
    }
  });
  doc.save(`CIS_${(grp.name||"Community").replace(/[^\w\-]+/g,"_").slice(0,40)}_all_${new Date().toISOString().slice(0,10)}.pdf`);
}

/* ---------- publish queue (floating sidebar) ----------
   Every CIS a maker publishes drops into a running list so a session's worth of
   publishes can be exported in one pass. Persisted per signed-in user so a
   refresh (or a sign-out mid-batch) doesn't lose the list. Editors only —
   viewers never publish, so they never see the panel. */
const PUBQ_MAX=200;
function pubqKey(){ return "cdb_pubq:"+lc(state.email||"anon"); }
function pubqLoad(){
  try{ const a=JSON.parse(localStorage.getItem(pubqKey())||"[]");
    state.pubq = Array.isArray(a) ? a.filter(e=>e&&e.id).slice(0,PUBQ_MAX) : []; }
  catch(e){ state.pubq=[]; }
  try{ state.pubqOpen = localStorage.getItem("cdb_pubq_open")!=="0"; }catch(e){}
}
function pubqSave(){ try{ localStorage.setItem(pubqKey(), JSON.stringify(state.pubq)); }catch(e){} }
/* newest first; re-publishing something already queued refreshes it in place
   rather than adding a second row that would download the same PDF twice */
function pubqAdd(id, name, jde){
  if(!id) return;
  const e={ id, name:String(name||"(untitled)"), jde:String(jde||""), at:new Date().toISOString() };
  state.pubq=[e, ...state.pubq.filter(x=>x.id!==id)].slice(0,PUBQ_MAX);
  pubqSave(); renderPubq();
}
function pubqRemove(id){ state.pubq=state.pubq.filter(x=>x.id!==id); pubqSave(); renderPubq(); }
/* A queued row goes stale once a draft exists for that CIS again — the PDF you'd
   download is the published version, which is no longer the newest work.
   Publishing clears the draft, so a draft newer than the queue stamp can only be
   an edit made after that publish. Republishing refreshes the stamp and the row,
   which clears the chip. */
function pubqStale(e){
  const it=itemById(e.id); if(!it||!it.draft) return false;
  const u=it.draft.updated_at; if(!u||!e.at) return true;
  return new Date(u).getTime() >= new Date(e.at).getTime()-1000;   // 1s slack for clock skew
}
async function pubqClear(){
  if(!state.pubq.length) return;
  if(!(await uiConfirm(`Clear all ${state.pubq.length} ${state.pubq.length===1?"community":"communities"} from the publish list? Nothing is unpublished — this only empties the list.`,
      {title:"Clear publish list",okText:"Clear list",danger:true}))) return;
  state.pubq=[]; pubqSave(); renderPubq();
}
function pubqToggle(){ state.pubqOpen=!state.pubqOpen;
  try{ localStorage.setItem("cdb_pubq_open", state.pubqOpen?"1":"0"); }catch(e){}
  renderPubq(); }

/* Downloads one PDF per queued CIS, exactly like Export → PDF does for a single
   community. Staggered: browsers throttle (or silently drop) a burst of saves
   fired in the same tick, and Chrome wants the "download multiple files" grant. */
async function pubqDownloadAll(){
  if(state.pubqBusy || !state.pubq.length) return;
  const jsPDF=(window.jspdf&&window.jspdf.jsPDF)||window.jsPDF;
  if(!jsPDF){ uiAlert("PDF library didn't load — refresh and try again.","Download all"); return; }
  state.pubqBusy=true; renderPubq();
  const list=state.pubq.slice(), missing=[];
  let ok=0;
  for(let i=0;i<list.length;i++){
    const e=list[i];
    const btn=$("pubqDl"); if(btn) btn.textContent=`Downloading ${i+1}/${list.length}…`;
    let saved=false;
    try{ saved=exportCISpdf(e.id,{preferPublished:true, quiet:true}); }catch(err){ console.error(err); }
    if(saved) ok++; else missing.push(e.name);
    await new Promise(r=>setTimeout(r,400));
  }
  state.pubqBusy=false; renderPubq();
  if(missing.length) uiAlert(`Downloaded ${ok} of ${list.length} PDFs. Skipped (no longer in the database): ${missing.join(", ")}.`,"Download all");
}

function renderPubq(){
  const host=$("pubq"); if(!host) return;
  const show = isEditor() && state.pubq.length>0;
  host.classList.toggle("hidden", !show);
  if(!show){ host.innerHTML=""; return; }
  const n=state.pubq.length;
  const stale=state.pubq.filter(pubqStale).length;
  const STALE_TIP="Edited since this publish — the newer draft isn't published yet, so the PDF you'd download is the older live version.";
  host.innerHTML=`
    <div class="pubq-h">
      <button class="pubq-toggle" id="pubqToggle" title="${state.pubqOpen?"Collapse":"Expand"}" aria-expanded="${state.pubqOpen?"true":"false"}">
        <span class="pubq-caret">${state.pubqOpen?"&#9662;":"&#9656;"}</span>
        <span class="pubq-title">Published</span><span class="pubq-count">${n}</span>
        ${stale&&!state.pubqOpen?`<span class="pubq-stale hdr" title="${esc(STALE_TIP)}">${stale} newer</span>`:""}
      </button>
    </div>
    <div class="pubq-acts">
      <button class="btn mini solid" id="pubqDl" ${state.pubqBusy?"disabled":""}>${state.pubqBusy?"Downloading…":"&#8681; Download all"}</button>
      <button class="btn mini ghost" id="pubqClear" ${state.pubqBusy?"disabled":""}>Clear</button>
    </div>
    ${state.pubqOpen?`<div class="pubq-list">${state.pubq.map(e=>{
      const old=pubqStale(e);
      const meta=[ e.jde?`<span class="pubq-jde">JDE ${esc(e.jde)}</span>`:"",
                   old?`<span class="pubq-stale" title="${esc(STALE_TIP)}">Newer draft</span>`:"" ].filter(Boolean).join("");
      return `<div class="pubq-row${old?" stale":""}" data-pubqid="${esc(e.id)}">
        <button class="pubq-nm" data-pubqopen="${esc(e.id)}" title="Open ${esc(e.name)}">
          <span class="pubq-nm-t">${esc(e.name)}</span>${meta?`<span class="pubq-meta">${meta}</span>`:""}</button>
        <button class="rowdel pubq-x" data-pubqdel="${esc(e.id)}" ${state.pubqBusy?"disabled":""} title="Remove from list" aria-label="Remove ${esc(e.name)} from list">&times;</button>
      </div>`; }).join("")}</div>`:""}`;
  $("pubqToggle").onclick=pubqToggle;
  $("pubqDl").onclick=pubqDownloadAll;
  $("pubqClear").onclick=pubqClear;
  host.querySelectorAll("[data-pubqdel]").forEach(b=>b.onclick=()=>pubqRemove(b.dataset.pubqdel));
  host.querySelectorAll("[data-pubqopen]").forEach(b=>b.onclick=()=>{
    const id=b.dataset.pubqopen;
    if(!itemById(id)){ uiAlert("That community is no longer in the database.","Publish list"); return; }
    if(state.view!=="browse"){ state.view="browse"; setTab(); showDash(); render(); }
    openDetail(id);
  });
}

/* ---------- What's New (publish change log) ----------
   At publish time the app diffs the draft against the live published version and
   writes one cdb_change_log row: a new CIS published, plans added/removed, or
   CIS details changed (any section field, plan row, table, note or extra field).
   The feed drives the topbar "What's New" button + the unread dot on list rows. */
const WN_DOT_DAYS=14;   // a row only shows the unread dot for changes this recent
function _planRowKey(r){ const num=lc(Array.isArray(r)?r[0]:"").trim(); return num || lc(Array.isArray(r)?r[1]:"").trim(); }
function _planRowLabel(r){ const S=x=>String(x==null?"":x).trim(); const num=S(r&&r[0]), nm=S(r&&r[1]);
  return num&&nm?`${num} — ${nm}`:(num||nm||"(unnamed plan)"); }
function _planRowText(r){ return (Array.isArray(r)?r:[]).map(x=>String(x==null?"":x).trim()).filter(Boolean).join(" · "); }
function diffCIS(pub, draft){
  const out={ isNew:!pub, plansAdded:[], plansRemoved:[], fields:[] };
  if(!draft) return out;
  const dNew=draft.data||{}, dOld=(pub&&pub.data)||{};
  if(out.isNew) return out;                      // first publish — no field diff needed
  const secTitle=id=>{ const s=SCHEMA.SECTIONS.find(x=>x.id===id); return s?s.title:id; };
  SCHEMA.SECTIONS.forEach(sec=>{
    if(sec.kind==="kv"){
      (sec.fields||[]).forEach(f=>{ if(f.k==="rev_date") return;   // stamped on every publish — noise
        const a=fval(dOld,f.k), b=fval(dNew,f.k);
        if(a!==b) out.fields.push({sec:sec.title,label:f.label,from:a,to:b}); });
    } else if(sec.kind==="plans"){
      const oldRows=Array.isArray(dOld.plans)?dOld.plans:[], newRows=Array.isArray(dNew.plans)?dNew.plans:[];
      const oldBy=new Map(); oldRows.forEach(r=>{ const k=_planRowKey(r); if(k&&!oldBy.has(k)) oldBy.set(k,r); });
      const newBy=new Map(); newRows.forEach(r=>{ const k=_planRowKey(r); if(k&&!newBy.has(k)) newBy.set(k,r); });
      newBy.forEach((r,k)=>{
        if(!oldBy.has(k)) out.plansAdded.push(_planRowLabel(r));
        else if(JSON.stringify(r)!==JSON.stringify(oldBy.get(k)))
          out.fields.push({sec:sec.title,label:_planRowLabel(r),from:_planRowText(oldBy.get(k)),to:_planRowText(r)});
      });
      oldBy.forEach((r,k)=>{ if(!newBy.has(k)) out.plansRemoved.push(_planRowLabel(r)); });
    } else if(sec.kind==="grid"){
      const gsig=d=>JSON.stringify([d[sec.key]||[], d.model_labels||[], (d.gridx||{})[sec.key]||{}]);
      if(gsig(dOld)!==gsig(dNew))
        out.fields.push({sec:sec.title,label:"Table updated",from:"",to:""});
    } else if(sec.kind==="note"){
      if(String(dOld.note||"")!==String(dNew.note||""))
        out.fields.push({sec:sec.title,label:"Notes updated",from:"",to:""});
    }
  });
  const exOld=dOld.extra||{}, exNew=dNew.extra||{};
  new Set([...Object.keys(exOld),...Object.keys(exNew)]).forEach(id=>{
    if(JSON.stringify(exOld[id]||[])!==JSON.stringify(exNew[id]||[]))
      out.fields.push({sec:secTitle(id),label:"Additional fields updated",from:"",to:""});
  });
  return out;
}
function wnSummary(name, diff){
  const nm=name||"(untitled)";
  if(diff.isNew) return `New CIS published — ${nm}`;
  const parts=[];
  if(diff.plansAdded.length)   parts.push(`${diff.plansAdded.length} plan${diff.plansAdded.length===1?"":"s"} added`);
  if(diff.plansRemoved.length) parts.push(`${diff.plansRemoved.length} plan${diff.plansRemoved.length===1?"":"s"} removed`);
  if(diff.fields.length){ const secs=[...new Set(diff.fields.map(f=>f.sec))];
    parts.push(`details updated (${secs.slice(0,3).join(", ")}${secs.length>3?", …":""})`); }
  return parts.length?`${nm} — ${parts.join(" · ")}`:`${nm} — republished`;
}
function wnHasChanges(diff){ return !!(diff && (diff.isNew || diff.plansAdded.length || diff.plansRemoved.length || diff.fields.length)); }
async function logCISChange(communityId, name, diff){
  if(DEMO||!sb||!wnHasChanges(diff)) return;
  const row={ id:uid(), community_id:communityId, community_name:name||"", at:new Date().toISOString(),
    by:state.email, kind:diff.isNew?"new":"update", summary:wnSummary(name,diff),
    detail:{ plansAdded:diff.plansAdded, plansRemoved:diff.plansRemoved, fields:diff.fields.slice(0,120) } };
  try{ const { error }=await sb.from("cdb_change_log").insert(row);
    if(error) console.warn("change log insert failed",error); else state.changeLog.unshift(row);
  }catch(e){ console.warn("change log insert failed",e); }
  refreshWhatsNewBadge();
}
/* seen-tracking: one global timestamp for the button badge, per-community for row dots */
function wnSeenMap(){ try{ return JSON.parse(localStorage.getItem("cdb_seen_comm")||"{}"); }catch(e){ return {}; } }
function markCommSeen(id){ try{ const m=wnSeenMap(); m[id]=new Date().toISOString(); localStorage.setItem("cdb_seen_comm",JSON.stringify(m)); }catch(e){} }
function commUnseen(id){
  const cut=new Date(Date.now()-WN_DOT_DAYS*864e5).toISOString();
  const seen=wnSeenMap()[id]||"";
  return (state.changeLog||[]).some(r=>r.community_id===id && r.at>cut && r.at>seen);
}
function refreshWhatsNewBadge(){
  const btn=$("whatsNewBtn"); if(!btn) return;
  let seen=null; try{ seen=localStorage.getItem("cdb_wn_seen"); }catch(e){}
  const latest=(state.changeLog[0]&&state.changeLog[0].at)||null;
  const unseen=!!(latest && (!seen || latest>seen));
  btn.classList.toggle("has-updates",unseen);
  btn.innerHTML="What's New"+(unseen?'<span class="notif-dot"></span>':"");
}
function openWhatsNew(){
  const rows=(state.changeLog||[]).slice(0,60);
  const items = rows.length ? rows.map((r,i)=>{
    const when=r.at?new Date(r.at).toLocaleString([], {month:"short",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit"}):"";
    const d=(r.detail && (typeof r.detail==="string"?(function(){try{return JSON.parse(r.detail);}catch(e){return null;}})():r.detail))||null;
    let det="";
    if(d){
      if(d.plansAdded&&d.plansAdded.length)   det+=`<div class="wn-sec"><div class="wn-sec-h">Plans added (${d.plansAdded.length})</div><ul class="wn-ul">${d.plansAdded.map(p=>`<li class="wn-add">${esc(p)}</li>`).join("")}</ul></div>`;
      if(d.plansRemoved&&d.plansRemoved.length) det+=`<div class="wn-sec"><div class="wn-sec-h">Plans removed (${d.plansRemoved.length})</div><ul class="wn-ul">${d.plansRemoved.map(p=>`<li class="wn-del">${esc(p)}</li>`).join("")}</ul></div>`;
      if(d.fields&&d.fields.length) det+=`<div class="wn-sec"><div class="wn-sec-h">Details changed (${d.fields.length})</div><ul class="wn-ul">${d.fields.slice(0,60).map(f=>`<li><b>${esc(f.label)}</b> <span class="tiny">(${esc(f.sec)})</span>${(f.from||f.to)?` <span class="wn-arrow">${esc(f.from)||"—"} → ${esc(f.to)||"—"}</span>`:""}</li>`).join("")}${d.fields.length>60?`<li class="tiny">…and ${d.fields.length-60} more</li>`:""}</ul></div>`;
    }
    const hasDet=!!det;
    const openable = r.community_id && itemById(r.community_id);
    return `<div class="wn-item">
      <button class="wn-toggle${hasDet?"":" nodetail"}" data-i="${i}">
        <span class="wn-when">${esc(when)}</span>
        ${r.kind==="new"?'<span class="pill pub" style="margin-right:6px">New</span>':""}
        <span class="wn-sum">${esc(r.summary||"")}</span>
        ${hasDet?'<span class="wn-chev">▸</span>':""}
      </button>
      ${hasDet?`<div class="wn-det hidden" data-d="${i}">${det}</div>`:""}
      <div class="wn-by">${esc(r.by||"")}${openable?` · <a href="#" class="wn-open" data-open="${esc(r.community_id)}">open community</a>`:""}</div>
    </div>`;
  }).join("") : `<div class="empty" style="padding:22px">Nothing yet — new CIS publishes, added plans and detail changes will show up here.</div>`;
  const scrim=document.createElement("div"); scrim.className="modal-scrim";
  const card=document.createElement("div"); card.className="modal-card wn-card";
  card.innerHTML=`<div class="modal-h">What's New — recent CIS updates<button class="wn-x" aria-label="Close">&times;</button></div>
    <div class="modal-b wn-body"><div class="wn-list">${items}</div></div>`;
  scrim.appendChild(card); document.body.appendChild(scrim);
  const close=()=>{ document.removeEventListener("keydown",onKey); scrim.remove(); };
  const onKey=e=>{ if(e.key==="Escape") close(); };
  document.addEventListener("keydown",onKey);
  scrim.addEventListener("mousedown",e=>{ if(e.target===scrim) close(); });
  card.querySelector(".wn-x").onclick=close;
  card.querySelectorAll(".wn-toggle:not(.nodetail)").forEach(b=>b.onclick=()=>{ const d=card.querySelector(`[data-d="${b.dataset.i}"]`); if(d){ d.classList.toggle("hidden"); b.classList.toggle("open"); } });
  card.querySelectorAll(".wn-open").forEach(a=>a.onclick=e=>{ e.preventDefault(); const id=a.dataset.open; close();
    showDash(); state.view="browse"; setTab(); render(); if(itemById(id)) openDetail(id); });
  const latest=rows[0]&&rows[0].at; if(latest){ try{ localStorage.setItem("cdb_wn_seen",latest); }catch(e){} }
  refreshWhatsNewBadge();
}

/* ---------- draft / publish ---------- */
async function ensureDraft(id){   // null = couldn't get one; callers must bail
  const it=itemById(id); if(!it) return null;
  if(it.draft) return it.draft;
  if(it.hasPub){ // clone published → draft via RPC, then reload
    const { data, error }=await sb.rpc("cdb_start_draft",{p_community_id:id});
    if(error || (data && !data.ok)){
      uiAlert((error&&error.message)||(data&&data.error)||"Couldn't start a draft.","Couldn't start a draft"); return null; }
    await loadAll(); renderPubq();   // a fresh draft makes any queued row for it stale
    const fresh=itemById(id); return (fresh&&fresh.draft)||null;
  }
  return it.draft||null;
}
async function saveDraft(row){
  row.status="draft"; row.updated_at=new Date().toISOString(); row.updated_by=state.email;
  if(!row.id) row.id=uid();
  const payload={ id:row.id, community_id:row.community_id, division:"orlando", status:"draft",
    name:row.name||null, jde:row.jde||null, project_name:row.project_name||null, hub:row.hub||null,
    source:row.source||"manual", model_start:row.model_start||null, needs_review:!!row.needs_review,
    data:row.data||{}, updated_at:row.updated_at, updated_by:row.updated_by };
  const { error } = await sb.from("cdb_cis").upsert(payload,{onConflict:"id"});
  if(error){ console.error(error); uiAlert("Save failed: "+error.message,"Couldn't save"); }
}
function refreshItemMeta(id){ const it=itemById(id); const row=it.draft||it.pub; if(row){ it.name=row.name||""; it.jde=row.jde||""; it.hub=row.hub||""; }
  const l=$("list"); if(l){ const r=l.querySelector(`.row[data-id="${id}"] .nm`); if(r) r.textContent=it.name||"(untitled)"; }
  renderPubq();   // an edit may have just made a queued row stale (or renamed it)
}
async function newCommunity(){
  const name=await uiPrompt("Community name",{title:"New community",okText:"Create",placeholder:"e.g. Bronson's Ridge"});
  if(name==null||!name.trim()) return;
  const row={ community_id:uid(), status:"draft", source:"manual", name:name.trim(),
    data:{ f:{ [SCHEMA.IDENTITY.name]:name.trim() }, plans:[], model:[], note:"", extra:{} } };
  await saveDraft(row); await loadAll(); render(); openDetail(row.community_id);
}
/* ---------- enclaves: add / rename group ---------- */
async function addEnclave(id){
  const it=itemById(id); if(!it) return;
  const grp=clusterFor(id); const gname=(grp&&grp.name)||clusterNameOf(it)||it.name||"";
  const label=await uiPrompt(`New enclave of "${gname}" — e.g. 60's, 40 Alley Loaded, 25ft TH`,
    {title:"Add enclave",okText:"Create",placeholder:"e.g. 60's"});
  if(label==null||!label.trim()) return;
  // enclaves are unique within their community — never create a duplicate entry
  const dup=grp&&grp.items.find(x=>lc(encLabel(grp,x))===lc(label.trim()));
  if(dup){ uiAlert(`"${gname}" already has an enclave "${encLabel(grp,dup)}". Pick it from the enclave dropdown instead of creating a duplicate.`,"Add enclave"); return; }
  // a standalone sheet with this exact name already exists → move it in instead of duplicating
  const nmWanted=(gname+" "+label.trim()).trim();
  const clash=state.items.find(x=>lc(x.name||"")===lc(nmWanted) && !(grp&&grp.items.some(y=>y.id===x.id)));
  if(clash){
    if(await uiConfirm(`A sheet named "${clash.name}" already exists. Attach that sheet to ${gname} instead of creating a new blank enclave? (An enclave lives in exactly one community — it moves, no duplicate.)`,
        {title:"Sheet already exists",okText:"Attach existing"})){
      if(await writeCommunityName(clash, gname)){ await loadAll(); render(); openDetail(clash.id); }
      return;
    }
    return;
  }
  const multi=grp&&grp.items.length>1;
  const cx=multi?clusterContext(grp):null;
  const base=shownRow(it); const bd=(base&&base.data)||{};
  const nm=(gname+" "+label.trim()).trim();
  // copy the SHARED values in; per-enclave sections start empty for the maker to fill
  const data={ f:{}, plans:[], model:[], note:"", extra:{} };
  SCHEMA.SECTIONS.forEach(sec=>{ (sec.fields||[]).forEach(f=>{
    if(f.k==="rev_date") return;
    if(cx ? !cx.fieldDiff[f.k] : true){ const v=fval(bd,f.k); if(v) data.f[f.k]=v; } }); });
  delete data.f.jde;                       // always enclave-specific
  data.f.community_name=gname; data.f.project_name=nm;
  Object.keys(bd.extra||{}).forEach(sid=>{ if(!cx || !cx.extraDiff[sid]) data.extra[sid]=JSON.parse(JSON.stringify(bd.extra[sid]||[])); });
  if(!cx || !cx.diff.note) data.note=bd.note||"";
  const rowNew={ community_id:uid(), status:"draft", source:(base&&base.source)||"manual",
    name:nm, project_name:nm, jde:null, hub:(base&&base.hub)||null, needs_review:true, data };
  await saveDraft(rowNew); await loadAll(); render(); openDetail(rowNew.community_id);
}
/* set ONLY data.f.community_name (as a draft) — the record's own name and
   project name are left alone so the enclave label stays derivable */
async function writeCommunityName(it, cn){
  const row=await ensureDraft(it.id); if(!row) return false;
  row.data=row.data||{}; row.data.f=row.data.f||{};
  row.data.f.community_name=String(cn||"").trim();
  if(!String(row.data.f.project_name||"").trim() && (row.name||it.name))
    row.data.f.project_name=row.name||it.name;
  await saveDraft(row); return true;
}
async function renameGroup(id){
  const grp=clusterFor(id); if(!grp||grp.items.length<2) return;
  const nn=await uiPrompt("Community name (shared across all enclaves — also what the selector shows)",
    {title:"Rename community",okText:"Rename",value:grp.name});
  if(nn==null||!nn.trim()||nn.trim()===grp.name) return;
  for(const x of grp.items) await writeCommunityName(x, nn.trim());
  await loadAll(); render(); openDetail(id);
}
/* attach an existing sheet to this community as an enclave (only its Community
   Name changes, as a draft — the sheet's data stays exactly as it is).
   An enclave belongs to exactly ONE community: the record itself is reused, so
   a sheet already in another community MOVES here — no duplicate is created. */
async function attachEnclave(id){
  const it=itemById(id); if(!it) return;
  const grp=clusterFor(id); const gname=(grp&&grp.name)||clusterNameOf(it)||it.name||"";
  const inGrp=new Set(grp?grp.items.map(x=>x.id):[id]);
  const homes=new Map();   // cluster key -> {name, size} so the picker can say where a sheet lives now
  state.items.forEach(x=>{ const k=clusterKeyOf(x); const h=homes.get(k)||{name:clusterNameOf(x)||x.name||"", n:0}; h.n++; homes.set(k,h); });
  const cands=state.items.filter(x=>!inGrp.has(x.id)).map(x=>{
    const h=homes.get(clusterKeyOf(x));
    return { x, from:(h&&h.n>1)?h.name:null };
  }).sort((a,b)=>{
    const am=lc(a.x.name||"").startsWith(lc(gname))?0:1, bm=lc(b.x.name||"").startsWith(lc(gname))?0:1;
    return am-bm || String(a.x.name||"").localeCompare(String(b.x.name||"")); });
  if(!cands.length){ uiAlert("There are no other sheets to attach.","Attach sheet"); return; }
  const opts=cands.map(c=>`<option value="${c.x.id}">${esc(c.x.name||"(untitled)")}${c.x.jde?` — JDE ${esc(c.x.jde)}`:""}${c.from?` — currently in ${esc(c.from)}`:""}</option>`).join("");
  const pick=await openModal({ title:`Attach a sheet to ${gname}`,
    body:`<p style="margin:0 0 10px">The chosen sheet becomes an enclave of <b>${esc(gname)}</b>. An enclave belongs to exactly one community — a sheet already in another community <b>moves</b> here rather than being duplicated. Only its Community Name changes, as a draft.</p>
      <select id="attachSel" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:9px 10px;font:inherit;background:var(--card);color:var(--ink)">${opts}</select>`,
    buttons:[{label:"Cancel",value:null},
             {label:"Attach",primary:true,value:card=>{ const s=card.querySelector("#attachSel"); return s?s.value:null; }}] });
  if(!pick) return;
  const target=itemById(pick); if(!target) return;
  const cand=cands.find(c=>c.x.id===pick);
  if(cand&&cand.from){
    if(!(await uiConfirm(`"${target.name}" is currently an enclave of ${cand.from}. Attach it to ${gname}? It moves — it will no longer appear under ${cand.from}.`,
        {title:"Move enclave",okText:"Move it"}))) return;
  }
  if(!(await writeCommunityName(target, gname))) return;
  await loadAll(); render(); openDetail(pick);
}
/* the reverse: an enclave becomes its own community again */
async function detachEnclave(id){
  const it=itemById(id); const grp=clusterFor(id); if(!it||!grp||grp.items.length<2) return;
  const own=(it.name||"").trim()||encLabel(grp,it);
  if(!(await uiConfirm(`Detach "${own}" from ${grp.name}? It becomes its own row in the selector (Community Name set to "${own}", as a draft). The sheet's data is unchanged.`,
      {title:"Detach enclave",okText:"Detach"}))) return;
  if(!(await writeCommunityName(it, own))) return;
  await loadAll(); render(); openDetail(id);
}
async function startDraft(id){ if(!await ensureDraft(id)) return; await loadAll(); render(); openDetail(id); }
async function discardDraft(id){
  if(!(await uiConfirm("Discard this draft? The published version stays live.",{title:"Discard draft",okText:"Discard",danger:true}))) return;
  await sb.from("cdb_cis").delete().eq("community_id",id).eq("status","draft"); await loadAll(); render();
  const still=itemById(id); if(still) openDetail(id); }
async function setActive(id, active){
  if(!active && !(await uiConfirm("Set this community inactive? It will be hidden from viewers by default (they can opt to show inactive).",{title:"Set inactive",okText:"Set inactive"}))) return;
  const { error } = await sb.from("cdb_cis").update({active}).eq("community_id",id);
  if(error){ uiAlert("Couldn't update: "+error.message,"Error"); return; }
  await loadAll(); render(); if(itemById(id)) openDetail(id);
}
async function unpublish(id){
  if(!(await uiConfirm("Unpublish this community? It will be hidden from viewers and returned to a draft. You can publish it again later.",
      {title:"Unpublish community",okText:"Unpublish",danger:true}))) return;
  const { data,error } = await sb.rpc("cdb_unpublish",{p_community_id:id});
  if(error||(data&&!data.ok)){ uiAlert("Unpublish failed: "+((error&&error.message)||(data&&data.error)),"Unpublish failed"); return; }
  await loadAll(); render(); if(itemById(id)) openDetail(id); else state.sel=null;
}
async function deleteCommunity(id){
  const it=itemById(id); const nm=(it&&it.name)||"this community";
  if(!(await uiConfirm(`Delete "${nm}" completely? This removes its draft, published version, all revisions and images, and cannot be undone.`,
      {title:"Delete community",okText:"Delete permanently",danger:true}))) return;
  const { data,error } = await sb.rpc("cdb_delete_community",{p_community_id:id});
  if(error||(data&&!data.ok)){ uiAlert("Delete failed: "+((error&&error.message)||(data&&data.error)),"Delete failed"); return; }
  const paths=(data&&data.paths)||[];
  if(paths.length){ try{ await sb.storage.from(CFG.IMAGE_BUCKET).remove(paths); }catch(e){} }
  pubqRemove(id);   // a deleted community can't be exported — drop it from the publish list
  state.sel=null; await loadAll(); render();
}
async function publish(id){
  if(!(await uiConfirm("Publish this draft? It becomes the live version for all viewers.",{title:"Publish community",okText:"Publish"}))) return;
  // diff draft vs live BEFORE publishing (publish clears the draft) → What's New entry
  const it=itemById(id);
  const diff=it?diffCIS(it.pub, it.draft):null;
  const nm=it?(((it.draft&&it.draft.name)||it.name)||""):"";
  const { data,error } = await sb.rpc("cdb_publish",{p_community_id:id});
  if(error||(data&&!data.ok)){ uiAlert("Publish failed: "+((error&&error.message)||(data&&data.error)),"Publish failed"); return; }
  await logCISChange(id, nm, diff);
  await loadAll();
  const fresh=itemById(id);
  pubqAdd(id, (fresh&&fresh.name)||nm, (fresh&&fresh.jde)||(it&&it.jde));
  render(); openDetail(id);
}

/* ---------- images (downsampled upload) ---------- */
function imagesHTML(id, editing){
  const arr=state.imgs[id]||[];
  if(!arr.length) return `<div class="empty" style="padding:22px">${editing?"No images yet — add site plans, lot exhibits or renderings.":"No images."}</div>`;
  return `<div class="imgs">`+arr.map(im=>{ const u=state.imgUrls[im.path]||"";
    return `<div class="card"><img src="${esc(u)}" data-cap="${esc(im.caption||"")}" alt="${esc(im.caption||"")}">
      <div class="cap">${editing?`<input value="${esc(im.caption||"")}" data-capedit="${im.id}" placeholder="Caption…">`:`<div class="hint">${esc(im.caption||"")}</div>`}</div>
      ${editing?`<div class="meta"><span>${im.published?"published":"draft"}</span><button class="rowdel" data-imgdel="${im.id}">Delete</button></div>`:""}</div>`;
  }).join("")+`</div>`;
}
function pickImages(id){ const inp=document.createElement("input"); inp.type="file"; inp.accept="image/*"; inp.multiple=true;
  inp.onchange=()=>{ if(inp.files.length) uploadImages(id,[...inp.files]); }; inp.click(); }
async function downscale(file){
  const img=await new Promise((res,rej)=>{ const i=new Image(); i.onload=()=>res(i); i.onerror=rej; i.src=URL.createObjectURL(file); });
  const max=CFG.IMAGE_MAX_EDGE; let {width:w,height:h}=img; const scale=Math.min(1,max/Math.max(w,h));
  w=Math.round(w*scale); h=Math.round(h*scale);
  const c=document.createElement("canvas"); c.width=w; c.height=h; c.getContext("2d").drawImage(img,0,0,w,h);
  URL.revokeObjectURL(img.src);
  const blob=await new Promise(r=>c.toBlob(r,"image/jpeg",CFG.IMAGE_QUALITY));
  return { blob, w, h };
}
async function uploadImages(id, files){
  let n=(state.imgs[id]||[]).length;   // base sort_order once; bump per uploaded file
  for(const f of files){
    try{
      const { blob,w,h } = await downscale(f);
      const path=`${id}/${uid()}.jpg`;
      const { error } = await sb.storage.from(CFG.IMAGE_BUCKET).upload(path, blob, { contentType:"image/jpeg", upsert:false });
      if(error) throw error;
      const rec={ id:uid(), community_id:id, path, caption:f.name.replace(/\.[^.]+$/,""), sort_order:n, published:false, w, h, created_by:state.email };
      const { error:e2 } = await sb.from("cdb_images").insert(rec); if(e2) throw e2;
      n++;
    }catch(e){ uiAlert("Image upload failed: "+(e.message||e),"Upload failed"); }
  }
  await loadAll(); openDetail(id);
  // wire caption edits + delete after re-render
  $("detail").querySelectorAll("[data-capedit]").forEach(inp=>inp.onchange=()=>saveCaption(inp.dataset.capedit,inp.value));
  $("detail").querySelectorAll("[data-imgdel]").forEach(b=>b.onclick=()=>delImage(id,b.dataset.imgdel));
}
async function saveCaption(imgId,cap){ await sb.from("cdb_images").update({caption:cap}).eq("id",imgId); }
async function delImage(id,imgId){ if(!(await uiConfirm("Delete this image?",{title:"Delete image",okText:"Delete",danger:true}))) return;
  const im=(state.imgs[id]||[]).find(x=>x.id===imgId);
  if(im){ try{ await sb.storage.from(CFG.IMAGE_BUCKET).remove([im.path]); }catch(e){} }
  await sb.from("cdb_images").delete().eq("id",imgId); await loadAll(); openDetail(id); }

/* ---------------- GAPS (editor) ---------------- */
function isGap(v){ const s=lc(v).trim(); return !s || s==="tbd" || s==="tbd in source"; }
function gapRows(){
  const rows=[];
  // reflect whatever's currently displayed (search + inactive/drafts filters) and
  // the row you can actually see (published for viewers, draft in maker mode)
  visibleItems().forEach(it=>{ const row=shownRow(it); if(!row) return; const d=row.data||{}; const f=d.f||{};
    SCHEMA.SECTIONS.forEach(sec=>{ if(sec.kind!=="kv" || sec.retired) return;
      sec.fields.forEach(fl=>{ if(fl.readonly || fl.retired) return; if(isGap(f[fl.k])) rows.push({name:it.name,id:it.id,field:sec.title+" · "+fl.label,status:(lc(f[fl.k])==="tbd"?"TBD in source":"Missing")}); });
    });
  });
  return rows;
}
function renderGaps(a){
  a.innerHTML=`<div class="note"><b>Gaps</b> are CIS fields that are still empty or marked TBD. Fill them in on a community's page and they clear here. Reflects your current search and filters from the Communities tab.</div>
    <div class="bar"><input type="search" id="q" placeholder="Search name, JDE, plan #, or any field…" value="${esc(state.q)}"><select id="gStatus"><option value="">All statuses</option><option>Missing</option><option>TBD in source</option></select><span class="hint" id="gShown"></span></div>
    <div class="panel"><div id="gapsTable"></div></div>`;
  const paint=()=>{ const st=$("gStatus").value;
    let rs=gapRows().filter(r=>!st||r.status===st);   // gapRows already honors the shared search via visibleItems()
    $("gShown").textContent=`${rs.length} gaps`;
    $("gapsTable").innerHTML= rs.length? `<table><tr><th>Community</th><th>Field</th><th>Status</th></tr>`+rs.map(r=>`<tr><td><a href="#" data-goto="${r.id}">${esc(r.name)}</a></td><td>${esc(r.field)}</td><td>${esc(r.status)}</td></tr>`).join("")+`</table>`:`<div class="empty">No gaps.</div>`;
    $("gapsTable").querySelectorAll("[data-goto]").forEach(a2=>a2.onclick=e=>{ e.preventDefault(); state.view="browse"; setTab(); state.sel=a2.dataset.goto; render(); openDetail(a2.dataset.goto); });
  };
  $("q").addEventListener("input",e=>{ state.q=e.target.value; updateCounts(); paint(); });
  $("gStatus").addEventListener("change",paint); paint();
}

/* ---------------- TEMPLATE EDITOR (editors + admins, maker side) ----------------
   Edits a working copy of SCHEMA.SECTIONS; nothing changes for anyone until
   Save template. Community data is never written from here:
   - Remove marks a saved row/section `retired` (hidden where empty, kept where
     filled — see the TEMPLATE notes at the top). Rows/sections added in this
     unsaved session are simply dropped.
   - Restore clears `retired`, which brings existing values straight back.
   - New rows get fresh keys, so they can never collide with existing data.
   Identity fields (Community Name, JDE, Project Name, Product Type) and the
   auto-stamped Revision Date can be renamed but not removed, and the section
   holding them can't be removed either. */
const TPL_LOCKED = new Set([SCHEMA.IDENTITY.name, SCHEMA.IDENTITY.jde, SCHEMA.IDENTITY.project, SCHEMA.IDENTITY.product]);
const TPL_KIND = { kv:"Fields", plans:"Plan table", grid:"Table", note:"Free text" };
const rid = p => p + Math.random().toString(36).slice(2,10);
function tplWork(){ if(!state.tpl){ state.tpl=clone(SCHEMA.SECTIONS); state.tplNew={}; } return state.tpl; }
function tplDirty(){ return !!state.tpl && JSON.stringify(state.tpl)!==JSON.stringify(SCHEMA.SECTIONS); }
function fieldLocked(f){ return !!f.readonly || TPL_LOCKED.has(f.k); }
function secLocked(s){ return s.kind==="kv" && (s.fields||[]).some(f=>fieldLocked(f)); }
function tplRowList(s){ return s.kind==="kv" ? s.fields : s.kind==="grid" ? s.rows : null; }
const tplRid = r => r.k || ("p"+r.pos);
function tplRowKey(s,r){ return s.id+"/"+tplRid(r); }

/* how many communities hold data for a row/section (either the live or the draft version) */
function tplUse(pred){ return state.items.filter(it=>[it.pub,it.draft].some(row=>row && pred(row.data||{}))).length; }
function tplRowUse(s,r){
  if(s.kind==="kv") return tplUse(d=>fval(d,r.k)!=="");
  if(s.kind==="grid") return tplUse(d=>hasCells(typeof r.pos==="number" ? (Array.isArray(d[s.key])?d[s.key]:[])[r.pos] : (((d.gridx||{})[s.key])||{})[r.k]));
  return 0;
}
const tplUseTxt = n => n ? `${n} sheet${n===1?"":"s"} filled` : `<span class="none">empty everywhere</span>`;
const tplWhen = t => t ? new Date(t).toLocaleString([], {month:"short",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit"}) : "";

function renderTemplate(a){
  const T=tplWork(); const dirty=tplDirty(); const meta=state.tplMeta||{};
  const saved = meta.saved ? `Last saved ${esc(tplWhen(meta.updated_at))}${meta.updated_by?` by ${esc(meta.updated_by)}`:""}`
                           : "Using the default layout — not saved yet";
  const active=T.map((s,i)=>({s,i})).filter(x=>!x.s.retired);
  const removed=T.map((s,i)=>({s,i})).filter(x=>x.s.retired);
  a.innerHTML=`
    <div class="note"><b>Template</b> sets the sections and rows every community sheet uses. Changes go live for everyone when you press <b>Save template</b>.
      Removing a row or section never deletes data: it disappears only from sheets where it's empty, and sheets that already have a value keep it and still show it. Removed items can be restored.</div>
    <div class="bar">
      <button class="btn mini solid" id="tplSave" ${dirty&&!state.tplBusy?"":"disabled"}>${state.tplBusy?"Saving…":"Save template"}</button>
      <button class="btn mini ghost" id="tplDiscard" ${dirty&&!state.tplBusy?"":"disabled"}>Discard changes</button>
      <button class="btn mini ghost" id="tplAddSec">+ Add section</button>
      ${dirty?`<span class="pill draft">Unsaved changes</span>`:""}
      <span class="hint">${saved}</span>
    </div>
    <div class="tpl-list" id="tplList">
      ${active.map((x,n)=>tplSecHTML(x.s, x.i, n>0, n<active.length-1)).join("")}
      ${removed.length?`<details class="panel tpl-removed"><summary>Removed sections (${removed.length})</summary>
        <table class="tpl-t">${removed.map(x=>`<tr><td class="tpl-lbl">${esc(x.s.title)} <span class="tpl-kind">${TPL_KIND[x.s.kind]||""}</span></td>
          <td class="tpl-use">${tplUseTxt(tplUse(d=>secHasData(x.s,d)))}</td>
          <td class="tpl-acts"><button class="tbtn" data-act="srestore" data-s="${x.i}">Restore</button></td></tr>`).join("")}</table></details>`:""}
    </div>`;
  $("tplSave").onclick=tplSave;
  $("tplDiscard").onclick=tplDiscard;
  $("tplAddSec").onclick=()=>tplAct("sadd");
  $("tplList").addEventListener("click",e=>{ const b=e.target.closest("[data-act]"); if(!b||b.disabled||state.tplBusy) return;
    tplAct(b.dataset.act, b.dataset.s!=null?+b.dataset.s:null, b.dataset.r!=null?+b.dataset.r:null); });
}
function tplSecHTML(s, si, canUp, canDown){
  const locked=secLocked(s);
  let h=`<div class="panel tpl-sec"><div class="sec"><span>${esc(s.title)||'<i>(untitled)</i>'} <span class="tpl-kind">${TPL_KIND[s.kind]||""}</span>${state.tplNew[s.id]?' <span class="tpl-kind">new</span>':""}</span>
    <span class="sec-right">
      <button data-act="sup" data-s="${si}" ${canUp?"":"disabled"} title="Move section up" aria-label="Move section up">&#8593;</button>
      <button data-act="sdown" data-s="${si}" ${canDown?"":"disabled"} title="Move section down" aria-label="Move section down">&#8595;</button>
      <button data-act="sren" data-s="${si}">Rename</button>
      ${locked?`<button disabled title="Holds the community's identity fields, so it can't be removed">Remove</button>`:`<button data-act="sdel" data-s="${si}">Remove</button>`}
    </span></div>`;
  if(s.kind==="plans") h+=`<div class="tpl-info">Plan rows are added on each sheet. Columns: ${SCHEMA.PLAN_COLS.map(esc).join(" · ")}</div>`;
  if(s.kind==="note")  h+=`<div class="tpl-info">A free-text notes box on each sheet.</div>`;
  if(s.kind==="grid")  h+=`<div class="tpl-info">Columns: ${s.columns.map(esc).join(" · ")}. The rows below are offered on every sheet; each sheet can also add its own.</div>`;
  const list=tplRowList(s);
  if(list){
    const act=list.map((r,ri)=>({r,ri})).filter(x=>!x.r.retired);
    const rem=list.map((r,ri)=>({r,ri})).filter(x=>x.r.retired);
    h+=`<table class="tpl-t">${act.map((x,n)=>{ const r=x.r; const lk=s.kind==="kv"&&fieldLocked(r);
      return `<tr><td class="tpl-lbl">${esc(r.label)||'<span class="none">(no label)</span>'}${
          r.readonly?'<span class="autotag">auto</span>':lk?'<span class="autotag">required</span>':""}${
          state.tplNew[tplRowKey(s,r)]?'<span class="autotag tpl-new">new</span>':""}</td>
        <td class="tpl-use">${tplUseTxt(tplRowUse(s,r))}</td>
        <td class="tpl-acts">
          <button class="tbtn" data-act="rup" data-s="${si}" data-r="${x.ri}" ${n>0?"":"disabled"} title="Move up" aria-label="Move up">&#8593;</button>
          <button class="tbtn" data-act="rdown" data-s="${si}" data-r="${x.ri}" ${n<act.length-1?"":"disabled"} title="Move down" aria-label="Move down">&#8595;</button>
          <button class="tbtn" data-act="rren" data-s="${si}" data-r="${x.ri}">Rename</button>
          ${lk?`<button class="tbtn" disabled title="Required — can be renamed but not removed" aria-label="Required row">&times;</button>`
              :`<button class="tbtn del" data-act="rdel" data-s="${si}" data-r="${x.ri}" title="Remove row" aria-label="Remove ${esc(r.label)}">&times;</button>`}
        </td></tr>`; }).join("")}
      ${!act.length?`<tr><td colspan="3"><span class="none">No template rows yet${s.id==="deck"?" — this section also shows lines merged in per sheet":""}.</span></td></tr>`:""}
      <tr class="tpl-addrow"><td colspan="3"><button class="tbtn add" data-act="radd" data-s="${si}">+ Add row</button></td></tr></table>`;
    if(rem.length) h+=`<details class="tpl-removed-rows"><summary>Removed rows (${rem.length})</summary><table class="tpl-t">${rem.map(x=>
      `<tr><td class="tpl-lbl">${esc(x.r.label)}</td><td class="tpl-use">${tplUseTxt(tplRowUse(s,x.r))}</td>
        <td class="tpl-acts"><button class="tbtn" data-act="rrestore" data-s="${si}" data-r="${x.ri}">Restore</button></td></tr>`).join("")}</table></details>`;
  }
  return h+`</div>`;
}
/* swap arr[i] with the nearest non-retired neighbour in direction dir */
function tplMove(arr, i, dir){
  let j=i+dir; while(j>=0 && j<arr.length && arr[j].retired) j+=dir;
  if(j<0 || j>=arr.length) return;
  const t=arr[i]; arr[i]=arr[j]; arr[j]=t;
}
async function tplAct(act, si, ri){
  const T=tplWork();
  if(act==="sadd"){
    const v=await uiPrompt("Section title",{title:"Add section",okText:"Add",placeholder:"e.g. HOA Requirements"});
    if(!v) return;
    if(T.some(s=>!s.retired && lc(s.title).trim()===lc(v))){ uiAlert(`There's already a section called "${v}".`,"Add section"); return; }
    const s={ id:rid("s_"), title:v, kind:"kv", fields:[] };
    // new sections go just above Notes when Notes is the last active section
    let at=T.length; for(let i=T.length-1;i>=0;i--){ if(T[i].retired) continue; if(T[i].kind==="note") at=i; break; }
    T.splice(at,0,s); state.tplNew[s.id]=1;
    return tplRepaint();
  }
  const s=T[si]; if(!s) return;
  const list=tplRowList(s);
  if(act==="sup"||act==="sdown") tplMove(T, si, act==="sup"?-1:1);
  else if(act==="sren"){
    const v=await uiPrompt("Section title",{title:"Rename section",okText:"Rename",value:s.title}); if(!v) return; s.title=v; }
  else if(act==="sdel"){
    if(secLocked(s)) return;
    if(state.tplNew[s.id]){ T.splice(si,1); delete state.tplNew[s.id]; return tplRepaint(); }
    const n=tplUse(d=>secHasData(s,d));
    if(!(await uiConfirm(`Remove "${s.title}" from the template? ${n
        ? `It disappears from sheets where it's empty. ${n} sheet${n===1?" has":"s have"} data in it — ${n===1?"that sheet keeps its data and still shows":"those sheets keep their data and still show"} the section.`
        : "No sheet has data in it."} You can restore it later.`,{title:"Remove section",okText:"Remove"}))) return;
    s.retired=true;
  }
  else if(act==="srestore") delete s.retired;
  else if(!list) return;
  else if(act==="radd"){
    const v=await uiPrompt(`New row in "${s.title}"`,{title:"Add row",okText:"Add",placeholder:s.kind==="grid"?"e.g. Model Home Plan 4":"e.g. Fence Type"});
    if(!v) return;
    const hit=list.find(r=>lc(r.label).trim()===lc(v));
    if(hit && !hit.retired){ uiAlert(`"${s.title}" already has a row called "${hit.label}".`,"Add row"); return; }
    if(hit && hit.retired){
      if(await uiConfirm(`"${hit.label}" was removed from this section earlier. Restore it instead? Any values sheets already have come back with it.`,{title:"Restore row",okText:"Restore"})) delete hit.retired;
      return tplRepaint();
    }
    const r={ k:rid(s.kind==="kv"?"c_":"r_"), label:v };
    list.push(r); state.tplNew[tplRowKey(s,r)]=1;
  }
  else {
    const r=list[ri]; if(!r) return;
    if(act==="rup"||act==="rdown") tplMove(list, ri, act==="rup"?-1:1);
    else if(act==="rren"){
      const v=await uiPrompt("Row label",{title:"Rename row",okText:"Rename",value:r.label}); if(!v) return;
      if(list.some(x=>x!==r && !x.retired && lc(x.label).trim()===lc(v))){ uiAlert(`"${s.title}" already has a row called "${v}".`,"Rename row"); return; }
      r.label=v;
    }
    else if(act==="rdel"){
      if(s.kind==="kv" && fieldLocked(r)) return;
      const key=tplRowKey(s,r);
      if(state.tplNew[key]){ list.splice(ri,1); delete state.tplNew[key]; return tplRepaint(); }
      const n=tplRowUse(s,r);
      if(!(await uiConfirm(`Remove "${r.label}" from ${s.title}? ${n
          ? `It disappears from sheets where it's empty. ${n} sheet${n===1?" has":"s have"} a value — ${n===1?"that sheet keeps it and still shows":"those sheets keep it and still show"} the row.`
          : "No sheet has a value in it."} You can restore it later.`,{title:"Remove row",okText:"Remove"}))) return;
      r.retired=true;
    }
    else if(act==="rrestore") delete r.retired;
  }
  tplRepaint();
}
function tplRepaint(){ if(state.view==="template") renderTemplate($("viewArea")); updateCounts(); }
async function tplDiscard(){
  if(!tplDirty()) return;
  if(!(await uiConfirm("Discard your unsaved template changes?",{title:"Discard changes",okText:"Discard",danger:true}))) return;
  state.tpl=null; state.tplNew={}; tplRepaint();
}
async function tplSave(){
  const T=state.tpl; if(!T || !tplDirty() || state.tplBusy) return;
  if(DEMO||!sb){ uiAlert("Not connected to the database.","Save template"); return; }
  if(T.some(s=>!String(s.title||"").trim()) || T.some(s=>(tplRowList(s)||[]).some(r=>!String(r.label||"").trim()))){
    uiAlert("Every section and row needs a label before saving.","Save template"); return; }
  const sum=tplChangeSummary(SCHEMA.SECTIONS, T);
  if(!(await uiConfirm(`Save the template? It applies to every community sheet right away.${sum?` Changes: ${sum}.`:""}`,{title:"Save template",okText:"Save template"}))) return;
  state.tplBusy=true; tplRepaint();
  try{
    // someone else saved since this copy was loaded? don't silently overwrite them
    const { data:cur, error:e0 }=await sb.from("cdb_template").select("updated_at,updated_by").eq("id",TPL_ID).maybeSingle();
    if(e0) throw e0;
    const theirs=cur?cur.updated_at:null, mine=(state.tplMeta&&state.tplMeta.updated_at)||null;
    if(theirs && theirs!==mine){
      if(!(await uiConfirm(`${cur.updated_by||"Someone"} saved the template (${tplWhen(theirs)}) after you loaded it. Saving replaces their version with yours. Refresh the page first if you'd rather start from theirs.`,
          {title:"Template changed",okText:"Save mine anyway",danger:true}))) return;
    }
    const clean=normTemplate(T); const now=new Date().toISOString();
    const { data:saved, error }=await sb.from("cdb_template")
      .upsert({ id:TPL_ID, sections:clean, updated_at:now, updated_by:state.email },{onConflict:"id"}).select().maybeSingle();
    if(error) throw error;
    const { error:e2 }=await sb.from("cdb_template_revisions").insert({ template_id:TPL_ID, sections:clean, saved_at:now, saved_by:state.email });
    if(e2) console.warn("template revision insert failed",e2);
    SCHEMA.SECTIONS=clean; state.tpl=null; state.tplNew={};
    state.tplMeta={ updated_at:(saved&&saved.updated_at)||now, updated_by:state.email, saved:true };
  }catch(e){
    const m=(e&&e.message)||String(e);
    uiAlert("Couldn't save the template: "+m+(/relation|does not exist|schema cache|cdb_template/i.test(m)?" — run add_template.sql in Supabase first.":""),"Save failed");
  }finally{ state.tplBusy=false; tplRepaint(); }
}
/* short human summary of what changed, for the save confirmation */
function tplChangeSummary(before, after){
  const B=new Map(before.map(s=>[s.id,s]));
  let addS=0, remS=0, addR=0, remR=0, ren=0, moved=false;
  const both=new Set(after.filter(s=>!s.retired && B.has(s.id) && !B.get(s.id).retired).map(s=>s.id));
  if(before.filter(s=>both.has(s.id)).map(s=>s.id).join()!==after.filter(s=>both.has(s.id)).map(s=>s.id).join()) moved=true;
  after.forEach(s=>{ const o=B.get(s.id);
    if(!o){ if(!s.retired) addS++; return; }
    if(!o.retired && s.retired) remS++;
    if(o.retired && !s.retired) addS++;
    if(o.title!==s.title) ren++;
    const ol=tplRowList(o)||[], nl=tplRowList(s)||[];
    const OB=new Map(ol.map(r=>[tplRid(r),r]));
    nl.forEach(r=>{ const x=OB.get(tplRid(r));
      if(!x){ if(!r.retired) addR++; return; }
      if(!x.retired && r.retired) remR++;
      if(x.retired && !r.retired) addR++;
      if(x.label!==r.label) ren++; });
    const was=ol.filter(r=>!r.retired).map(tplRid).filter(k=>nl.some(r=>!r.retired&&tplRid(r)===k)).join(",");
    const now=nl.filter(r=>!r.retired && OB.has(tplRid(r)) && !OB.get(tplRid(r)).retired).map(tplRid).join(",");
    if(was!==now) moved=true;
  });
  const p=(n,w)=>`${n} ${w}${n===1?"":"s"}`;
  const parts=[];
  if(addS) parts.push(p(addS,"section")+" added");
  if(remS) parts.push(p(remS,"section")+" removed");
  if(addR) parts.push(p(addR,"row")+" added");
  if(remR) parts.push(p(remR,"row")+" removed");
  if(ren)  parts.push(p(ren,"rename"));
  if(moved) parts.push("reordered");
  return parts.join(", ");
}

/* ---------------- PUBLISH ALL DRAFTS (Communities toolbar, maker side) ---------------- */
async function publishAllDrafts(){
  const ids=state.items.filter(it=>it.hasDraft).map(it=>it.id);
  if(!ids.length){ uiAlert("There are no drafts to publish.","Publish all drafts"); return; }
  if(!(await uiConfirm(`Publish all ${ids.length} drafts? Each becomes the live version for viewers.`,{title:"Publish all drafts",okText:"Publish all"}))) return;
  let ok=0; const queued=[];
  for(const id of ids){
    const it=itemById(id);
    const diff=it?diffCIS(it.pub, it.draft):null;
    const nm=it?(((it.draft&&it.draft.name)||it.name)||""):"";
    const { data,error }=await sb.rpc("cdb_publish",{p_community_id:id});
    if(!error&&data&&data.ok){ ok++; await logCISChange(id, nm, diff); queued.push({id,nm,jde:(it&&it.jde)||""}); }
  }
  // oldest first so the panel ends up newest-at-top, same as single publishes
  queued.reverse().forEach(q=>pubqAdd(q.id, q.nm, q.jde));
  await loadAll(); render();
  uiAlert(ok===ids.length?`Published ${ok} draft${ok===1?"":"s"}.`:`Published ${ok} of ${ids.length} drafts — the rest failed; check them individually.`,"Publish all drafts");
}

/* ---------------- ADMIN: reset link + roles ---------------- */
async function renderResetLink(){
  const p=$("resetPanel");
  p.innerHTML=`<div class="panel"><div class="sec"><span>Add user / reset password</span></div><div style="padding:14px">
    <p class="tiny">Creates the account if new and generates a one-time link the person uses to set their password. No email is sent — copy and share it.</p>
    <div class="linkrow"><input type="email" id="ruEmail" placeholder="person@lennar.com"><button class="btn mini" id="ruGen">Generate link</button></div>
    <div id="ruOut" style="margin-top:10px"></div></div></div>`;
  $("ruGen").onclick=async()=>{
    const email=lc($("ruEmail").value.trim()); const out=$("ruOut");
    if(!email.endsWith(CFG.ALLOWED_DOMAIN)){ out.innerHTML=`<span class="msg err" style="display:inline-block;padding:8px">Must be a ${esc(CFG.ALLOWED_DOMAIN)} address.</span>`; return; }
    out.textContent="Working…";
    const { data,error }=await sb.rpc("cdb_admin_add_or_reset",{target_email:email});
    if(error||(data&&!data.ok)){ out.innerHTML=`<span class="msg err" style="display:inline-block;padding:8px">${esc((error&&error.message)||(data&&data.error)||"Failed")}</span>`; return; }
    const url=((CFG.BLUEPRINT_URL||(location.origin+location.pathname)).replace(/#.*$/,""))+"#recover="+encodeURIComponent(data.token)+"&pool=cdb";
    out.innerHTML=`<div class="msg ok" style="padding:8px">Link for <b>${esc(email)}</b> — share it privately:</div><div class="linkrow"><input type="text" id="ruLink" readonly value="${esc(url)}"><button class="btn mini ghost" id="ruCopy">Copy</button></div>`;
    $("ruCopy").onclick=()=>{ const ok=()=>{ $("ruCopy").textContent="Copied"; };
      const fallback=()=>{ $("ruLink").select(); try{ document.execCommand("copy"); ok(); }catch(e){} };
      if(navigator.clipboard&&navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(ok).catch(fallback); else fallback(); };
    renderPerms();
  };
}
async function renderPerms(){
  const p=$("permsPanel");
  let rows=[]; try{ const { data }=await sb.rpc("cdb_admin_list_users"); rows=data||[]; }catch(e){}
  rows.sort((a,b)=>String(a.email).localeCompare(String(b.email)));
  state.users=rows;
  p.innerHTML=`<div class="panel"><div class="sec"><span>Users &amp; roles</span><span class="sec-count" id="userCount"></span></div>
    <div style="padding:12px 14px 14px">
      <input type="text" id="userSearch" class="permsearch" placeholder="Search users by email or role…">
      <div id="userList"></div>
    </div></div>`;
  $("userSearch").oninput=drawUsers;
  drawUsers();
}
function drawUsers(){
  const list=$("userList"); if(!list) return;
  const q=lc(($("userSearch")&&$("userSearch").value)||"");
  const rows=q ? state.users.filter(u=>lc(u.email).includes(q)||lc(u.role).includes(q)) : state.users;
  const cnt=$("userCount"); if(cnt) cnt.textContent=`${rows.length}${q?" of "+state.users.length:""}`;
  list.innerHTML = rows.length
    ? `<table class="perms-t"><tr><th>Email</th><th>Role</th><th></th></tr>${rows.map(r=>`<tr><td>${esc(r.email)}</td>
        <td><select data-role="${esc(r.email)}"><option value="viewer"${r.role==="viewer"?" selected":""}>viewer</option><option value="editor"${r.role==="editor"?" selected":""}>editor</option><option value="admin"${r.role==="admin"?" selected":""}>admin</option></select></td>
        <td><button class="rowdel" data-rmuser="${esc(r.email)}">Remove</button></td></tr>`).join("")}</table>`
    : `<div class="empty">${q?"No users match your search.":"No users."}</div>`;
  list.querySelectorAll("[data-role]").forEach(s=>s.onchange=async()=>{ await sb.from("cdb_app_roles").upsert({email:s.dataset.role,role:s.value},{onConflict:"email"}); const u=state.users.find(x=>x.email===s.dataset.role); if(u) u.role=s.value; });
  list.querySelectorAll("[data-rmuser]").forEach(b=>b.onclick=async()=>{ if(await uiConfirm("Remove "+b.dataset.rmuser+"'s role? They become a viewer.",{title:"Remove role",okText:"Remove",danger:true})){ await sb.from("cdb_app_roles").delete().eq("email",b.dataset.rmuser); await renderPerms(); } });
}

/* ---------------- BOOTSTRAP ---------------- */
if(!initRecovery()) checkSession();
