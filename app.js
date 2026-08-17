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

const state = { email:null, role:"viewer", mode:"view", view:"browse",
                items:[], notes:[], imgs:{}, imgUrls:{}, sel:null, q:"", showInactive:false, draftsOnly:false, users:[] };
const $  = id => document.getElementById(id);
const esc = s => String(s==null?"":s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
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
  wireChrome(); syncEditorTabs();
  await loadAll(); render();
}
// Gaps + Add/import live on the maker side only — hidden in Viewer mode.
function syncEditorTabs(){ document.querySelectorAll(".editoronly").forEach(el=>el.classList.toggle("hidden", !making())); }
function wireChrome(){
  $("logoutBtn").onclick=logout; $("themeBtn").onclick=toggleTheme;
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
  state.items=[]; state.notes=[]; state.imgs={};
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
  updateCounts();
  const a=$("viewArea");
  a.classList.remove("mob-detail");   // reset mobile detail state on any view change
  if(state.view==="browse") return renderBrowse(a);
  if(state.view==="gaps"  && making()) return renderGaps(a);
  if(state.view==="add"   && isEditor()) return renderAdd(a);
  state.view="browse"; setTab(); renderBrowse(a);
}
function updateCounts(){
  $("cBrowse").textContent = visibleItems().length;
  const g=$("cGaps"); if(g) g.textContent = making()? gapRows().length : "";
}

/* ---------------- BROWSE ---------------- */
function renderBrowse(a){
  const items=visibleItems();
  a.innerHTML = `
    <div class="bar">
      <input type="search" id="q" placeholder="Search name, JDE, plan #, or any field (e.g. H006)…" value="${esc(state.q)}">
      ${making()?`<button class="btn mini solid" id="newComm">+ New community</button>
                  <label class="hint" style="display:inline-flex;align-items:center;gap:5px"><input type="checkbox" id="draftsOnly" ${state.draftsOnly?"checked":""}> Drafts only</label>`
                :`<label class="hint" style="display:inline-flex;align-items:center;gap:5px"><input type="checkbox" id="showInactive" ${state.showInactive?"checked":""}> Show inactive</label>`}
      <span class="hint">${items.length} ${items.length===1?"community":"communities"}${making()?" · editing drafts":""}</span>
    </div>
    <div class="split" id="split">
      <div class="list" id="list">${items.map(rowHTML).join("")||`<div class="empty">No communities${state.q?" match your search":making()?" yet — add one":" published yet"}.</div>`}</div>
      <div class="panel" id="detail"><div class="empty">Select a community.</div></div>
    </div>`;
  $("q").addEventListener("input",e=>{ state.q=e.target.value; const l=$("list"); const its=visibleItems();
    l.innerHTML=its.map(rowHTML).join("")||`<div class="empty">No matches.</div>`; wireRows(); $("cBrowse").textContent=its.length; });
  const repaintList=()=>{ const l=$("list"); const its=visibleItems(); l.innerHTML=its.map(rowHTML).join("")||`<div class="empty">No matches.</div>`; wireRows(); updateCounts(); };
  if(making()){ $("newComm").onclick=newCommunity;
    if($("draftsOnly")) $("draftsOnly").onclick=e=>{ state.draftsOnly=e.target.checked; repaintList(); }; }
  else if($("showInactive")) $("showInactive").onclick=e=>{ state.showInactive=e.target.checked; repaintList(); };
  wireRows();
  if(state.sel && items.some(it=>it.id===state.sel)) openDetail(state.sel);
}
function rowHTML(it){
  const pills=[];
  if(!it.active) pills.push(`<span class="pill off">Inactive</span>`);
  if(it.source==="DECK") pills.push(`<span class="pill deck">Deck</span>`);
  if(making()){ if(it.hasDraft) pills.push(`<span class="pill draft">Draft</span>`);
    if(it.hasPub) pills.push(`<span class="pill pub">Published</span>`); }
  return `<div class="row ${state.sel===it.id?"sel":""}" data-id="${it.id}">
    <div class="nm">${esc(it.name||"(untitled)")}</div>
    <div class="mt">${it.jde?`JDE ${esc(it.jde)}`:""} ${pills.join(" ")}</div></div>`;
}
function wireRows(){ $("list")&&$("list").querySelectorAll(".row").forEach(r=>r.onclick=()=>openDetail(r.dataset.id)); }

