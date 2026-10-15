let ruleSelection = null, ruleTemplate = null, rulesLoaded = false;
const ruleNotice = error => { el('rule-message').textContent = error.message; };
async function loadRuleList(preferId, preferVersion) {
  const data = await api('/api/admin/rule-sets');
  const id = preferId || el('rule-select').value;
  el('rule-select').replaceChildren(...data.ruleSets.map(row => { const option = textNode('option', row.name); option.value = row.id; return option; }));
  if (data.ruleSets.some(r=>r.id===id)) el('rule-select').value=id;
  const snapshots = await Promise.all(data.ruleSets.map(row=>api(`/api/admin/rule-sets/${encodeURIComponent(row.id)}`)));
  ruleTemplate = snapshots.find(row=>row.id==='ottv2-classic')?.rules || snapshots[0]?.rules;
  const current = el('practice-rule').value;
  el('practice-rule').replaceChildren(...snapshots.flatMap(row=>row.versions.map(v=>{const option=textNode('option',`${data.ruleSets.find(s=>s.id===row.id).name} · bản ${v.version}${v.version===row.version ? " (mới nhất)" : " (cũ)"}`);option.value=JSON.stringify([row.id,v.version]);return option;})));
  if ([...el('practice-rule').options].some(option=>option.value===current)) el('practice-rule').value=current;
  await loadRuleSelection(preferVersion);
}
async function loadRuleSelection(version) {
  const id=el('rule-select').value;if(!id)return;
  const row=await api(`/api/admin/rule-sets/${encodeURIComponent(id)}${version ? '?version='+version : ''}`);
  ruleSelection=row;
  el("rule-history-field").hidden=row.versions.length<2;
  el('rule-version').replaceChildren(...row.versions.map(v=>{const option=textNode('option',`Bản ${v.version}${v.version===row.versions[0].version ? " (mới nhất)" : " (cũ)"}`);option.value=v.version;return option;}));
  el('rule-version').value=row.version;el('rule-name').value=row.rules.name;el('rule-json').value=JSON.stringify(row.rules,null,2);
}
el('rule-select').onchange=()=>loadRuleSelection().catch(ruleNotice);
el('rule-version').onchange=()=>loadRuleSelection(Number(el('rule-version').value)).catch(ruleNotice);
el('rule-new').onclick=()=>{ruleSelection=null;el('rule-history-field').hidden=true;el('rule-name').value='Bộ luật mới';el('rule-json').value=JSON.stringify(ruleTemplate,null,2);el('rule-message').textContent='Đang tạo bộ luật mới từ cấu hình mẫu. Sửa tên, cấu hình rồi lưu.';};
el('rule-form').onsubmit=async event=>{
  event.preventDefault();event.submitter.disabled=true;
  try {
    let rules;try{rules=JSON.parse(el('rule-json').value);}catch{throw new Error('JSON chưa đúng cú pháp. Kiểm tra dấu ngoặc, dấu phẩy và dấu nháy kép.');}
    const editing=ruleSelection;
    const row=await postAdmin(editing?`/api/admin/rule-sets/${encodeURIComponent(editing.id)}/versions`:'/api/admin/rule-sets',{name:el('rule-name').value,rules,expectedVersion:editing?.version});
    await loadRuleList(row.id,row.version);el('practice-rule').value=JSON.stringify([row.id,row.version]);
    el('rule-message').textContent=`Đã lưu ${row.rules.name} · bản ${row.version}. Có thể chọn phiên bản này trong trận thử; các trận và bảng điểm cũ giữ nguyên.`;
  }catch(error){ruleNotice(error);}finally{event.submitter.disabled=false;}
};
async function startRuleUI(){if(!admin||dashboard.hidden||rulesLoaded)return;rulesLoaded=true;el('rule-panel').hidden=false;try{await loadRuleList();}catch(error){rulesLoaded=false;ruleNotice(error);}}
document.addEventListener('admin-ready',startRuleUI);
document.addEventListener('DOMContentLoaded',startRuleUI);
