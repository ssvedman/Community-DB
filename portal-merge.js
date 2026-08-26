/* ============================================================
   Community-DB — CIS Portal merge  (portal-merge.js)
   Imports a "CIS Information — Orlando Division" portal export
   (.html with an embedded SEED JSON: 61 CIS sheets + 42 deck
   records) and merges it into the live data with a full
   conflict review BEFORE anything is written.

   Merge policy (chosen 8/26/26):
     · blanks/TBDs are filled from the portal silently (listed as "fills")
     · a real value on BOTH sides that differs is a CONFLICT — every one is
       listed with a per-field toggle; the DEFAULT side is whichever record
       has the newer revision date (portal sheet rev vs the DB row's
       Date / Revision Date), falling back to keeping the DB value
     · everything lands as DRAFTS (needs_review) — publish per community or
       "Publish all drafts" afterward; What's New entries log at publish

   Also here: the TH roof-decking updater (7/16" OSB → 15/32" OSB for
   every townhome community, keeping Min./Radiant qualifiers).
   ============================================================ */

/* ---------------- parse the portal file ---------------- */
function pmParsePortal(text){
  const m=text.match(/const SEED = (\{[\s\S]*?\});\n/);
  if(!m) return null;
  try{ const seed=JSON.parse(m[1]); return { cis:seed.cis||[], deck:seed.deck||[] }; }
  catch(e){ return null; }
}

/* ---------------- small helpers ---------------- */
const pmDigits = s => String(s==null?"":s).replace(/\D/g,"");
const pmBlank  = v => isGap(v);                       // "", TBD, TBD in source
const pmNorm   = v => String(v==null?"":v).toLowerCase()
  .replace(/[“”″]/g,'"').replace(/[‘’]/g,"'")
  .replace(/\s+/g," ").trim();
const pmSame   = (a,b) => pmNorm(a)===pmNorm(b);
const pmIsISO  = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s||""));
const pmDate   = s => pmIsISO(s) ? isoToDate(s) : String(s==null?"":s);   // ISO -> M.D.YY for display/storage
/* newest content date on the DB side: the sheet's Date / Revision Date */
function pmDbDate(d){
  const a=dateToISO(fval(d,"date"))||"", b=dateToISO(fval(d,"rev_date"))||"";
  const best=a>b?a:b; return pmIsISO(best)?best:null;
}

/* labels for portal cs/up keys that are NOT in the schema (go to extra) */
const PM_LABELS = {
  darksky_required:"DarkSky Required", yard_fencing:"Yard Fencing", pools:"Pools",
  pools_alternate_size:"Pools - Alternate Size", pools_spa:"Pools - Spa",
  upper_cabinets_42:'Upper Cabinets 42"'
};
const pmPretty = k => PM_LABELS[k] || String(k).split("_").map(w=>w? w[0].toUpperCase()+w.slice(1):w).join(" ");
const pmSecTitle = id => { const s=SCHEMA.SECTIONS.find(x=>x.id===id); return s?s.title:id; };

/* ---------------- map one portal CIS entry -> candidate values ---------------- */
/* returns { f:{key:value}, plans:[[5 cols]], note, model_start, extra:{sec:[[l,v]]},
             portalDate, meta:{n,p,j,rev,warnings} } */
