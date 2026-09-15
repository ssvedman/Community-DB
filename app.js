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
                pubq:[], pubqOpen:true, pubqBusy:false };
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
  await loadAll(); render(); refreshWhatsNewBadge();
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
// Gaps + Add/import live on the maker side only — hidden in Viewer mode.
function syncEditorTabs(){ document.querySelectorAll(".editoronly").forEach(el=>el.classList.toggle("hidden", !making())); }
function wireChrome(){
  $("logoutBtn").onclick=logout; $("themeBtn").onclick=toggleTheme;
  if($("whatsNewBtn")) $("whatsNewBtn").onclick=openWhatsNew;
  $("homeLogo").onclick=()=>{ showDash(); state.view="browse"; setTab(); render(); };
  $("adminLink").onclick=showAdmin; $("dashLink").onclick=()=>{ showDash(); render(); };
  $("modeToggle").querySelectorAll(".mode").forEach(b=>b.onclick=()=>{
    state.mode=b.dataset.mode; $("modeToggle").querySelectorAll(".mode").forEach(x=>x.classList.toggle("on",x===b));
    if(state.mode==="view" && (state.view==="gaps"||state.view==="add")){ state.view="browse"; setTab(); }
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
  if(state.view==="add"   && isEditor()) return renderAdd(a);
  state.view="browse"; setTab(); renderBrowse(a);
}
function updateCounts(){
  $("cBrowse").textContent = clusterList().length;
  const g=$("cGaps"); if(g) g.textContent = making()? gapRows().length : "";
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
  a.innerHTML = `
    <div class="bar">
      <input type="search" id="q" placeholder="Search name, JDE, plan #, or any field (e.g. H006)…" value="${esc(state.q)}">
      ${making()?`<button class="btn mini solid" id="newComm">+ New community</button>
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

  if(!multi){ SCHEMA.SECTIONS.forEach(sec=>{ h+=renderSection(sec, d, editing, id); }); }
  else { const cx=clusterContext(grp); SCHEMA.SECTIONS.forEach(sec=>{ h+=renderClusterSection(sec, cx, it, editing); }); }
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
    let rows=sec.fields.map(f=>{ const v=fval(d,f.k); if(!v && (!editing || f.readonly)) return "";
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
    return { btn: editing?`<button data-pladd="1">Add row</button>`:"",
             body: `<div class="tscroll"><table class="plans-t">${head}${body}</table></div>` };
  }
  if(sec.kind==="grid"){
    const arr=Array.isArray(d[sec.key])?d[sec.key]:[];
    const rowHas=ri=>{ const r=arr[ri]||[]; return Array.isArray(r)&&r.some(x=>x!=null&&String(x).trim()!==""); };
    const anyVal=sec.rowLabels.some((_,ri)=>rowHas(ri));
    if(!anyVal && !editing) return { btn:"", body:"" };
    // Blank rows never show on the published/viewer side (same as the kv lines).
    // In maker mode the default is the filled rows plus ONE blank entry row;
    // "Show all rows" reveals the rest of the labels when they're needed.
    const showAll = editing && state.gridShowAll && state.gridShowAll[sec.key];
    let blankShown=false;
    const visible=sec.rowLabels.map((lbl,ri)=>{
      if(rowHas(ri)) return true;
      if(!editing) return false;
      if(showAll) return true;
      if(!blankShown){ blankShown=true; return true; }
      return false; });
    const hiddenN=editing?visible.filter(v=>!v).length:0;
    let head=`<tr><th class="nowrap">${esc(sec.rowHeader||"")}</th>${sec.columns.map(c=>`<th class="nowrap">${esc(c)}</th>`).join("")}${editing?"<th></th>":""}</tr>`;
    let body=sec.rowLabels.map((lbl,ri)=>{ if(!visible[ri]) return ""; const row=arr[ri]||[];
      return `<tr><td class="k">${esc(lbl)}</td>${sec.columns.map((c,ci)=>`<td class="v">${editing?evCell(id,`m.${ri}.${ci}`,row[ci]||""):esc(row[ci]||"")}</td>`).join("")}${
        rowXCell(editing, rowHas(ri), `data-mdel="${esc(sec.key)}.${ri}"`, lbl)}</tr>`; }).join("");
    return { btn: editing?`<button data-gridall="${esc(sec.key)}">${showAll?"Show fewer rows":`Show all rows${hiddenN?` (${hiddenN} more)`:""}`}</button>`:"",
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
    else if(sec.kind==="grid"){ const js=datas.map(d=>JSON.stringify(d[sec.key]||[])); cx.diff[sec.id]=!js.every(x=>x===js[0]); }
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
    sec.rowLabels.forEach((lbl,ri)=>{
      const vals=cx.datas.map(d=>((Array.isArray(d[sec.key])?d[sec.key]:[])[ri]||[]).filter(x=>S(x)).join(" · "));
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
  $("detail").querySelectorAll("[data-mdel]").forEach(b=>b.onclick=()=>{ const p=b.dataset.mdel.split(".");
    gridDel(id,p[0],+p[1],b.dataset.shared==="1",b.dataset.rowlabel); });
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
  else if(kind==="x"){ d.extra=d.extra||{}; const arr=d.extra[p[1]]=d.extra[p[1]]||[]; const pair=arr[+p[2]]=arr[+p[2]]||["",""]; pair[1]=value; }
  await saveDraft(row); refreshItemMeta(id);
}
async function plAdd(id){ const row=await ensureDraft(id); if(!row) return; const d=row.data=row.data||{}; (d.plans=d.plans||[]).push(["","","","",""]); await saveDraft(row); openDetail(id); }
async function plDel(id,ri){ const row=await ensureDraft(id); if(!row) return; const d=row.data||{}; (d.plans||[]).splice(ri,1); await saveDraft(row); openDetail(id); }

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
async function gridDel(id, key, ri, shared, label){
  const ids=await delScope(id, shared, label); if(!ids) return;
  for(const x of ids){
    const row=await ensureDraft(x); if(!row) continue;
    const arr=(row.data=row.data||{})[key];
    if(Array.isArray(arr) && Array.isArray(arr[ri])) arr[ri]=arr[ri].map(()=>"");
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
      const arr=d[sec.key]||[]; if(!arr.some(r=>Array.isArray(r)&&r.some(x=>x))) return;
      fullRow(sec.title, stSection);
      put(R,0,sec.rowHeader||"",stPHdr); sec.columns.forEach((c,ci)=>put(R,ci+1,c,stPHdr)); R++;
      sec.rowLabels.forEach((lbl,ri)=>{ const row=arr[ri]||[]; if(!(Array.isArray(row)&&row.some(x=>x!=null&&String(x).trim()!==""))) return;   // blank rows don't print
        put(R,0,lbl,stKey); sec.columns.forEach((c,ci)=>put(R,ci+1,row[ci]||"",stPCell)); R++; }); R++;
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
      const arr=d[sec.key]||[];
      if(arr.some(r=>Array.isArray(r)&&r.some(x=>x))){
        const body=sec.rowLabels.map((lbl,ri)=>{ const r=arr[ri]||[]; return [lbl, r[0]||"", r[1]||"", r[2]||"", r[3]||""]; })
          .filter(row=>row.slice(1).some(x=>String(x==null?"":x).trim()!==""));   // blank rows don't print
        sectionTable(sec.title, body, { cols:5, columnStyles:{0:{fontStyle:"bold",fillColor:grey,cellWidth:110}}, extra:{ head:[[
          {content:sec.title,colSpan:5,styles:{fillColor:blue,textColor:255,halign:"left",fontStyle:"bold"}}],
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
      const rowsOf=d=>sec.rowLabels.map((lbl,ri)=>{ const r=(Array.isArray(d[sec.key])?d[sec.key]:[])[ri]||[];
        return [lbl, ...sec.columns.map((c,ci)=>S(r[ci]))]; }).filter(r=>r.slice(1).some(x=>x));
      const js=cx.datas.map(d=>JSON.stringify(d[sec.key]||[]));
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
      if(JSON.stringify(dOld[sec.key]||[])!==JSON.stringify(dNew[sec.key]||[]))
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
    SCHEMA.SECTIONS.forEach(sec=>{ if(sec.kind!=="kv") return;
      sec.fields.forEach(fl=>{ if(fl.readonly) return; if(isGap(f[fl.k])) rows.push({name:it.name,id:it.id,field:sec.title+" · "+fl.label,status:(lc(f[fl.k])==="tbd"?"TBD in source":"Missing")}); });
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

/* ---------------- ADD / IMPORT (editor) ---------------- */
function renderAdd(a){
  const draftN=state.items.filter(it=>it.hasDraft).length;
  a.innerHTML=`<div class="note"><b>Import the CIS workbook (.xlsx)</b> — one community per sheet — to create/update drafts. Imported communities land as drafts; review them, then Publish (or use "Publish all drafts").</div>
    <div class="drop" id="dropXls"><b>Drop the Community Information Sheets .xlsx here</b><div class="hint">or click to browse — every community sheet becomes a draft</div><input type="file" id="fileXls" accept=".xlsx,.xlsm" hidden></div>
    <div class="note" style="margin-top:14px">Update <b>revised trench dates</b> from the New Community Checklist. The <b>Model Start</b> (current) date becomes each community's Proj. Trench Date. You'll see a preview to confirm before anything is written.</div>
    <div class="drop" id="dropChk"><b>Drop the New Community Checklist (.xlsm) here</b><div class="hint">or click to browse — preview matches before applying</div><input type="file" id="fileChk" accept=".xlsm,.xlsx" hidden></div>
    <div id="clPreview"></div>
    <div class="bar" style="margin-top:12px"><button class="btn mini ghost" id="gmBtn">Grouping migration — align Community Names…</button><span class="hint">One-off: gives each community's enclaves one shared Community Name so they cluster in the selector. Preview first; lands as drafts.</span></div>
    <div id="gmPreview"></div>
    <div class="bar" style="margin-top:12px"><button class="btn mini solid" id="pubAll">Publish all drafts (${draftN})</button><span class="hint">Makes every current draft live for viewers.</span></div>
    <div class="log" id="log"></div>`;
  const log=$("log"); const logln=(t,k)=>{ const d=document.createElement("div"); if(k)d.className=k; d.textContent=t; log.prepend(d); };
  const dropX=$("dropXls"), fileX=$("fileXls");
  dropX.onclick=()=>fileX.click();
  ["dragover","dragenter"].forEach(ev=>dropX.addEventListener(ev,e=>{e.preventDefault();dropX.classList.add("hot");}));
  ["dragleave","drop"].forEach(ev=>dropX.addEventListener(ev,e=>{e.preventDefault();dropX.classList.remove("hot");}));
  dropX.addEventListener("drop",e=>{ const f=[...(e.dataTransfer.files||[])].find(f=>/\.xls[xm]$/i.test(f.name)); if(f) importXlsx(f,logln); });
  fileX.onchange=()=>{ if(fileX.files[0]) importXlsx(fileX.files[0],logln); };
  const dropC=$("dropChk"), fileC=$("fileChk");
  dropC.onclick=()=>fileC.click();
  ["dragover","dragenter"].forEach(ev=>dropC.addEventListener(ev,e=>{e.preventDefault();dropC.classList.add("hot");}));
  ["dragleave","drop"].forEach(ev=>dropC.addEventListener(ev,e=>{e.preventDefault();dropC.classList.remove("hot");}));
  dropC.addEventListener("drop",e=>{ const f=[...(e.dataTransfer.files||[])].find(f=>/\.xls[xm]$/i.test(f.name)); if(f) importChecklist(f,logln); });
  fileC.onchange=()=>{ if(fileC.files[0]) importChecklist(fileC.files[0],logln); };
  if($("gmBtn")) $("gmBtn").onclick=()=>gmRender();
  $("pubAll").onclick=()=>publishAllDrafts(logln);
}

/* ---- trench-date update from the New Community Checklist (preview → apply) ---- */
function clDate(d){ return (d instanceof Date && !isNaN(d)) ? `${d.getMonth()+1}.${d.getDate()}.${String(d.getFullYear()%100).padStart(2,"0")}` : ""; }
function parseChecklist(wb){
  const ws=wb.Sheets["Summary"]; if(!ws) return {rows:[],unmatched:[]};
  const aoa=XLSX.utils.sheet_to_json(ws,{header:1,cellDates:true,defval:null});
  const hr=aoa.findIndex(r=>Array.isArray(r)&&r.some(c=>typeof c==="string"&&c.trim().toLowerCase()==="community"));
  if(hr<0) return {rows:[],unmatched:[]};
  const hdr=aoa[hr];
  const ciComm=hdr.findIndex(c=>typeof c==="string"&&c.trim().toLowerCase()==="community");
  const ciMs=hdr.findIndex(c=>typeof c==="string"&&c.trim().toLowerCase()==="model start"); // first exact = current
  if(ciComm<0||ciMs<0) return {rows:[],unmatched:[]};
  const list=[];
  for(let r=hr+1;r<aoa.length;r++){ const row=aoa[r]||[]; let comm=row[ciComm], ms=row[ciMs];
    if(typeof comm!=="string") continue; comm=comm.trim();
    if(!comm || /hub$/i.test(comm)) continue;
    if(!(ms instanceof Date) || ms.getFullYear()<2000) continue;   // skip blanks / 1899 epoch
    list.push({comm, date:ms});
  }
  const rows=[], unmatched=[];
  list.forEach(x=>{ const dateStr=clDate(x.date);
    const matches=state.items.filter(it=>lc(it.name).startsWith(lc(x.comm)))
      .map(it=>{ const base=it.draft||it.pub; return {id:it.id, name:it.name, cur:(base&&base.data&&base.data.f&&base.data.f.trench_date)||""}; });
    if(matches.length) rows.push({comm:x.comm, dateStr, matches}); else unmatched.push({comm:x.comm, dateStr});
  });
  return {rows,unmatched};
}
let _clPv=null, _clLog=null;
async function importChecklist(file, logln){
  if(!window.XLSX){ logln("Spreadsheet library not loaded.","err"); return; }
  logln("Reading "+file.name+"…");
  let wb; try{ wb=XLSX.read(await file.arrayBuffer(),{type:"array",cellDates:true}); }catch(e){ logln("Couldn't read: "+(e.message||e),"err"); return; }
  const pv=parseChecklist(wb); pv.unmatched.forEach(u=>u.assign=[]);
  _clPv=pv; _clLog=logln;
  renderChecklistPreview();
  logln(`Checklist parsed: ${pv.rows.length} matched, ${pv.unmatched.length} unmatched. Assign any unmatched, then Apply.`,"ok");
}
function clApplyList(){
  if(!_clPv) return [];
  // keyed by id so one CIS matched by several checklist rows yields one payload
  // (duplicate community_ids in an upsert batch fail the whole batch); last wins
  const out=new Map();
  _clPv.rows.forEach(r=>r.matches.forEach(m=>out.set(m.id,{id:m.id, dateStr:r.dateStr})));
  _clPv.unmatched.forEach(u=>(u.assign||[]).forEach(id=>out.set(id,{id, dateStr:u.dateStr})));
  return [...out.values()];
}
function renderChecklistPreview(){
  const el=$("clPreview"); if(!el||!_clPv) return; const pv=_clPv; const apply=clApplyList();
  const opts=state.items.slice().sort((a,b)=>String(a.name).localeCompare(String(b.name)))
    .map(it=>`<option value="${it.id}">${esc(it.name)}</option>`).join("");
  let h=`<div class="panel" style="margin-top:12px"><div class="sec"><span>Trench-date preview — ${apply.length} CIS to update</span>${apply.length?`<button class="btn mini solid" id="clApplyBtn">Apply to ${apply.length} CIS as drafts</button>`:""}</div>`;
  if(pv.rows.length){ h+=`<table><tr><th>Checklist community</th><th>New trench (Model Start)</th><th>CIS updated</th></tr>`+
    pv.rows.map(r=>`<tr><td>${esc(r.comm)}</td><td>${esc(r.dateStr)}</td><td>${r.matches.map(m=>`${esc(m.name)}${m.cur?` <span class="hint">(was ${esc(m.cur)})</span>`:""}`).join("<br>")}</td></tr>`).join("")+`</table>`; }
  if(pv.unmatched.length){ h+=`<div class="sec"><span>Unmatched — assign a CIS to include it (${pv.unmatched.length})</span></div>
    <table><tr><th>Checklist community</th><th>New trench</th><th>Assign to CIS</th></tr>`+
    pv.unmatched.map((u,ui)=>`<tr><td>${esc(u.comm)}</td><td>${esc(u.dateStr)}</td><td>${
      (u.assign||[]).map(id=>`<span class="pill cis" style="margin:2px 4px 2px 0">${esc((itemById(id)||{}).name||"")} <a href="#" class="unassign" data-un="${ui}|${id}">×</a></span>`).join("")
    }<select data-assign="${ui}"><option value="">+ assign CIS…</option>${opts}</select></td></tr>`).join("")+`</table>`; }
  h+=`</div>`;
  el.innerHTML=h;
  el.querySelectorAll("[data-assign]").forEach(s=>s.onchange=()=>{ const ui=+s.dataset.assign, id=s.value;
    if(id){ const u=_clPv.unmatched[ui]; u.assign=u.assign||[]; if(!u.assign.includes(id)) u.assign.push(id); renderChecklistPreview(); } });
  el.querySelectorAll(".unassign").forEach(b=>b.onclick=e=>{ e.preventDefault(); const [ui,id]=b.dataset.un.split("|");
    const u=_clPv.unmatched[+ui]; u.assign=(u.assign||[]).filter(x=>x!==id); renderChecklistPreview(); });
  if($("clApplyBtn")) $("clApplyBtn").onclick=()=>applyChecklist();
}
async function applyChecklist(){
  const list=clApplyList(); if(!list.length) return;
  if(!(await uiConfirm(`Apply revised trench dates to ${list.length} CIS as drafts? Review and Publish afterward.`,{title:"Apply trench dates",okText:"Apply"}))) return;
  const payloads=list.map(a=>{ const it=itemById(a.id); const base=it.draft||it.pub;
    const data=JSON.parse(JSON.stringify(base.data||{})); data.f=data.f||{}; data.f.trench_date=a.dateStr;
    return { community_id:it.id, division:"orlando", status:"draft", source:base.source||"CIS",
      name:base.name||null, jde:base.jde||null, project_name:base.project_name||null, hub:base.hub||null,
      active:(it.active!==false),   // an inserted draft would otherwise default true and un-hide the community on publish
      needs_review:true, data, updated_at:new Date().toISOString(), updated_by:state.email }; });
  let ok=0;
  for(let i=0;i<payloads.length;i+=80){ const batch=payloads.slice(i,i+80);
    const { error }=await sb.from("cdb_cis").upsert(batch,{onConflict:"community_id,status"});
    if(error){ if(_clLog) _clLog("Batch failed: "+error.message,"err"); } else ok+=batch.length; }
  if($("clPreview")) $("clPreview").innerHTML=`<div class="note ok" style="margin-top:12px">Updated ${ok} CIS as drafts. Use "Publish all drafts" to make them live.</div>`;
  if(_clLog) _clLog(`Applied trench dates to ${ok} CIS (drafts).`,"ok");
  _clPv=null; await loadAll(); updateCounts();
}


/* Some sheets cram elevations + New Plan into the Plan Name cell, e.g.
   "Annapolis - (30' x 65') H, J, K No", leaving the Elevations/New Plan columns
   blank. When those columns are empty, split the trailing text out. */
function splitPlanRow(a,b,c,d,e){
  const S=x=>x==null?"":String(x).trim();
  a=S(a); b=S(b); c=S(c); d=S(d); e=S(e);
  if(c || d){ return [a,b,c,d,e]; }           // already separated — leave as-is
  const paren=b.lastIndexOf(")");
  if(paren<0 || paren===b.length-1) return [a,b,c,d,e];
  const name=b.slice(0,paren+1).trim();
  let rest=b.slice(paren+1).trim();
  if(!rest) return [a,name,c,d,e];
  let elev=rest, np="";
  const m=rest.match(/\b(Yes|No)\b.*$/i);     // trailing New Plan token
  if(m){ np=rest.slice(m.index).trim(); elev=rest.slice(0,m.index).replace(/[,\s]+$/,"").trim(); }
  return [a,name,elev,np,e];
}

/* ---- xlsx import: one community per sheet ---- */
function parseSheet(aoa){
  const HDR={ "project information":"proj","floor plans":"plans","model and sales office information":"model",
    "home construction specifications":"hcs","community specific specifications":"cs","utility providers":"up",
    "notes (special circumstances)":"note","community map":"map" };
  const idx=SCHEMA.labelIndex(); const norm=SCHEMA.norm;
  const gridSec=SCHEMA.SECTIONS.find(s=>s.kind==="grid"); const gridLabels=(gridSec&&gridSec.rowLabels)||[];
  const data={ f:{}, plans:[], model:[], note:"", extra:{} }; let cur=null; const noteLines=[]; let meta="";
  for(const rrow of aoa){
    const a=(rrow[0]==null?"":String(rrow[0])).trim();
    const b=(rrow[1]==null?"":String(rrow[1])).trim();
    if(!a && !b) continue;
    if(a.indexOf("←")===0) continue;
    if(/^created by/i.test(a) || /^source:/i.test(a)){ meta=a; continue; }
    const h=HDR[a.toLowerCase()]; if(h!==undefined){ cur=h; continue; }
    if(/^plan number$/i.test(a)) continue;               // plans header row
    if(cur==="plans"){
      if(/^final plan offering/i.test(a)) continue;
      if(a||b) data.plans.push(splitPlanRow(a, b, rrow[2], rrow[3], rrow[4]));
      continue;
    }
    if(cur==="model"){
      if(/^model$/i.test(a)) continue;                   // column-header row
      const gi=gridLabels.findIndex(l=>l.toLowerCase()===a.toLowerCase());
      if(gi>=0) data.model[gi]=[b, (rrow[2]==null?"":String(rrow[2]).trim()), (rrow[3]==null?"":String(rrow[3]).trim()), (rrow[4]==null?"":String(rrow[4]).trim())];
      continue;
    }
    if(cur==="note"){ if(a) noteLines.push(a); continue; }
    if(cur==="map") continue;
    if(b!==""){ const m=idx[norm(a)]; if(m) data.f[m.key]=b; else { (data.extra[cur||"proj"]=data.extra[cur||"proj"]||[]).push([a,b]); } }
  }
  data.note=noteLines.join("\n"); if(meta) data.meta=meta;
  const I=SCHEMA.IDENTITY, f=data.f;
  return { data, name:f[I.name]||"", jde:f[I.jde]||"", project:f[I.project]||"", product:f[I.product]||"" };
}
async function importXlsx(file, logln){
  if(!window.XLSX){ logln("Spreadsheet library not loaded.","err"); return; }
  logln("Reading "+file.name+"…");
  let wb; try{ wb=XLSX.read(await file.arrayBuffer(),{type:"array"}); }catch(e){ logln("Couldn't read workbook: "+(e.message||e),"err"); return; }
  const skip=new Set(["home","to do"]);
  const byJde=new Map(), byName=new Map();
  state.items.forEach(it=>{ if(it.jde) byJde.set(String(it.jde).trim(),it.id); if(it.name) byName.set(lc(it.name),it.id); });
  // keyed by community_id: two sheets resolving to the same CIS would put duplicate
  // community_ids in one upsert batch, which fails the whole batch. Last sheet wins.
  const byCid=new Map();
  wb.SheetNames.forEach(sn=>{ if(skip.has(sn.trim().toLowerCase())) return;
    const aoa=XLSX.utils.sheet_to_json(wb.Sheets[sn],{header:1,blankrows:false,defval:null});
    if(!aoa.length) return;
    const p=parseSheet(aoa);
    const nm=p.name||String(aoa[0]&&aoa[0][0]||sn).trim();
    const cid=(p.jde&&byJde.get(String(p.jde).trim()))||(nm&&byName.get(lc(nm)))||uid();
    const prev=byCid.get(cid);
    if(prev) logln(`Duplicate community "${nm||sn}" — sheet "${prev.sheet}" dropped, "${sn}" wins.`,"warn");
    // carry an existing community's active flag: an inserted draft would otherwise
    // default to active and un-hide an inactive community the next time it publishes
    const ex=itemById(cid);
    byCid.set(cid,{ sheet:sn, payload:{
      community_id:cid, division:"orlando", status:"draft", source:"CIS",
      name:nm||sn, jde:p.jde||null, project_name:p.project||null, hub:p.product||null,
      active:(ex? ex.active!==false : true),
      needs_review:true, data:p.data, updated_at:new Date().toISOString(), updated_by:state.email } });
  });
  const payloads=[...byCid.values()].map(x=>x.payload), n=payloads.length;
  if(!payloads.length){ logln("No community sheets found.","warn"); return; }
  let ok=0;
  for(let i=0;i<payloads.length;i+=80){ const batch=payloads.slice(i,i+80);
    const { error }=await sb.from("cdb_cis").upsert(batch,{onConflict:"community_id,status"});
    if(error){ logln("Batch failed: "+error.message,"err"); } else ok+=batch.length; }
  logln(`Imported ${ok} of ${n} communities as drafts. Review, then Publish (or "Publish all drafts").`,"ok");
  await loadAll(); render();
}
async function publishAllDrafts(logln){
  const ids=state.items.filter(it=>it.hasDraft).map(it=>it.id);
  if(!ids.length){ if(logln)logln("No drafts to publish.","warn"); return; }
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
  if(logln) logln(`Published ${ok} of ${ids.length} drafts.`, ok===ids.length?"ok":"warn");
  await loadAll(); render();
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