function itemById(id){ return state.items.find(it=>it.id===id); }
function shownRow(it){ return making() ? (it.draft||it.pub) : (it.pub||it.draft); }

function openDetail(id){
  state.sel=id; const it=itemById(id); if(!it) return;
  $("list")&&$("list").querySelectorAll(".row").forEach(r=>r.classList.toggle("sel",r.dataset.id===id));
  const row=shownRow(it); const d=row?row.data||{}:{};
  const editing = making();
  const acts=[];
  if(!editing){   // exports only on the viewer side
    acts.push(`<span class="exp-wrap"><button class="btn mini ghost" id="btnExport">&#8681; Export &#9662;</button>
      <div class="exp-menu hidden" id="expMenu"><button data-exp="pdf">PDF</button><button data-exp="xlsx">Excel (.xlsx)</button></div></span>`);
  }
  if(editing){
    if(it.hasDraft){ acts.push(`<button class="btn mini solid" id="btnPublish">Publish</button>`);
      acts.push(`<button class="btn mini ghost" id="btnDiscard">Discard draft</button>`); }
    else if(it.hasPub){ acts.push(`<button class="btn mini" id="btnEdit">Edit</button>`); }
    acts.push(`<button class="btn mini ghost" id="btnActive">${it.active?"Set inactive":"Set active"}</button>`);
    if(it.hasPub) acts.push(`<button class="btn mini ghost" id="btnUnpublish">Unpublish</button>`);
    acts.push(`<button class="btn mini danger" id="btnDelete">Delete</button>`);
  }
  const inactivePill = it.active ? "" : ` <span class="pill off">Inactive</span>`;
  const statusLine = (editing
    ? (it.hasDraft?`<span class="pill draft">Editing draft</span>`:"")+(it.hasPub?` <span class="pill pub">Live version published</span>`:` <span class="pill draft">Not yet published</span>`)
    : `<span class="pill pub">Published</span>`) + inactivePill;

  const heading = (fval(d,"project_name") || (row&&row.name) || "").trim() || "(untitled)";
  let h=`<div class="ptitle"><div class="ptitle-main"><button class="mob-back" id="mobBack">&#8592; List</button>
      <div>${esc(heading)}<span class="s">${row&&row.jde?"JDE "+esc(row.jde):""} · ${statusLine}</span></div></div>
      <div class="acts">${acts.join("")}</div></div>`;

  SCHEMA.SECTIONS.forEach(sec=>{ h+=renderSection(sec, d, editing, id); });
  // images
  h+=`<div class="sec"><span>Images</span>${editing?`<button data-imgadd>Add image</button>`:""}</div>`;
  h+=imagesHTML(id, editing);
  $("detail").innerHTML=h;
  const sp=$("split"); if(sp) sp.classList.add("show-detail");        // mobile: reveal detail
  const va=$("viewArea"); if(va) va.classList.add("mob-detail");      // mobile: hide the search bar
  if($("mobBack")) $("mobBack").onclick=()=>{ const s=$("split"); if(s) s.classList.remove("show-detail"); if(va) va.classList.remove("mob-detail"); };
  wirePlanNames(id, editing);
  if($("btnExport")){
    const menu=$("expMenu");
    $("btnExport").onclick=e=>{ e.stopPropagation(); menu.classList.toggle("hidden"); };
    menu.querySelectorAll("[data-exp]").forEach(b=>b.onclick=()=>{ menu.classList.add("hidden"); if(b.dataset.exp==="pdf") exportCISpdf(id); else exportCIS(id); });
    document.addEventListener("click",()=>menu.classList.add("hidden"),{once:true});
  }
  if(editing){
    if($("btnPublish")) $("btnPublish").onclick=()=>publish(id);
    if($("btnDiscard")) $("btnDiscard").onclick=()=>discardDraft(id);
    if($("btnEdit"))    $("btnEdit").onclick=()=>startDraft(id);
    if($("btnActive")) $("btnActive").onclick=()=>setActive(id, !(itemById(id).active));
    if($("btnUnpublish")) $("btnUnpublish").onclick=()=>unpublish(id);
    if($("btnDelete"))  $("btnDelete").onclick=()=>deleteCommunity(id);
    wireEditables(id);
    const ia=$("detail").querySelector("[data-imgadd]"); if(ia) ia.onclick=()=>pickImages(id);
    $("detail").querySelectorAll("[data-capedit]").forEach(inp=>inp.onchange=()=>saveCaption(inp.dataset.capedit,inp.value));
    $("detail").querySelectorAll("[data-imgdel]").forEach(b=>b.onclick=()=>delImage(id,b.dataset.imgdel));
  }
  $("detail").querySelectorAll(".card img").forEach(im=>im.onclick=()=>{ $("lbImg").src=im.src; $("lbCap").textContent=im.dataset.cap||""; $("lightbox").classList.add("on"); });
}