function pmMapCIS(c){
  const f={}, extra={proj:[],hcs:[],cs:[],up:[]};
  const put=(k,v)=>{ if(!pmBlank(v)) f[k]=String(v).trim(); };
  put("community_name",c.n); put("project_name",c.p);
  if(!pmBlank(c.j) && pmDigits(c.j)) f.jde=pmDigits(c.j);
  put("division",c.div); put("base_spec",c.bs); put("developer",c.dev);
  put("owning_entity",c.oe); put("total_hs",c.hs); put("homesite_avg",c.lot);
  put("municipality",c.mun); put("city_state_zip",c.cty);
  if(!pmBlank(c.cd)) f.date=pmDate(c.cd);
  if(!pmBlank(c.tr)) f.trench_date=pmDate(c.tr);
  const xp=(l,v)=>{ if(!pmBlank(v)) extra.proj.push([l,pmDate(v)]); };
  xp("Min. Sales Pace / Month",c.pace); xp("Sales Opening Date",c.so);
  xp("BuildPro Template Type",c.bp);   xp("Template Name to Use",c.tn);
  xp("Created By",c.cb);               xp("Portal Revision",c.rev);
  xp("Source PDF",c.fn);
  // Home Construction Specs: label/value pairs -> schema fields via the
  // normalized-label index; anything the schema doesn't know goes to extra.
  const idx=SCHEMA.labelIndex();
  (c.hcs||[]).forEach(r=>{
    if(pmBlank(r.v)) return;
    const hit=idx[SCHEMA.norm(r.l)];
    if(hit) f[hit.key]=String(r.v).trim();
    else extra.hcs.push([String(r.l).trim(), String(r.v).trim()]);
  });
  // Community-specific + utility keys: prettify the snake key, then the same index.
  [["cs",c.cs],["up",c.up]].forEach(([secId,obj])=>{
    Object.entries(obj||{}).forEach(([k,v])=>{
      if(pmBlank(v)) return;
      const hit=idx[SCHEMA.norm(pmPretty(k))];
      if(hit) f[hit.key]=String(v).trim();
      else extra[secId].push([pmPretty(k), String(v).trim()]);
    });
  });
  const plans=(c.pl||[]).map(r=>[r[0]||"",r[1]||"",r[2]||"",r[3]||"",""]);
  return { f, extra, plans,
    note: pmBlank(c.nt)?"":String(c.nt).trim(),
    model_start: pmIsISO(c.mstart)?c.mstart:null,
    portalDate: pmIsISO(c.rev)?c.rev:(pmIsISO(c.cd)?c.cd:null),
    meta:{ n:c.n, p:c.p, j:pmDigits(c.j)||null, alt:pmDigits(c.alt)||null,
           rev:c.rev, warnings:(c.w||[]).concat(c.hcsnotes||[]) } };
}

/* ---------------- map one deck record -> extra.deck pairs ---------------- */
function pmMapDeck(e){
  const pairs=[]; const add=(l,v)=>{ if(!pmBlank(v)) pairs.push([l,String(v).trim()]); };
  add("Hub",e.hub); add("Municipality (Deck)",e.mun);
  if(Array.isArray(e.sp)&&e.sp.length) add("Sales Pace",e.sp.join(", "));
  const MS={starts:"Starts",sales:"Sales",closings:"Closings",model_park:"Model Park",other:"Other"};
  Object.entries(e.ms||{}).forEach(([k,v])=>add("Milestone — "+(MS[k]||pmPretty(k)), v&&pmDate(v)));
  add("Amenities",(e.am&&e.am.length)?e.am.join("; "):(e.amtext||""));
  if(e.amn) add("Amenities Notes",e.amn);
  if(Array.isArray(e.pm)&&e.pm.length) add("Product Mix", e.pm.map(r=>`${r[0]}': ${r[1]}`).join(" · "));
  add("Product Mix Total",e.pmt);
  Object.entries(e.up||{}).forEach(([k,v])=>add(pmPretty(k)+" (Deck)",v));
  (e.mp||[]).forEach(r=>add("Model Park — "+r[0], r[1]));
  const lb=e.lb||{};
  add("Land Bank Partner",lb.partner); add("Land Bank — Closing / Next Take",lb.closing_date_next_take);
  add("Land Bank — Phases",lb.phases); add("Land Bank Notes",lb.notes);
  if(e.of){ const t=Object.values(e.of).flat().filter(Boolean).join(" · "); add("Slide Notes",t); }
  if(Array.isArray(e.cl)&&e.cl.length){
    const cl=e.cl[0], items=cl.items||[];
    add(`Checklist (as of ${pmDate(cl.as_of)})`, `${items.filter(i=>i.done).length} of ${items.length} items done`);
  }
  add("Deck Date", e.deckdate&&pmDate(e.deckdate));
  return { pairs, hub:pmBlank(e.hub)?null:String(e.hub).trim(),
           model_start: pmIsISO(e.mstart)?e.mstart:null,
           meta:{ n:e.n, overlap:String(e.overlap||""), warnings:e.w||[] } };
}

