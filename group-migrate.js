/* ============================================================
   Community-DB — one-off grouping migration  (group-migrate.js)
   Normalizes data.f.community_name across the existing records so
   enclaves of one community cluster under a single selector row
   (the new enclave format keys on that field).

   Proposal sources, in order:
     1. the CIS Portal file's own community <-> project mapping (by JDE)
     2. records whose Community Name is already a prefix of their name
     3. a suffix-strip heuristic ("Gum Lake 40's" -> "Gum Lake")
   Everything is previewed first — group names are editable, members can
   be un-ticked — and applied as DRAFTS to review and publish.
   Remove this file (and its Add/Import wiring) once the migration is done.
   ============================================================ */

/* community group per JDE, straight from the imported CIS Portal file */
const GM_JDE_GROUPS={"1114872": "Bronson's Ridge","1114972": "Bronson's Ridge","1114772": "Bronson's Ridge","2631372": "Rivington","1118272": "Westview - Esplanade","2635972": "Reunion Village","2635272": "Waterstone","2630972": "Waterstone","2630872": "Waterstone","2635172": "Waterstone","1114572": "EverBe","2631672": "Wynnstone","2631572": "Wynnstone","2636272": "Villa Mar","2635572": "Gum Lake","2635672": "Gum Lake","2634173": "Groves at Grenelefe","1118572": "Sugarloaf Ridge","2630372": "Springhead Lake","2630272": "Springhead Lake","2630172": "Springhead Lake","1113674": "Crosswinds","1113574": "Crosswinds","2635873": "Wellness Ridge","2637372": "Wellness Ridge","2630072": "Springhead Lake","1116672": "Waterlin","1116872": "Waterlin","1116772": "Waterlin","2636872": "Hunt Club Groves","2637072": "Ranches at Lake McLeod","1119773": "Ranches at Lake McLeod","2636972": "Ranches at Lake McLeod","1115072": "Sanctuary Ridge at Wellness","6521973": "Providence - Garden Hills","1115172": "Sanctuary Ridge at Wellness","1118172": "Westview","2632472": "Westview","1643972": "Storey Creek","1117772": "Crossprairie","1117572": "Crossprairie","2638372": "Crosswinds","2637972": "Reedy Isle","2635472": "Grandview Townhomes","2638272": "Brentwood","2638572": "Waterstone","2639272": "Crosswinds Townhomes","2639472": "Scenic Terrace North","2639172": "Scenic Terrace North","1111672": "Parks at Edgewater","2632172": "Cloverleaf","1118672": "Cypress Reserve","1118472": "Sugarloaf Ridge","1118372": "Sugarloaf Ridge","2638972": "Woodland Ranch Estates","2631972": "Ridgebrooke","2633673": "Reedy Isle","2638772": "Groves at Grenelefe","1115272": "Sanctuary Ridge at Wellness","1117672": "Crossprairie"};

