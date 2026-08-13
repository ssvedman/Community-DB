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
if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

const state = { email:null, role:"viewer", mode:"view", view:"browse",
                items:[], notes:[], imgs:{}, imgUrls:{}, sel:null, q:"" };
const $  = id => document.getElementById(id);
const esc = s => String(s==null?"":s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const lc = s => String(s==null?"":s).toLowerCase();
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : "id"+Date.now()+Math.random().toString(16).slice(2));
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
async function logout(){ if(!DEMO&&sb) await sb.auth.signOut(); location.reload(); }

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
  document.querySelectorAll(".editoronly").forEach(el=>el.classList.toggle("hidden", !isEditor()));
  wireChrome();
  await loadAll(); render();
}
function wireChrome(){
  $("logoutBtn").onclick=logout; $("themeBtn").onclick=toggleTheme;
  $("homeLogo").onclick=()=>{ showDash(); state.view="browse"; setTab(); render(); };
  $("adminLink").onclick=showAdmin; $("dashLink").onclick=()=>{ showDash(); render(); };
  $("modeToggle").querySelectorAll(".mode").forEach(b=>b.onclick=()=>{
    state.mode=b.dataset.mode; $("modeToggle").querySelectorAll(".mode").forEach(x=>x.classList.toggle("on",x===b));
    if(state.mode==="view" && (state.view==="gaps"||state.view==="add")){ state.view="browse"; setTab(); }
    render();
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
      return { id:e.community_id, pub:e.pub, draft:e.draft, primary,
        name:(primary&&primary.name)||"", jde:(primary&&primary.jde)||"",
        hub:(primary&&primary.hub)||"", source:(primary&&primary.source)||"manual",
        hasPub:!!e.pub, hasDraft:!!e.draft };
    }).filter(it=> it.pub || it.draft ).sort((a,b)=>String(a.name).localeCompare(String(b.name)));

    const { data:notes } = await sb.from("cdb_notes").select("*").order("note_date",{ascending:false});
    state.notes = notes||[];

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
function visibleItems(){
  // viewer: only published; maker: everything
  let list = making() ? state.items : state.items.filter(it=>it.hasPub);
  const q=lc(state.q);
  if(q) list=list.filter(it=>lc(it.name).includes(q)||lc(it.jde).includes(q));
  return list;
}

/* ---------------- RENDER ROUTER ---------------- */
function render(){
  updateCounts();
  const a=$("viewArea");
  if(state.view==="browse") return renderBrowse(a);
  if(state.view==="notes")  return renderNotes(a);
  if(state.view==="about")  return renderAbout(a);
  if(state.view==="gaps"  && isEditor()) return renderGaps(a);
  if(state.view==="add"   && isEditor()) return renderAdd(a);
  state.view="browse"; setTab(); renderBrowse(a);
}
function updateCounts(){
  $("cBrowse").textContent = visibleItems().length;
  $("cNotes").textContent = state.notes.length;
  const g=$("cGaps"); if(g) g.textContent = isEditor()? gapRows().length : "";
}

/* ---------------- BROWSE ---------------- */
function renderBrowse(a){
  const items=visibleItems();
  a.innerHTML = `
    <div class="bar">
      <input type="search" id="q" placeholder="Search community name or JDE number…" value="${esc(state.q)}">
      ${making()?`<button class="btn mini solid" id="newComm">+ New community</button>`:""}
      <span class="hint">${items.length} ${items.length===1?"community":"communities"}${making()?" · editing drafts":""}</span>
    </div>
    <div class="split">
      <div class="list" id="list">${items.map(rowHTML).join("")||`<div class="empty">No communities${state.q?" match your search":making()?" yet — add one":" published yet"}.</div>`}</div>
      <div class="panel" id="detail"><div class="empty">Select a community.</div></div>
    </div>`;
  $("q").addEventListener("input",e=>{ state.q=e.target.value; const l=$("list"); const its=visibleItems();
    l.innerHTML=its.map(rowHTML).join("")||`<div class="empty">No matches.</div>`; wireRows(); $("cBrowse").textContent=its.length; });
  if(making()) $("newComm").onclick=newCommunity;
  wireRows();
  if(state.sel && items.some(it=>it.id===state.sel)) openDetail(state.sel);
}
function rowHTML(it){
  const pills=[];
  if(it.source==="DECK") pills.push(`<span class="pill deck">Deck</span>`);
  else if(it.source==="CIS") pills.push(`<span class="pill cis">CIS</span>`);
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
  acts.push(`<button class="btn mini ghost" id="btnExport">&#8681; .xlsx</button>`);
  acts.push(`<button class="btn mini ghost" id="btnExportPdf">&#8681; PDF</button>`);
  if(editing){
    if(it.hasDraft){ acts.push(`<button class="btn mini solid" id="btnPublish">Publish</button>`);
      acts.push(`<button class="btn mini ghost" id="btnDiscard">Discard draft</button>`); }
    else if(it.hasPub){ acts.push(`<button class="btn mini" id="btnEdit">Edit</button>`); }
    if(it.hasPub) acts.push(`<button class="btn mini ghost" id="btnUnpublish">Unpublish</button>`);
    acts.push(`<button class="btn mini danger" id="btnDelete">Delete</button>`);
  }
  const statusLine = editing
    ? (it.hasDraft?`<span class="pill draft">Editing draft</span>`:"")+(it.hasPub?` <span class="pill pub">Live version published</span>`:` <span class="pill draft">Not yet published</span>`)
    : `<span class="pill pub">Published</span>`;

  let h=`<div class="ptitle"><div>${esc(row?row.name:"")||"(untitled)"}
      <span class="s">${row&&row.jde?"JDE "+esc(row.jde):""} · ${statusLine}</span></div>
      <div class="acts">${acts.join("")}</div></div>`;

  SCHEMA.SECTIONS.forEach(sec=>{ h+=renderSection(sec, d, editing, id); });
  // images
  h+=`<div class="sec"><span>Images</span>${editing?`<button data-imgadd>Add image</button>`:""}</div>`;
  h+=imagesHTML(id, editing);
  // tagged notes
  const tn=state.notes.filter(n=>n.community_id===id);
  if(tn.length){ h+=`<div class="sec"><span>Meeting notes</span></div><table>`+
    tn.map(n=>`<tr><td class="k">${esc(n.note_date||"")}<div class="hint">${esc(n.subject||"")}</div></td><td class="v">${esc(n.body||"")}${n.attendees?`<div class="hint">Attendees: ${esc(n.attendees)}</div>`:""}</td></tr>`).join("")+`</table>`; }

  $("detail").innerHTML=h;
  if($("btnExport")) $("btnExport").onclick=()=>exportCIS(id);
  if($("btnExportPdf")) $("btnExportPdf").onclick=()=>exportCISpdf(id);
  if(editing){
    if($("btnPublish")) $("btnPublish").onclick=()=>publish(id);
    if($("btnDiscard")) $("btnDiscard").onclick=()=>discardDraft(id);
    if($("btnEdit"))    $("btnEdit").onclick=()=>startDraft(id);
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
    let rows=sec.fields.map(f=>{ const v=fval(d,f.k); if(!editing && !v) return "";
      const disp = editing ? evCell(id,"f."+f.k,v) : esc(v);
      return `<tr><td class="k">${esc(f.label)}</td><td class="v">${disp||'<span class="none">—</span>'}</td></tr>`; }).join("");
    const ex=(d.extra&&d.extra[sec.id])||[];
    ex.forEach((pair,xi)=>{ const v=pair[1]||""; rows+=`<tr><td class="k">${esc(pair[0])}</td><td class="v">${editing?evCell(id,"x."+sec.id+"."+xi,v):esc(v)}</td></tr>`; });
    if(!rows && !editing) return "";
    return `<div class="sec"><span>${esc(sec.title)}</span></div><table>${rows}</table>`;
  }
  if(sec.kind==="plans"){
    const arr=Array.isArray(d.plans)?d.plans:[]; const cols=SCHEMA.PLAN_COLS;
    if(!arr.length && !editing) return "";
    let head=`<tr>${cols.map(c=>`<th>${esc(c)}</th>`).join("")}${editing?"<th></th>":""}</tr>`;
    let body=arr.map((r,ri)=>`<tr>${cols.map((c,ci)=>`<td class="v">${editing?evCell(id,`p.${ri}.${ci}`,r[ci]||""):esc(r[ci]||"")}</td>`).join("")}${editing?`<td><button class="rowdel" data-pldel="${ri}">×</button></td>`:""}</tr>`).join("");
    return `<div class="sec"><span>${esc(sec.title)}</span>${editing?`<button data-pladd="1">Add row</button>`:""}</div><table>${head}${body}</table>`;
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
function beginEdit(sp,id){
  const path=sp.dataset.ev; const cur=getPath(id,path);
  const long=(path==="note");
  const inp=document.createElement(long?"textarea":"input"); inp.className="ed-in"; inp.value=cur||"";
  sp.replaceWith(inp); inp.focus();
  const done=async(save)=>{ if(save){ await setPath(id,path,inp.value); } openDetail(id); };
  inp.addEventListener("keydown",e=>{ if(e.key==="Enter"&&!long){ e.preventDefault(); done(true);} else if(e.key==="Escape") done(false); });
  inp.addEventListener("blur",()=>done(true));
}
function getPath(id,path){ const it=itemById(id); const row=it.draft||it.pub; const d=(row&&row.data)||{};
  const p=path.split("."); const kind=p[0];
  if(kind==="f") return (d.f||{})[p[1]];
  if(kind==="note") return d.note||"";
  if(kind==="p"){ const r=(d.plans||[])[+p[1]]||[]; return r[+p[2]]; }
  if(kind==="x"){ const arr=(d.extra||{})[p[1]]||[]; const pair=arr[+p[2]]||[]; return pair[1]; }
  return "";
}
async function setPath(id,path,value){
  const row=await ensureDraft(id); const d=row.data=row.data||{}; d.f=d.f||{};
  const p=path.split("."); const kind=p[0];
  if(kind==="f"){ d.f[p[1]]=value;
    const I=SCHEMA.IDENTITY;
    if(p[1]===I.name) row.name=value; if(p[1]===I.jde) row.jde=value;
    if(p[1]===I.project) row.project_name=value; if(p[1]===I.product) row.hub=value;
  }
  else if(kind==="note") d.note=value;
  else if(kind==="p"){ d.plans=d.plans||[]; const r=d.plans[+p[1]]=d.plans[+p[1]]||["","","","",""]; r[+p[2]]=value; }
  else if(kind==="x"){ d.extra=d.extra||{}; const arr=d.extra[p[1]]=d.extra[p[1]]||[]; const pair=arr[+p[2]]=arr[+p[2]]||["",""]; pair[1]=value; }
  await saveDraft(row); refreshItemMeta(id);
}
async function plAdd(id){ const row=await ensureDraft(id); const d=row.data=row.data||{}; (d.plans=d.plans||[]).push(["","","","",""]); await saveDraft(row); openDetail(id); }
async function plDel(id,ri){ const row=await ensureDraft(id); const d=row.data||{}; (d.plans||[]).splice(ri,1); await saveDraft(row); openDetail(id); }

/* ---------- export a CIS to .xlsx (mirrors the workbook layout) ---------- */
function cisAOA(row){
  const d=row.data||{}; const aoa=[]; aoa.push([row.name||"(untitled)"]);
  SCHEMA.SECTIONS.forEach(sec=>{
    aoa.push([]); aoa.push([sec.title]);
    if(sec.kind==="kv"){ sec.fields.forEach(f=> aoa.push([f.label, fval(d,f.k)]));
      ((d.extra&&d.extra[sec.id])||[]).forEach(pr=> aoa.push([pr[0], pr[1]||""])); }
    else if(sec.kind==="plans"){ aoa.push(SCHEMA.PLAN_COLS.slice());
      (d.plans||[]).forEach(r=> aoa.push(SCHEMA.PLAN_COLS.map((c,ci)=>r[ci]||""))); }
    else if(sec.kind==="note"){ aoa.push([d.note==null?"":String(d.note)]); }
  });
  if(d.meta){ aoa.push([]); aoa.push([String(d.meta)]); }
  return aoa;
}
function exportCIS(id){
  if(!window.XLSX){ uiAlert("Spreadsheet library didn't load — refresh and try again.","Export"); return; }
  const it=itemById(id); const row=shownRow(it); if(!row) return;
  const ws=XLSX.utils.aoa_to_sheet(cisAOA(row));
  ws["!cols"]=[{wch:34},{wch:66},{wch:22},{wch:16},{wch:24}];
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
            SCHEMA.PLAN_COLS.map(c=>({content:c,styles:{fillColor:grey,fontStyle:"bold"}}))]}});
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
    data:{ f:{ [SCHEMA.IDENTITY.name]:name.trim() }, plans:[], note:"", extra:{} } };
  await saveDraft(row); await loadAll(); render(); openDetail(row.community_id);
}
async function startDraft(id){ await ensureDraft(id); await loadAll(); render(); openDetail(id); }
async function discardDraft(id){
  if(!(await uiConfirm("Discard this draft? The published version stays live.",{title:"Discard draft",okText:"Discard",danger:true}))) return;
  await sb.from("cdb_cis").delete().eq("community_id",id).eq("status","draft"); await loadAll(); render();
  const still=itemById(id); if(still) openDetail(id); }
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