/* deck name -> DB matching: overlap JDEs first, then a normalized-name pass */
function pmDeckTargets(dk, byJde){
  const ids=new Set();
  (dk.meta.overlap.match(/JDE\s+([\d,\s]+)/i)||["",""])[1].split(/[,\s]+/).forEach(j=>{
    const it=byJde.get(pmDigits(j)); if(it) ids.add(it.id); });
  if(ids.size) return [...ids];
  const strip=s=>pmNorm(s).replace(/\(.*?\)/g,"").replace(/\b(ph|phase)\s*\S*/g,"")
    .replace(/\bths?\b/g,"th").replace(/\b(sf|fka|neighborhood)\b/g,"").replace(/[^a-z' ]/g," ").replace(/\s+/g," ").trim();
  const dn=strip(dk.meta.n);
  const hits=state.items.filter(it=>{
    const a=strip(it.name); return a && dn && (a===dn || a.startsWith(dn) || dn.startsWith(a));
  });
  return hits.map(it=>it.id);
}

/* ---------------- build the merge plan (no writes) ---------------- */
let PM_PLAN=null;
function pmBuildPlan(seed){
  const secTitle={}; SCHEMA.SECTIONS.forEach(s=>secTitle[s.id]=s.title);
  const keySec={}, keyLabel={};
  SCHEMA.SECTIONS.forEach(s=>(s.fields||[]).forEach(fd=>{ keySec[fd.k]=s.title; keyLabel[fd.k]=fd.label; }));
  const byJde=new Map(), byName=new Map();
  state.items.forEach(it=>{ const j=pmDigits(it.jde); if(j) byJde.set(j.slice(0,7),it);
    byName.set(pmNorm(it.name),it); });

  const plan={ matched:[], fresh:[], unmatched:[], deckNew:[], deckUnmatched:[] };

  // ---- CIS sheets. Newest revision of the same JDE wins within the file itself.
  // A sheet whose JDE reads "TBD" first inherits the JDE from an earlier sheet of
  // the SAME project name (the portal keeps superseded revisions side by side).
  const all=seed.cis.map(pmMapCIS);
  const projJde=new Map();
  all.forEach(mc=>{ if(mc.meta.j && !projJde.has(pmNorm(mc.meta.p))) projJde.set(pmNorm(mc.meta.p),mc.meta.j); });
  const bestByJde=new Map(), noJde=[];
  all.forEach(mc=>{
    let j=mc.meta.j || projJde.get(pmNorm(mc.meta.p)) || null;
    if(j && !mc.meta.j){ mc.meta.j=j; if(!mc.f.jde) mc.f.jde=j; }
    if(!j){ noJde.push(mc); return; }
    const prev=bestByJde.get(j);
    if(!prev || String(mc.portalDate||"")>String(prev.portalDate||"")) bestByJde.set(j,mc);
  });
  const mapped=[...bestByJde.values()].concat(noJde);

  mapped.forEach(mc=>{
    const it=(mc.meta.j&&byJde.get(mc.meta.j)) || (mc.meta.alt&&byJde.get(mc.meta.alt))
          || byName.get(pmNorm(mc.meta.p)) || null;
    if(!it){
      // name-only match is allowed only when that community name is unique in the file
      const sameName=mapped.filter(x=>pmNorm(x.meta.n)===pmNorm(mc.meta.n)).length;
      const byN=sameName===1?byName.get(pmNorm(mc.meta.n)):null;
      if(byN){ plan.matched.push(pmDiff(byN,mc,keySec,keyLabel,"name")); return; }
      plan.fresh.push({ mc, include:true });
      return;
    }
    plan.matched.push(pmDiff(it,mc,keySec,keyLabel,mc.meta.j?"jde":"name"));
  });

  // ---- deck records
  seed.deck.map(pmMapDeck).forEach(dk=>{
    const ids=pmDeckTargets(dk,byJde);
    if(ids.length){ ids.forEach(id=>{ const it=itemById(id); if(it) plan.matched.push(pmDeckDiff(it,dk)); }); }
    else if(dk.pairs.length) plan.deckNew.push({ dk, include:false });   // brand-new deck-only community — off by default, tick to create
  });

  // merge per-community entries (a community can get both CIS + deck changes)
  const byId=new Map();
  plan.matched.forEach(en=>{
    const cur=byId.get(en.id);
    if(!cur) byId.set(en.id,en);
    else{ cur.fills.push(...en.fills); cur.conflicts.push(...en.conflicts);
          cur.plansAdd.push(...en.plansAdd); cur.extraAdd.push(...en.extraAdd);
          cur.warnings.push(...en.warnings); cur.sources=[...new Set(cur.sources.concat(en.sources))]; }
  });
  plan.matched=[...byId.values()].filter(en=>en.fills.length||en.conflicts.length||en.plansAdd.length||en.extraAdd.length);
  PM_PLAN=plan;
  return plan;
}

/* field-level diff of one portal CIS entry against one DB community */
function pmDiff(it,mc,keySec,keyLabel,how){
  const row=it.draft||it.pub, d=(row&&row.data)||{};
  const dbDate=pmDbDate(d), pDate=mc.portalDate;
  const portalNewer = !!(pDate && dbDate && pDate>dbDate);
  const en={ id:it.id, name:it.name||mc.meta.n, how, sources:["CIS"],
             dbDate, portalDate:pDate, portalNewer,
             fills:[], conflicts:[], plansAdd:[], extraAdd:[], warnings:mc.meta.warnings.slice(0,6),
             mc };
  Object.entries(mc.f).forEach(([k,v])=>{
    if(k==="rev_date") return;
    const cur=fval(d,k);
    if(pmBlank(cur)){ en.fills.push({sec:keySec[k]||"",label:keyLabel[k]||k,path:"f."+k,value:v}); }
    else if(!pmSame(cur,v)){
      en.conflicts.push({sec:keySec[k]||"",label:keyLabel[k]||k,path:"f."+k,cur,value:v,take:portalNewer});
    }
  });
  // note
  if(mc.note){ const cur=String(d.note||"");
    if(pmBlank(cur)) en.fills.push({sec:"Notes",label:"Notes",path:"note",value:mc.note});
    else if(!pmSame(cur,mc.note)) en.conflicts.push({sec:"Notes",label:"Notes",path:"note",cur,value:mc.note,take:portalNewer}); }
  // model_start (real column)
  if(mc.model_start){ const cur=row&&row.model_start?String(row.model_start).slice(0,10):"";
    if(!cur) en.fills.push({sec:"Project Information",label:"Model Start",path:"model_start",value:mc.model_start});
    else if(cur!==mc.model_start) en.conflicts.push({sec:"Project Information",label:"Model Start",path:"model_start",cur,value:mc.model_start,take:portalNewer}); }
  // plans: add unknown plan numbers; a differing row for a known number is a conflict
  const curPlans=Array.isArray(d.plans)?d.plans:[];
  const curBy=new Map(); curPlans.forEach((r,i)=>{ const k=pmNorm(r&&r[0]); if(k&&!curBy.has(k)) curBy.set(k,i); });
  mc.plans.forEach(pr=>{
    const k=pmNorm(pr[0]); if(!k) return;
    if(!curBy.has(k)) en.plansAdd.push(pr);
    else{ const i=curBy.get(k), cr=curPlans[i]||[];
      const a=cr.slice(0,4).map(x=>String(x||"").trim()).join(" · "), b=pr.slice(0,4).map(x=>String(x||"").trim()).join(" · ");
      if(!pmSame(a,b)) en.conflicts.push({sec:"Floor Plans",label:"Plan "+pr[0],path:"plan."+i,cur:a,value:b,take:portalNewer,planRow:pr}); }
  });
  // extra pairs: append unknown labels; differing value on a known label is a conflict
  Object.entries(mc.extra).forEach(([secId,pairs])=>{
    const ex=(d.extra&&d.extra[secId])||[];
    const exBy=new Map(); ex.forEach((p,i)=>exBy.set(pmNorm(p[0]),i));
    pairs.forEach(p=>{
      const i=exBy.get(pmNorm(p[0]));
      if(i==null) en.extraAdd.push({secId,pair:p});
      else if(!pmSame(ex[i][1],p[1]))
        en.conflicts.push({sec:pmSecTitle(secId),label:p[0],path:"x."+secId+"."+i,cur:ex[i][1]||"",value:p[1],take:portalNewer});
    });
  });
  return en;
}

/* deck record against one DB community — deck data lives in extra.deck (+ hub column) */
function pmDeckDiff(it,dk){
  const row=it.draft||it.pub, d=(row&&row.data)||{};
  const en={ id:it.id, name:it.name||dk.meta.n, how:"deck", sources:["Deck"],
             dbDate:pmDbDate(d), portalDate:null, portalNewer:false,
             fills:[], conflicts:[], plansAdd:[], extraAdd:[], warnings:dk.meta.warnings.slice(0,4), dk };
  if(dk.hub){ const cur=(row&&row.hub)||"";
    if(pmBlank(cur)) en.fills.push({sec:"Deck",label:"Hub",path:"hub",value:dk.hub});
    else if(!pmSame(cur,dk.hub)) en.conflicts.push({sec:"Deck",label:"Hub",path:"hub",cur,value:dk.hub,take:false}); }
  if(dk.model_start){ const cur=row&&row.model_start?String(row.model_start).slice(0,10):"";
    if(!cur) en.fills.push({sec:"Deck",label:"Model Start",path:"model_start",value:dk.model_start});
    else if(cur!==dk.model_start) en.conflicts.push({sec:"Deck",label:"Model Start",path:"model_start",cur,value:dk.model_start,take:false}); }
  const ex=(d.extra&&d.extra.deck)||[];
  const exBy=new Map(); ex.forEach((p,i)=>exBy.set(pmNorm(p[0]),i));
  dk.pairs.forEach(p=>{
    const i=exBy.get(pmNorm(p[0]));
    if(i==null) en.extraAdd.push({secId:"deck",pair:p});
    else if(!pmSame(ex[i][1],p[1]))
      en.conflicts.push({sec:"Site & Model Park (Deck)",label:p[0],path:"x.deck."+i,cur:ex[i][1]||"",value:p[1],take:false});
  });
  return en;
}

/* ---------------- preview UI ---------------- */
function pmRenderPreview(){
  const el=$("pmPreview"); if(!el||!PM_PLAN) return;
  const plan=PM_PLAN;
  const nf=plan.matched.reduce((n,e)=>n+e.fills.length+e.plansAdd.length+e.extraAdd.length,0);
  const nc=plan.matched.reduce((n,e)=>n+e.conflicts.length,0);
  let h=`<div class="panel" style="margin-top:12px"><div class="sec"><span>CIS Portal merge preview — ${plan.matched.length} matched · ${plan.fresh.length} new CIS · ${plan.deckNew.length} deck-only · <b class="pm-red">${nc} conflict(s)</b> · ${nf} fill(s)</span>
    <button class="btn mini solid" id="pmApply">Apply as drafts</button></div>
    <div style="padding:10px 12px">
    <p class="hint" style="margin:0 0 8px">Fills write portal values into blank/TBD fields. <b>Conflicts</b> have a value on both sides: the pre-selected side is the record with the <b>newer revision date</b> (portal sheet rev vs the DB row's Date/Revision Date; when either is unknown the DB value stays). Flip any of them before applying. Everything lands as drafts for review — nothing publishes here.</p>`;
  plan.matched.sort((a,b)=>b.conflicts.length-a.conflicts.length || String(a.name).localeCompare(String(b.name)));
  plan.matched.forEach((en,ei)=>{
    const badge=en.conflicts.length?`<span class="pill" style="background:var(--redbg);border-color:#e3b1ac;color:var(--red)">${en.conflicts.length} conflict${en.conflicts.length===1?"":"s"}</span>`:"";
    h+=`<div class="pm-comm"><button class="pm-h" data-pm="${ei}"><b>${esc(en.name)}</b>
      <span class="hint">${esc(en.sources.join(" + "))} · matched by ${esc(en.how)}${en.portalDate?` · portal rev ${esc(pmDate(en.portalDate))}`:""}${en.dbDate?` · DB rev ${esc(pmDate(en.dbDate))}`:" · DB rev unknown"}</span>
      ${badge}<span class="hint">${en.fills.length+en.plansAdd.length+en.extraAdd.length} fill(s)</span><span class="pm-chev">▸</span></button>
      <div class="pm-b hidden" data-pmb="${ei}">`;
    if(en.conflicts.length){
      h+=`<div class="pm-sub">Conflicts — pick a side</div><table class="pm-t"><tr><th>Field</th><th>Current (DB)</th><th>Portal</th></tr>`;
      en.conflicts.forEach((c,ci)=>{
        h+=`<tr><td class="k">${esc(c.label)}<div class="hint">${esc(c.sec)}</div></td>
          <td class="${c.take?"":"pm-on"}"><label><input type="radio" name="pm${ei}_${ci}" data-cf="${ei}|${ci}" value="cur" ${c.take?"":"checked"}> ${esc(c.cur)||"—"}</label></td>
          <td class="${c.take?"pm-on":""}"><label><input type="radio" name="pm${ei}_${ci}" data-cf="${ei}|${ci}" value="new" ${c.take?"checked":""}> ${esc(c.value)||"—"}</label></td></tr>`;
      });
      h+=`</table>`;
    }
    if(en.fills.length){ h+=`<div class="pm-sub">Fills (blank → portal value)</div><table class="pm-t">`+
      en.fills.map(f=>`<tr><td class="k">${esc(f.label)}<div class="hint">${esc(f.sec)}</div></td><td>${esc(String(f.value))}</td></tr>`).join("")+`</table>`; }
    if(en.plansAdd.length) h+=`<div class="pm-sub">Plans added</div><div class="hint" style="padding:2px 0 6px">${en.plansAdd.map(p=>esc(p[0]+(p[1]?" — "+p[1]:""))).join("<br>")}</div>`;
    if(en.extraAdd.length) h+=`<div class="pm-sub">New detail rows</div><div class="hint" style="padding:2px 0 6px">${en.extraAdd.slice(0,20).map(x=>esc(x.pair[0]+": "+x.pair[1])).join("<br>")}${en.extraAdd.length>20?`<br>…and ${en.extraAdd.length-20} more`:""}</div>`;
    if(en.warnings.length) h+=`<div class="pm-sub">Transcription notes (not written)</div><div class="hint" style="padding:2px 0 6px">${en.warnings.map(esc).join("<br>")}</div>`;
    h+=`</div></div>`;
  });
  if(plan.fresh.length){
    h+=`<div class="pm-sub" style="margin-top:10px">New communities from CIS sheets (not in the database)</div>`;
    plan.fresh.forEach((fr,i)=>{ h+=`<label style="display:block;padding:2px 0"><input type="checkbox" data-pmnew="${i}" ${fr.include?"checked":""}> <b>${esc(fr.mc.meta.n)}</b> — ${esc(fr.mc.meta.p||"")} ${fr.mc.meta.j?`(JDE ${esc(fr.mc.meta.j)})`:"(no JDE)"} </label>`; });
  }
  if(plan.deckNew.length){
    h+=`<div class="pm-sub" style="margin-top:10px">Deck-only communities (no CIS here and no DB match — tick to create as drafts)</div>`;
    plan.deckNew.forEach((dn,i)=>{ h+=`<label style="display:block;padding:2px 0"><input type="checkbox" data-pmdeck="${i}" ${dn.include?"checked":""}> <b>${esc(dn.dk.meta.n)}</b> <span class="hint">${esc((dn.dk.pairs.find(p=>p[0]==="Hub")||[])[1]||"")}</span></label>`; });
  }
  h+=`</div></div>`;
  el.innerHTML=h;
  el.querySelectorAll(".pm-h").forEach(b=>b.onclick=()=>{ const d=el.querySelector(`[data-pmb="${b.dataset.pm}"]`); if(d){ d.classList.toggle("hidden"); b.classList.toggle("open"); } });
  el.querySelectorAll("[data-cf]").forEach(r=>r.onchange=()=>{ const [ei,ci]=r.dataset.cf.split("|").map(Number);
    PM_PLAN.matched[ei].conflicts[ci].take=(r.value==="new");
    r.closest("tr").querySelectorAll("td").forEach(td=>td.classList.remove("pm-on"));
    r.closest("td").classList.add("pm-on"); });
  el.querySelectorAll("[data-pmnew]").forEach(cb=>cb.onchange=()=>{ PM_PLAN.fresh[+cb.dataset.pmnew].include=cb.checked; });
  el.querySelectorAll("[data-pmdeck]").forEach(cb=>cb.onchange=()=>{ PM_PLAN.deckNew[+cb.dataset.pmdeck].include=cb.checked; });
  $("pmApply").onclick=pmApply;
}

/* ---------------- apply: write drafts ---------------- */
function pmApplyEntry(base, en){
  const data=JSON.parse(JSON.stringify(base.data||{}));
  data.f=data.f||{}; data.extra=data.extra||{}; data.plans=Array.isArray(data.plans)?data.plans:[];
  let hub=base.hub||null, model_start=base.model_start||null;
  const setPath=(path,value,planRow)=>{
    if(path==="note"){ data.note=value; return; }
    if(path==="hub"){ hub=value; return; }
    if(path==="model_start"){ model_start=value; return; }
    if(path.startsWith("f.")){ data.f[path.slice(2)]=value; return; }
    if(path.startsWith("plan.")){ const i=+path.slice(5); if(planRow&&data.plans[i]) data.plans[i]=planRow.slice(); return; }
    if(path.startsWith("x.")){ const [,sec,i]=path.split("."); (data.extra[sec]=data.extra[sec]||[]); if(data.extra[sec][+i]) data.extra[sec][+i][1]=value; return; }
  };
  en.fills.forEach(f=>setPath(f.path,f.value));
  en.conflicts.forEach(c=>{ if(c.take) setPath(c.path,c.value,c.planRow); });
  en.plansAdd.forEach(pr=>data.plans.push(pr.slice()));
  en.extraAdd.forEach(x=>{ (data.extra[x.secId]=data.extra[x.secId]||[]).push([x.pair[0],x.pair[1]]); });
  return { data, hub, model_start };
}
function pmFreshRow(mc, source, deckPairs){
  const data={ f:Object.assign({},mc?mc.f:{}), plans:mc?mc.plans.map(r=>r.slice()):[], model:[], note:mc?mc.note:"", extra:{} };
  if(mc) Object.entries(mc.extra).forEach(([s,p])=>{ if(p.length) data.extra[s]=p.map(x=>x.slice()); });
  if(deckPairs&&deckPairs.length) data.extra.deck=deckPairs.map(x=>x.slice());
  return data;
}
async function pmApply(){
  const plan=PM_PLAN; if(!plan) return;
  const nSel=plan.matched.length+plan.fresh.filter(f=>f.include).length+plan.deckNew.filter(d=>d.include).length;
  if(!nSel){ uiAlert("Nothing selected to merge.","CIS Portal merge"); return; }
  if(!(await uiConfirm(`Write ${plan.matched.length} updated draft(s), ${plan.fresh.filter(f=>f.include).length} new CIS communit(ies) and ${plan.deckNew.filter(d=>d.include).length} deck-only communit(ies)? Nothing publishes — review the drafts, then Publish.`,{title:"Apply CIS Portal merge",okText:"Create drafts"}))) return;
  const now=new Date().toISOString(); const payloads=[];
  plan.matched.forEach(en=>{
    const it=itemById(en.id); if(!it) return;
    const base=it.draft||it.pub; if(!base) return;
    const ap=pmApplyEntry(base,en);
    payloads.push({ community_id:it.id, division:"orlando", status:"draft",
      source:base.source||"CIS", name:ap.data.f.community_name||base.name||it.name,
      jde:ap.data.f.jde||base.jde||null, project_name:ap.data.f.project_name||base.project_name||null,
      hub:ap.hub, model_start:ap.model_start,
      active:(it.active!==false), needs_review:true,
      data:ap.data, updated_at:now, updated_by:state.email });
  });
  plan.fresh.forEach(fr=>{ if(!fr.include) return; const mc=fr.mc;
    payloads.push({ community_id:uid(), division:"orlando", status:"draft", source:"CIS",
      name:mc.meta.n||mc.f.community_name||"(untitled)", jde:mc.f.jde||null, project_name:mc.f.project_name||null,
      hub:null, model_start:mc.model_start, active:true, needs_review:true,
      data:pmFreshRow(mc,"CIS"), updated_at:now, updated_by:state.email }); });
  plan.deckNew.forEach(dn=>{ if(!dn.include) return; const dk=dn.dk;
    payloads.push({ community_id:uid(), division:"orlando", status:"draft", source:"DECK",
      name:dk.meta.n, jde:null, project_name:null, hub:dk.hub, model_start:dk.model_start,
      active:true, needs_review:true,
      data:pmFreshRow(null,"DECK",dk.pairs), updated_at:now, updated_by:state.email }); });
  let ok=0, fail=0;
  for(let i=0;i<payloads.length;i+=80){ const batch=payloads.slice(i,i+80);
    const { error }=await sb.from("cdb_cis").upsert(batch,{onConflict:"community_id,status"});
    if(error){ fail+=batch.length; console.error(error); } else ok+=batch.length; }
  $("pmPreview").innerHTML=`<div class="note ${fail?"":"ok"}" style="margin-top:12px">${fail?`Wrote ${ok} draft(s); ${fail} failed — see console.`:`Created/updated ${ok} draft(s) from the CIS Portal file. Review them (Drafts only filter), then Publish or "Publish all drafts".`}</div>`;
  PM_PLAN=null; await loadAll(); render();
}

/* entry point wired from the Add/Import tab */
async function pmImportPortalFile(file, logln){
  if(DEMO||!sb){ uiAlert("Portal merge needs the live database (not available in demo mode).","CIS Portal merge"); return; }
  logln("Reading "+file.name+"…");
  const text=await file.text();
  const seed=pmParsePortal(text);
  if(!seed){ logln("Couldn't find the embedded SEED data in this file — is it the CIS Portal export?","err"); return; }
  logln(`Parsed ${seed.cis.length} CIS sheet(s) and ${seed.deck.length} deck record(s). Building merge preview…`);
  pmBuildPlan(seed); pmRenderPreview();
  const nc=PM_PLAN.matched.reduce((n,e)=>n+e.conflicts.length,0);
  logln(`Preview ready: ${PM_PLAN.matched.length} matched, ${PM_PLAN.fresh.length} new, ${nc} conflict(s) to review.`, nc?"warn":"ok");
}

/* ============================================================
   TH roof decking: 7/16" OSB -> 15/32" OSB for townhome communities.
   Detects TH by product type / name / project name; preserves the
   rest of the value (Min., Radiant, Non-Radiant, …). Writes drafts.
   ============================================================ */
const pmIsTH = it => {
  const row=it.draft||it.pub, d=(row&&row.data)||{};
  const hay=[fval(d,"product_type"), it.name, (row&&row.project_name)||"", fval(d,"project_name")].join(" ");
  return /(\bTHS?\b|TOWNHOME|TOWNHOMES|\bTOWNS\b)/i.test(hay);
};
function pmRenderTH(){
  const el=$("pmTH"); if(!el) return;
  const rows=state.items.filter(pmIsTH).map(it=>{
    const row=it.draft||it.pub, d=(row&&row.data)||{};
    const cur=fval(d,"roof_sheathing");
    const next=/7\s*\/\s*16/.test(cur)?cur.replace(/7\s*\/\s*16/g,"15/32"):null;
    return { it, cur, next, on:!!next };
  });
  if(!rows.length){ el.innerHTML=`<div class="note" style="margin-top:12px">No townhome/villa communities detected.</div>`; return; }
  let h=`<div class="panel" style="margin-top:12px"><div class="sec"><span>TH roof decking — 7/16" → 15/32" (${rows.filter(r=>r.next).length} to change)</span><button class="btn mini solid" id="pmThApply">Apply as drafts</button></div>
    <div style="padding:10px 12px"><p class="hint" style="margin:0 0 8px">Every community whose product/name reads townhome, TH or villa. Qualifiers (Min., Radiant, Non-Radiant) are kept. Un-tick anything that shouldn't change; rows without a 7/16 value are listed for a manual look.</p>
    <table class="pm-t"><tr><th></th><th>Community</th><th>Roof Sheathing now</th><th>Becomes</th></tr>`;
  rows.forEach((r,i)=>{
    h+=`<tr><td>${r.next?`<input type="checkbox" data-th="${i}" ${r.on?"checked":""}>`:""}</td>
      <td class="k">${esc(r.it.name)}</td><td>${esc(r.cur)||'<span class="none">—</span>'}</td>
      <td>${r.next?`<b>${esc(r.next)}</b>`:`<span class="hint">${pmBlank(r.cur)?"no value — check manually":/15\s*\/\s*32/.test(r.cur)?"already 15/32":"no 7/16 in value — check manually"}</span>`}</td></tr>`;
  });
  h+=`</table></div></div>`;
  el.innerHTML=h; el._rows=rows;
  el.querySelectorAll("[data-th]").forEach(cb=>cb.onchange=()=>{ rows[+cb.dataset.th].on=cb.checked; });
  $("pmThApply").onclick=async()=>{
    const sel=rows.filter(r=>r.next&&r.on);
    if(!sel.length){ uiAlert("Nothing ticked.","TH roof decking"); return; }
    if(!(await uiConfirm(`Update roof sheathing on ${sel.length} townhome communit(ies) to 15/32 as drafts?`,{title:"TH roof decking",okText:"Create drafts"}))) return;
    const now=new Date().toISOString();
    const payloads=sel.map(r=>{ const base=r.it.draft||r.it.pub;
      const data=JSON.parse(JSON.stringify(base.data||{})); data.f=data.f||{}; data.f.roof_sheathing=r.next;
      return { community_id:r.it.id, division:"orlando", status:"draft", source:base.source||"CIS",
        name:base.name||r.it.name, jde:base.jde||null, project_name:base.project_name||null, hub:base.hub||null,
        model_start:base.model_start||null, active:(r.it.active!==false), needs_review:true,
        data, updated_at:now, updated_by:state.email }; });
    let ok=0;
    for(let i=0;i<payloads.length;i+=80){ const batch=payloads.slice(i,i+80);
      const { error }=await sb.from("cdb_cis").upsert(batch,{onConflict:"community_id,status"});
      if(error) console.error(error); else ok+=batch.length; }
    el.innerHTML=`<div class="note ok" style="margin-top:12px">Updated roof sheathing on ${ok} communit(ies) as drafts — review and publish.</div>`;
    await loadAll(); render();
  };
}