function gmStripBase(nm){
  const PAT=/^(\d+(?:'s|s)?|\d+ft|\d+'|th|ths|townhomes?|villas?|sf|aa|core|grove|alley|front|rear|loaded|entry|level|move|up|active|adult|models?|only|phase|ph|pod|tier|[123][ab]?|-|–|—|and|&|\(.*\)?)$/i;
  const toks=String(nm||"").replace(/\(/g," (").split(/\s+/).filter(Boolean);
  while(toks.length>1 && PAT.test(toks[toks.length-1].replace(/,$/,""))) toks.pop();
  const base=toks.join(" ").replace(/[\s\-–—]+$/,"");
  return base.length>=4?base:String(nm||"");
}
function gmRecName(it){ const row=it.draft||it.pub; return (it.name||(row&&row.project_name)||"").trim(); }
function gmProposals(){
  const recs=state.items.map(it=>{
    const row=it.draft||it.pub; const d=(row&&row.data)||{};
    const nm=gmRecName(it);
    const cur=fval(d,"community_name").trim();
    const j=String(it.jde||"").replace(/\D/g,"").slice(0,7);
    let base=null, src="";
    if(j && GM_JDE_GROUPS[j]){ base=GM_JDE_GROUPS[j]; src="portal"; }
    else if(cur && lc(nm)!==lc(cur) && lc(nm).startsWith(lc(cur))){ base=cur; src="current"; }
    else { base=gmStripBase(nm); src="name"; }
    return { it, nm, cur, jde:it.jde||"", base, src };
  });
  const byBase=new Map();
  recs.forEach(r=>{ const k=lc(r.base); let g=byBase.get(k); if(!g){ g={name:r.base, members:[]}; byBase.set(k,g); } g.members.push(r); });
  const groups=[], singles=[];
  byBase.forEach(g=>{
    g.members.sort((a,b)=>a.nm.localeCompare(b.nm,undefined,{numeric:true}));
    if(g.members.length>=2){
      g.members.forEach(m=>{ m.on = lc(m.cur)!==lc(g.name); });
      g.changes=g.members.filter(m=>m.on).length;
      groups.push(g);
    } else {
      const m=g.members[0];
      // singles: never rename — just fill a BLANK community_name so the key is stable
      m.on=!m.cur; m.fill=m.nm; singles.push(m);
    }
  });
  groups.sort((a,b)=>a.name.localeCompare(b.name));
  return { groups, singles };
}
let GM_PLAN=null;
function gmRender(){
  if(DEMO||!sb){ uiAlert("Needs the live database.","Grouping migration"); return; }
  GM_PLAN=gmProposals();
  const el=$("gmPreview"); const {groups,singles}=GM_PLAN;
  const changed=groups.filter(g=>g.changes);
  const already=groups.length-changed.length;
  const fills=singles.filter(m=>m.on).length;
  let h=`<div class="panel" style="margin-top:12px"><div class="sec"><span>Grouping migration — ${changed.length} group(s) to align · ${already} already grouped · ${fills} blank name(s) to fill</span>
    <button class="btn mini solid" id="gmApply">Apply as drafts</button></div>
    <div style="padding:10px 12px">
    <p class="hint" style="margin:0 0 8px">Each group below gets ONE Community Name so its enclaves cluster in the selector. Group names are editable; un-tick a record to leave it out. Record names and project names are not touched — only the Community Name field. Everything lands as drafts.</p>`;
  changed.forEach((g,gi)=>{
    h+=`<div class="pm-comm"><div class="pm-h" style="cursor:default"><b>Group:</b>
      <input type="text" data-gmname="${gi}" value="${esc(g.name)}" style="border:1px solid var(--line);border-radius:6px;padding:4px 8px;font:inherit;font-weight:700;min-width:220px">
      <span class="hint">${g.members.length} records · ${g.changes} change(s)</span></div>
      <div class="pm-b"><table class="pm-t"><tr><th></th><th>Record</th><th>JDE</th><th>Community Name now</th><th>Enclave label becomes</th></tr>`;
    g.members.forEach((m,mi)=>{
      const encl=(()=>{ const s=m.nm.trim(); const gn=g.name.trim();
        if(gn && lc(s).startsWith(lc(gn))){ const t=s.slice(gn.length).replace(/^[\s\-–—·:,]+/,"").trim(); if(t) return t; }
        return s||"(enclave)"; })();
      h+=`<tr><td><input type="checkbox" data-gm="${gi}|${mi}" ${m.on?"checked":""}></td>
        <td class="k">${esc(m.nm)}${m.src==="portal"?' <span class="hint">(portal)</span>':""}</td>
        <td>${esc(m.jde)}</td>
        <td>${lc(m.cur)===lc(g.name)?`<span class="hint">${esc(m.cur)} — no change</span>`:`${esc(m.cur)||'<span class="none">—</span>'} <span style="color:var(--mute)">→</span> <b>${esc(g.name)}</b>`}</td>
        <td><span class="enctag" style="margin-left:0">${esc(encl)}</span></td></tr>`;
    });
    h+=`</table></div></div>`;
  });
  if(fills) h+=`<div class="pm-sub" style="margin-top:10px">Blank Community Names filled from the record name (${fills})</div>
    <div class="hint">${singles.filter(m=>m.on).map(m=>esc(m.nm)).join(" · ")}</div>`;
  if(!changed.length && !fills) h=`<div class="note ok" style="margin-top:12px">Everything already groups cleanly — nothing to migrate.</div>`;
  else h+=`</div></div>`;
  el.innerHTML=h;
  el.querySelectorAll("[data-gm]").forEach(cb=>cb.onchange=()=>{ const [gi,mi]=cb.dataset.gm.split("|").map(Number);
    changed[gi].members[mi].on=cb.checked; });
  el.querySelectorAll("[data-gmname]").forEach(inp=>inp.onchange=()=>{ const g=changed[+inp.dataset.gmname];
    const v=inp.value.trim(); if(v) g.name=v; });
  if($("gmApply")) $("gmApply").onclick=gmApply;
}
async function gmApply(){
  const {groups,singles}=GM_PLAN||{groups:[],singles:[]};
  const jobs=[];
  groups.forEach(g=>g.members.forEach(m=>{ if(m.on && lc(m.cur)!==lc(g.name)) jobs.push({it:m.it, cn:g.name, nm:m.nm}); }));
  singles.forEach(m=>{ if(m.on && m.fill) jobs.push({it:m.it, cn:m.fill, nm:m.nm}); });
  if(!jobs.length){ uiAlert("Nothing ticked.","Grouping migration"); return; }
  if(!(await uiConfirm(`Set the Community Name on ${jobs.length} record(s) as drafts? Review, then Publish (or "Publish all drafts").`,{title:"Grouping migration",okText:"Create drafts"}))) return;
  const now=new Date().toISOString(); const payloads=[];
  jobs.forEach(({it,cn,nm})=>{
    const base=it.draft||it.pub; if(!base) return;
    const data=JSON.parse(JSON.stringify(base.data||{})); data.f=data.f||{};
    data.f.community_name=cn;
    if(!String(data.f.project_name||"").trim()) data.f.project_name=nm;   // keeps the enclave label derivable
    payloads.push({ community_id:it.id, division:"orlando", status:"draft", source:base.source||"CIS",
      name:base.name||it.name, jde:base.jde||null, project_name:base.project_name||nm||null, hub:base.hub||null,
      model_start:base.model_start||null, active:(it.active!==false), needs_review:true,
      data, updated_at:now, updated_by:state.email });
  });
  let ok=0, fail=0;
  for(let i=0;i<payloads.length;i+=80){ const batch=payloads.slice(i,i+80);
    const { error }=await sb.from("cdb_cis").upsert(batch,{onConflict:"community_id,status"});
    if(error){ fail+=batch.length; console.error(error); } else ok+=batch.length; }
  $("gmPreview").innerHTML=`<div class="note ${fail?"":"ok"}" style="margin-top:12px">${fail?`Wrote ${ok} draft(s); ${fail} failed — see console.`:`Updated ${ok} record(s) as drafts. Review them, then Publish — the selector groups as soon as the drafts are your working copies (Maker) or published (viewers).`}</div>`;
  GM_PLAN=null; await loadAll(); render();
}