/* ---------------- NOTES ---------------- */
function renderNotes(a){
  const canAdd=isEditor();
  const opts=state.items.map(it=>`<option value="${it.id}">${esc(it.name||it.jde||"—")}</option>`).join("");
  a.innerHTML=`
    ${canAdd?`<div class="panel" style="margin-bottom:16px"><div class="sec"><span>New meeting note</span></div><table>
      <tr><td class="k">Date</td><td class="v"><input type="date" id="nDate"></td></tr>
      <tr><td class="k">Subject</td><td class="v"><input type="text" id="nTitle" placeholder="e.g. CIS review, panel updates" style="width:100%;max-width:520px"></td></tr>
      <tr><td class="k">Community <span class="hint">(optional)</span></td><td class="v"><select id="nComm" style="max-width:520px"><option value="">— none —</option>${opts}</select></td></tr>
      <tr><td class="k">Attendees <span class="hint">(optional)</span></td><td class="v"><input type="text" id="nWho" style="width:100%;max-width:520px"></td></tr>
      <tr><td class="k">Notes</td><td class="v"><textarea id="nBody" class="ed-in" placeholder="What was decided, what changed, follow-ups…"></textarea></td></tr>
      <tr><td class="k"></td><td class="v"><button class="btn mini solid" id="nAdd">Save note</button> <span class="hint" id="nMsg"></span></td></tr>
    </table></div>`:""}
    <div class="bar"><input type="search" id="nq" placeholder="Search notes…"><select id="nFilter"><option value="">All communities</option>${opts}</select></div>
    <div class="panel"><div id="noteList"></div></div>`;
  const nameOf=id=>{ const it=itemById(id); return it?(it.name||it.jde||"—"):""; };
  const paint=()=>{ const q=lc($("nq").value), f=$("nFilter").value;
    let ns=state.notes.filter(n=>(!f||n.community_id===f)&&(!q||[n.subject,n.body,n.attendees,nameOf(n.community_id),n.note_date].some(x=>lc(x).includes(q))));
    $("noteList").innerHTML= ns.length? `<table>`+ns.map(n=>`<tr><td class="k">${esc(n.note_date||"")}<div class="hint">${esc(n.subject||"")}</div>${n.community_id?`<div class="pill cis" style="margin-top:4px">${esc(nameOf(n.community_id))}</div>`:""}</td><td class="v">${esc(n.body||"")}${n.attendees?`<div class="hint">Attendees: ${esc(n.attendees)}</div>`:""}${isEditor()?`<div><button class="rowdel" data-ndel="${n.id}">Delete</button></div>`:""}</td></tr>`).join("")+`</table>` : `<div class="empty">No notes.</div>`;
    $("noteList").querySelectorAll("[data-ndel]").forEach(b=>b.onclick=async()=>{ if(await uiConfirm("Delete this note?",{title:"Delete note",okText:"Delete",danger:true})){ await sb.from("cdb_notes").delete().eq("id",b.dataset.ndel); await loadAll(); paint(); updateCounts(); } });
  };
  $("nq").addEventListener("input",paint); $("nFilter").addEventListener("change",paint); paint();
  if(canAdd) $("nAdd").onclick=async()=>{
    const rec={ id:uid(), division:"orlando", note_date:$("nDate").value||null, subject:$("nTitle").value.trim()||null,
      community_id:$("nComm").value||null, attendees:$("nWho").value.trim()||null, body:$("nBody").value.trim()||null, created_by:state.email };
    if(!rec.body){ $("nMsg").textContent="Add some note text."; return; }
    const { error }=await sb.from("cdb_notes").insert(rec);
    if(error){ $("nMsg").textContent="Save failed: "+error.message; return; }
    $("nBody").value=""; $("nTitle").value=""; $("nWho").value=""; $("nMsg").textContent="Saved.";
    await loadAll(); paint(); updateCounts();
  };
}