/* ---------- section renderers (data model: data.f / data.plans / data.note / data.extra) ---------- */
function fval(d,k){ const v=(d.f||{})[k]; return (v==null||v==="")?"":String(v); }
function evCell(id,path,v){ // editable value span
  return `<span class="ev" data-ev="${esc(path)}" data-id="${id}">${v?esc(v):'<span class="none">—</span>'}</span>`;
}
function renderSection(sec, d, editing, id){
  if(sec.kind==="kv"){
    let rows=sec.fields.map(f=>{ const v=fval(d,f.k); if(!v && (!editing || f.readonly)) return "";
      const disp = (editing && !f.readonly) ? evCell(id,"f."+f.k,v)
                 : (f.readonly ? `${esc(v)||'<span class="none">—</span>'}<span class="autotag">auto</span>` : esc(v));
      return `<tr><td class="k">${esc(f.label)}</td><td class="v">${disp||'<span class="none">—</span>'}</td></tr>`; }).join("");
    const ex=(d.extra&&d.extra[sec.id])||[];
    ex.forEach((pair,xi)=>{ const v=pair[1]||""; rows+=`<tr><td class="k">${esc(pair[0])}</td><td class="v">${editing?evCell(id,"x."+sec.id+"."+xi,v):esc(v)}</td></tr>`; });
    if(!rows && !editing) return "";
    return `<div class="sec"><span>${esc(sec.title)}</span></div><table>${rows}</table>`;
  }
  if(sec.kind==="plans"){
    const arr=Array.isArray(d.plans)?d.plans:[]; const cols=SCHEMA.PLAN_COLS;
    if(!arr.length && !editing) return "";
    let head=`<tr>${cols.map(c=>`<th class="nowrap">${esc(c)}</th>`).join("")}${editing?"<th></th>":""}</tr>`;
    const cell=(ri,ci,raw)=>{ const v=raw||"";
      if(ci===1){ // Plan Name / footprint: truncated label, click opens a popup (view or edit)
        return `<td class="v"><span class="plname" data-planopen="${ri}" data-full="${esc(v)}">${v?esc(v):'<span class="none">—</span>'}</span></td>`; }
      return `<td class="v">${editing?evCell(id,`p.${ri}.${ci}`,v):esc(v)}</td>`; };
    let body=arr.map((r,ri)=>`<tr>${cols.map((c,ci)=>cell(ri,ci,r[ci])).join("")}${editing?`<td><button class="rowdel" data-pldel="${ri}">×</button></td>`:""}</tr>`).join("");
    return `<div class="sec"><span>${esc(sec.title)}</span>${editing?`<button data-pladd="1">Add row</button>`:""}</div><div class="tscroll"><table class="plans-t">${head}${body}</table></div>`;
  }
  if(sec.kind==="grid"){
    const arr=Array.isArray(d[sec.key])?d[sec.key]:[];
    const anyVal=arr.some(r=>Array.isArray(r)&&r.some(x=>x!=null&&x!==""));
    if(!anyVal && !editing) return "";
    let head=`<tr><th class="nowrap">${esc(sec.rowHeader||"")}</th>${sec.columns.map(c=>`<th class="nowrap">${esc(c)}</th>`).join("")}</tr>`;
    let body=sec.rowLabels.map((lbl,ri)=>{ const row=arr[ri]||[];
      return `<tr><td class="k">${esc(lbl)}</td>${sec.columns.map((c,ci)=>`<td class="v">${editing?evCell(id,`m.${ri}.${ci}`,row[ci]||""):esc(row[ci]||"")}</td>`).join("")}</tr>`; }).join("");
    return `<div class="sec"><span>${esc(sec.title)}</span></div><div class="tscroll"><table class="plans-t model-t">${head}${body}</table></div>`;
  }
  if(sec.kind==="note"){
    const t=(d.note==null?"":String(d.note));
    if(!editing && !t) return "";
    return `<div class="sec"><span>${esc(sec.title)}</span></div><table><tr><td class="v">${editing?evCell(id,"note",t):(esc(t)||'<span class="none">—</span>')}</td></tr></table>`;
  }
  return "";
}