/* ---------------- GAPS (editor) ---------------- */
function isGap(v){ const s=lc(v).trim(); return !s || s==="tbd" || s==="tbd in source"; }
function gapRows(){
  const rows=[];
  state.items.forEach(it=>{ const row=it.draft||it.pub; if(!row) return; const d=row.data||{}; const f=d.f||{};
    SCHEMA.SECTIONS.forEach(sec=>{ if(sec.kind!=="kv") return;
      sec.fields.forEach(fl=>{ if(isGap(f[fl.k])) rows.push({name:it.name,id:it.id,field:sec.title+" · "+fl.label,status:(lc(f[fl.k])==="tbd"?"TBD in source":"Missing")}); });
    });
  });
  return rows;
}
function renderGaps(a){
  a.innerHTML=`<div class="note"><b>Gaps</b> are CIS fields that are still empty or marked TBD. Fill them in on a community's page and they clear here.</div>
    <div class="bar"><input type="search" id="gq" placeholder="Filter by community or field…"><select id="gStatus"><option value="">All statuses</option><option>Missing</option><option>TBD in source</option></select><span class="hint" id="gShown"></span></div>
    <div class="panel"><div id="gapsTable"></div></div>`;
  const paint=()=>{ const q=lc($("gq").value), st=$("gStatus").value;
    let rs=gapRows().filter(r=>(!st||r.status===st)&&(!q||lc(r.name).includes(q)||lc(r.field).includes(q)));
    $("gShown").textContent=`${rs.length} gaps`;
    $("gapsTable").innerHTML= rs.length? `<table><tr><th>Community</th><th>Field</th><th>Status</th></tr>`+rs.map(r=>`<tr><td><a href="#" data-goto="${r.id}">${esc(r.name)}</a></td><td>${esc(r.field)}</td><td>${esc(r.status)}</td></tr>`).join("")+`</table>`:`<div class="empty">No gaps 🎉</div>`;
    $("gapsTable").querySelectorAll("[data-goto]").forEach(a2=>a2.onclick=e=>{ e.preventDefault(); state.view="browse"; setTab(); state.sel=a2.dataset.goto; render(); openDetail(a2.dataset.goto); });
  };
  $("gq").addEventListener("input",paint); $("gStatus").addEventListener("change",paint); paint();
}

/* ---------------- ADD / IMPORT (editor) ---------------- */
function renderAdd(a){
  const draftN=state.items.filter(it=>it.hasDraft).length;
  a.innerHTML=`<div class="note"><b>Import the CIS workbook (.xlsx)</b> — one community per sheet — to create/update drafts, or drop CIS <b>PDF(s)</b> for best-effort extraction. Imported communities land as drafts; review them, then Publish (or use "Publish all drafts").</div>
    <div class="drop" id="dropXls"><b>Drop the Community Information Sheets .xlsx here</b><div class="hint">or click to browse — every community sheet becomes a draft</div><input type="file" id="fileXls" accept=".xlsx,.xlsm" hidden></div>
    <div class="drop" id="drop" style="margin-top:10px"><b>Drop CIS PDF(s) here</b><div class="hint">or click to browse (best-effort)</div><input type="file" id="file" accept="application/pdf" multiple hidden></div>
    <div class="bar" style="margin-top:12px"><button class="btn mini solid" id="pubAll">Publish all drafts (${draftN})</button><span class="hint">Makes every current draft live for viewers.</span></div>
    <div class="log" id="log"></div>`;
  const log=$("log"); const logln=(t,k)=>{ const d=document.createElement("div"); if(k)d.className=k; d.textContent=t; log.prepend(d); };
  const dropX=$("dropXls"), fileX=$("fileXls");
  dropX.onclick=()=>fileX.click();
  ["dragover","dragenter"].forEach(ev=>dropX.addEventListener(ev,e=>{e.preventDefault();dropX.classList.add("hot");}));
  ["dragleave","drop"].forEach(ev=>dropX.addEventListener(ev,e=>{e.preventDefault();dropX.classList.remove("hot");}));
  dropX.addEventListener("drop",e=>{ const f=[...(e.dataTransfer.files||[])].find(f=>/\.xls[xm]$/i.test(f.name)); if(f) importXlsx(f,logln); });
  fileX.onchange=()=>{ if(fileX.files[0]) importXlsx(fileX.files[0],logln); };
  const drop=$("drop"), file=$("file");
  drop.onclick=()=>file.click();
  ["dragover","dragenter"].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.add("hot");}));
  ["dragleave","drop"].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.remove("hot");}));
  drop.addEventListener("drop",e=>{ const fs=[...(e.dataTransfer.files||[])].filter(f=>/\.pdf$/i.test(f.name)); if(fs.length) importPdfs(fs,logln); });
  file.onchange=()=>{ if(file.files.length) importPdfs([...file.files],logln); };
  $("pubAll").onclick=()=>publishAllDrafts(logln);
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
  const HDR={ "project information":"proj","floor plans":"plans","home construction specifications":"hcs",
    "community specific specifications":"cs","utility providers":"up","notes (special circumstances)":"note","community map":"map" };
  const idx=SCHEMA.labelIndex(); const norm=SCHEMA.norm;
  const data={ f:{}, plans:[], note:"", extra:{} }; let cur=null; const noteLines=[]; let meta="";
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