/* ---------- inline editing (maker) ---------- */
function wireEditables(id){
  $("detail").querySelectorAll(".ev").forEach(sp=>sp.onclick=()=>beginEdit(sp,id));
  const add=$("detail").querySelector("[data-pladd]"); if(add) add.onclick=()=>plAdd(id);
  $("detail").querySelectorAll("[data-pldel]").forEach(b=>b.onclick=()=>plDel(id,+b.dataset.pldel));
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
function beginEdit(sp,id){
  const path=sp.dataset.ev; const cur=getPath(id,path);
  const p=path.split("."); if(p[0]==="f" && DATE_KEYS[p[1]]) return beginDateEdit(sp,id,path,cur);
  const long=(path==="note");
  const inp=document.createElement(long?"textarea":"input"); inp.className="ed-in"; inp.value=cur||"";
  sp.replaceWith(inp); inp.focus();
  const done=async(save)=>{ if(save){ await setPath(id,path,inp.value); } openDetail(id); };
  inp.addEventListener("keydown",e=>{ if(e.key==="Enter"&&!long){ e.preventDefault(); done(true);} else if(e.key==="Escape") done(false); });
  inp.addEventListener("blur",()=>done(true));
}
// Date fields: one text box (free typing, incl. "TBD") with a calendar button in
// the corner that opens a native picker. Always saved as M.D.YY.
function beginDateEdit(sp,id,path,cur){
  const wrap=document.createElement("span"); wrap.className="ev-date";
  const txt=document.createElement("input"); txt.type="text"; txt.className="ed-in"; txt.value=cur||""; txt.placeholder="M.D.YY or TBD";
  const btn=document.createElement("button"); btn.type="button"; btn.className="ed-calbtn"; btn.title="Pick a date";
  btn.innerHTML='<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M3 9h18M8 2.5v4M16 2.5v4"/></svg>';
  const cal=document.createElement("input"); cal.type="date"; cal.className="ed-calhidden"; const iso=dateToISO(cur); if(iso) cal.value=iso;
  wrap.appendChild(txt); wrap.appendChild(btn); wrap.appendChild(cal);
  sp.replaceWith(wrap); txt.focus(); txt.select();
  let done=false;
  const finish=async(save)=>{ if(done) return; done=true; if(save){ await setPath(id,path,txt.value); } openDetail(id); };
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
  const row=await ensureDraft(id); const d=row.data=row.data||{}; d.f=d.f||{};
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
async function plAdd(id){ const row=await ensureDraft(id); const d=row.data=row.data||{}; (d.plans=d.plans||[]).push(["","","","",""]); await saveDraft(row); openDetail(id); }
async function plDel(id,ri){ const row=await ensureDraft(id); const d=row.data||{}; (d.plans||[]).splice(ri,1); await saveDraft(row); openDetail(id); }

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
      sec.rowLabels.forEach((lbl,ri)=>{ const row=arr[ri]||[]; put(R,0,lbl,stKey); sec.columns.forEach((c,ci)=>put(R,ci+1,row[ci]||"",stPCell)); R++; }); R++;
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

/* ---------- export a CIS to PDF (jsPDF + autotable) ---------- */
function exportCISpdf(id){
  const jsPDF=(window.jspdf&&window.jspdf.jsPDF)||window.jsPDF;
  const it=itemById(id); const row=shownRow(it); if(!row) return;
  if(!jsPDF){ uiAlert("PDF library didn't load — refresh and try again.","Export"); return; }
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
        const body=sec.rowLabels.map((lbl,ri)=>{ const r=arr[ri]||[]; return [lbl, r[0]||"", r[1]||"", r[2]||"", r[3]||""]; });
        sectionTable(sec.title, body, { cols:5, columnStyles:{0:{fontStyle:"bold",fillColor:grey,cellWidth:110}}, extra:{ head:[[
          {content:sec.title,colSpan:5,styles:{fillColor:blue,textColor:255,halign:"left",fontStyle:"bold"}}],
          [{content:sec.rowHeader||"",styles:{fillColor:grey,textColor:[66,83,110],fontStyle:"bold"}}, ...sec.columns.map(c=>({content:c,styles:{fillColor:grey,textColor:[66,83,110],fontStyle:"bold"}}))]]}});
      }
    } else if(sec.kind==="note"){
      const t=d.note==null?"":String(d.note); if(t) sectionTable(sec.title, [[t]], {cols:1, columnStyles:{0:{cellWidth:"auto"}}});
    }
  });
  doc.save(`CIS_${(row.name||"CIS").replace(/[^\w\-]+/g,"_").slice(0,40)}_${new Date().toISOString().slice(0,10)}.pdf`);
}