/* ---- PDF import (best-effort) → new data model ---- */
async function importPdfs(files, logln){
  if(!window.pdfjsLib){ logln("PDF library not loaded.","err"); return; }
  for(const f of files){
    logln("Reading "+f.name+"…");
    try{
      const pdf=await pdfjsLib.getDocument({data:await f.arrayBuffer()}).promise;
      let text=""; for(let p=1;p<=pdf.numPages;p++){ const pg=await pdf.getPage(p); const c=await pg.getTextContent(); text+=c.items.map(i=>i.str).join(" ")+"\n"; }
      const F=extractCISfields(text);
      const data={ f:F, plans:[], note:"", extra:{} };
      const I=SCHEMA.IDENTITY;
      const row={ community_id:uid(), status:"draft", source:"CIS", name:F[I.name]||f.name.replace(/\.pdf$/i,""),
        jde:F[I.jde]||null, project_name:F[I.project]||null, hub:F[I.product]||null, needs_review:true, data };
      await saveDraft(row);
      logln("Draft created: "+(row.name||f.name)+" — review before publishing.","ok");
    }catch(e){ logln("Failed on "+f.name+": "+(e.message||e),"err"); }
  }
  await loadAll(); render();
}
function extractCISfields(text){
  const f={}; const grab=(re)=>{ const m=text.match(re); return m?m[1].trim().replace(/\s{2,}/g," "):""; };
  const set=(k,v)=>{ if(v) f[k]=v; };
  set("community_name", grab(/Community Name[:\s]+([^\n]+?)(?:JDE|Project|Division|$)/i));
  set("project_name",  grab(/Project Name[:\s]+([^\n]+?)(?:JDE|Community|Division|$)/i));
  set("jde",           grab(/JDE(?:\s*Community)?\s*#?[:\s]+(\d{6,8})/i));
  set("municipality",  grab(/Municipality[:\s]+([^\n]+?)(?:City|County|$)/i));
  set("city_state_zip",grab(/City[,\s].*?Zip[:\s]+([^\n]+?)(?:Owning|Revision|$)/i));
  set("developer",     grab(/Developer[:\s]+([^\n]+?)(?:Total|Owning|Owner|$)/i));
  set("owning_entity", grab(/Owning Entity[:\s]+([^\n]+?)(?:Municipality|$)/i));
  set("total_hs",      grab(/Total HS[^:]*[:\s]+([0-9]+)/i));
  set("homesite_avg",  grab(/Homesite\s*AVG\s*Size[:\s]+([^\n]+?)(?:Community|Base|$)/i));
  set("base_spec",     grab(/Base Spec[:\s]+([^\n]+?)(?:Product|BuildPro|$)/i));
  set("product_type",  grab(/Product Type[:\s]+([^\n]+?)(?:Developer|$)/i));
  return f;
}

/* ---------------- ABOUT ---------------- */
function renderAbout(a){
  a.innerHTML=`<div class="panel"><div class="sec"><span>About Community-DB</span></div><table>
    <tr><td class="k">What this is</td><td class="v">A single, login-gated source of truth for Orlando community information (CIS). Everyone at ${esc(CFG.ALLOWED_DOMAIN)} can view published communities; editors draft and publish.</td></tr>
    <tr><td class="k">Viewer vs Maker</td><td class="v">Use the <b>Viewer / Maker</b> switch (top right) if you're an editor. Viewer shows only published info; Maker adds draft editing, Gaps and Add/import.</td></tr>
    <tr><td class="k">Drafts</td><td class="v">Edits are saved to a <b>draft</b> automatically as you type. The live published version doesn't change until you press <b>Publish</b>. Editing a published community starts a fresh draft; <b>Discard draft</b> reverts to the live version.</td></tr>
    <tr><td class="k">Images</td><td class="v">Uploads are automatically downsampled (long edge ${CFG.IMAGE_MAX_EDGE}px) to stay crisp while conserving storage.</td></tr>
    <tr><td class="k">Access</td><td class="v">Data loads from Supabase only after sign-in; viewers can't see drafts. Contact stephen.svedman@lennar.com for access.</td></tr>
  </table></div>`;
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
    const url=location.origin+location.pathname+"#recover="+encodeURIComponent(data.token);
    out.innerHTML=`<div class="msg ok" style="padding:8px">Link for <b>${esc(email)}</b> — share it privately:</div><div class="linkrow"><input type="text" id="ruLink" readonly value="${esc(url)}"><button class="btn mini ghost" id="ruCopy">Copy</button></div>`;
    $("ruCopy").onclick=()=>{ $("ruLink").select(); document.execCommand("copy"); $("ruCopy").textContent="Copied"; };
    renderPerms();
  };
}
async function renderPerms(){
  const p=$("permsPanel");
  let rows=[]; try{ const { data }=await sb.rpc("cdb_admin_list_users"); rows=data||[]; }catch(e){}
  p.innerHTML=`<div class="panel"><div class="sec"><span>Users &amp; roles</span></div>
    <table><tr><th>Email</th><th>Role</th><th></th></tr>${rows.map(r=>`<tr><td>${esc(r.email)}</td>
      <td><select data-role="${esc(r.email)}"><option value="viewer"${r.role==="viewer"?" selected":""}>viewer</option><option value="editor"${r.role==="editor"?" selected":""}>editor</option><option value="admin"${r.role==="admin"?" selected":""}>admin</option></select></td>
      <td><button class="rowdel" data-rmuser="${esc(r.email)}">Remove</button></td></tr>`).join("")||`<tr><td colspan="3" class="empty">No roles yet.</td></tr>`}</table></div>`;
  p.querySelectorAll("[data-role]").forEach(s=>s.onchange=async()=>{ await sb.from("cdb_app_roles").upsert({email:s.dataset.role,role:s.value},{onConflict:"email"}); });
  p.querySelectorAll("[data-rmuser]").forEach(b=>b.onclick=async()=>{ if(await uiConfirm("Remove "+b.dataset.rmuser+"'s role? They become a viewer.",{title:"Remove role",okText:"Remove",danger:true})){ await sb.from("cdb_app_roles").delete().eq("email",b.dataset.rmuser); renderPerms(); } });
}

/* ---------------- BOOTSTRAP ---------------- */
if(!initRecovery()) checkSession();