/* ---------- draft / publish ---------- */
async function ensureDraft(id){
  const it=itemById(id); if(it&&it.draft) return it.draft;
  if(it&&it.hasPub){ // clone published → draft via RPC, then reload
    await sb.rpc("cdb_start_draft",{p_community_id:id}); await loadAll();
    return itemById(id).draft;
  }
  return it.draft;
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
  const l=$("list"); if(l){ const r=l.querySelector(`.row[data-id="${id}"] .nm`); if(r) r.textContent=it.name||"(untitled)"; } }
async function newCommunity(){
  const name=await uiPrompt("Community name",{title:"New community",okText:"Create",placeholder:"e.g. Bronson's Ridge"});
  if(name==null||!name.trim()) return;
  const row={ community_id:uid(), status:"draft", source:"manual", name:name.trim(),
    data:{ f:{ [SCHEMA.IDENTITY.name]:name.trim() }, plans:[], model:[], note:"", extra:{} } };
  await saveDraft(row); await loadAll(); render(); openDetail(row.community_id);
}
async function startDraft(id){ await ensureDraft(id); await loadAll(); render(); openDetail(id); }
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
  state.sel=null; await loadAll(); render();
}
async function publish(id){
  if(!(await uiConfirm("Publish this draft? It becomes the live version for all viewers.",{title:"Publish community",okText:"Publish"}))) return;
  const { data,error } = await sb.rpc("cdb_publish",{p_community_id:id});
  if(error||(data&&!data.ok)){ uiAlert("Publish failed: "+((error&&error.message)||(data&&data.error)),"Publish failed"); return; }
  await loadAll(); render(); openDetail(id);
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
  for(const f of files){
    try{
      const { blob,w,h } = await downscale(f);
      const path=`${id}/${uid()}.jpg`;
      const { error } = await sb.storage.from(CFG.IMAGE_BUCKET).upload(path, blob, { contentType:"image/jpeg", upsert:false });
      if(error) throw error;
      const rec={ id:uid(), community_id:id, path, caption:f.name.replace(/\.[^.]+$/,""), sort_order:(state.imgs[id]||[]).length, published:false, w, h, created_by:state.email };
      const { error:e2 } = await sb.from("cdb_images").insert(rec); if(e2) throw e2;
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
  const out=[];
  if(!_clPv) return out;
  _clPv.rows.forEach(r=>r.matches.forEach(m=>out.push({id:m.id, dateStr:r.dateStr})));
  _clPv.unmatched.forEach(u=>(u.assign||[]).forEach(id=>out.push({id, dateStr:u.dateStr})));
  return out;
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
      needs_review:true, data, updated_at:new Date().toISOString(), updated_by:state.email }; });
  let ok=0;
  for(let i=0;i<payloads.length;i+=80){ const batch=payloads.slice(i,i+80);
    const { error }=await sb.from("cdb_cis").upsert(batch,{onConflict:"community_id,status"}); if(!error) ok+=batch.length; }
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
  const payloads=[]; let n=0;
  wb.SheetNames.forEach(sn=>{ if(skip.has(sn.trim().toLowerCase())) return;
    const aoa=XLSX.utils.sheet_to_json(wb.Sheets[sn],{header:1,blankrows:false,defval:null});
    if(!aoa.length) return;
    const p=parseSheet(aoa);
    const nm=p.name||String(aoa[0]&&aoa[0][0]||sn).trim();
    const cid=(p.jde&&byJde.get(String(p.jde).trim()))||(nm&&byName.get(lc(nm)))||uid();
    payloads.push({ community_id:cid, division:"orlando", status:"draft", source:"CIS",
      name:nm||sn, jde:p.jde||null, project_name:p.project||null, hub:p.product||null,
      needs_review:true, data:p.data, updated_at:new Date().toISOString(), updated_by:state.email });
    n++;
  });
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
  let ok=0;
  for(const id of ids){ const { data,error }=await sb.rpc("cdb_publish",{p_community_id:id}); if(!error&&data&&data.ok) ok++; }
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
    $("ruCopy").onclick=()=>{ $("ruLink").select(); document.execCommand("copy"); $("ruCopy").textContent="Copied"; };
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
