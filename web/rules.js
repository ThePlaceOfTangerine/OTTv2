let ruleSelection = null, ruleTemplate = null, rulesLoaded = false;
let ruleDraft = null, mapTool = 'floor', previewBoard = null;
const coreBeats = { R:'S', S:'P', P:'R' };
const pieceNames = { R:'Búa', P:'Bao', S:'Kéo' };
const ruleNotice = error => { el('rule-message').textContent = error.message; };
const sameCell = (p, row, col) => p[0] === row && p[1] === col;
const editorRows = () => ruleDraft.boardRows ?? ruleDraft.boardSize;
const editorCols = () => ruleDraft.boardCols ?? ruleDraft.boardSize;
function countFields() {
  for (const side of [0,1]) {
    const group = document.createElement('fieldset'), legend = textNode('legend', `Bên ${side === 0 ? 'A' : 'B'}`);
    group.append(legend);
    for (const type of ['R','P','S']) {
      const label = textNode('label', pieceNames[type]), input = document.createElement('input');
      input.id = `rule-count-${side}-${type}`; input.type='number'; input.min='0'; input.max='128'; input.required=true;
      label.htmlFor=input.id; group.append(label,input);
      input.addEventListener('input', () => { previewBoard=null; renderRuleBoard(); });
    }
    el('rule-piece-counts').append(group);
  }
}
countFields();
function piecePool(side) {
  return ['R','P','S'].flatMap(type => {
    const n = Number(el(`rule-count-${side}-${type}`).value);
    if (!Number.isInteger(n) || n < 0 || n > 128) throw new Error('Số quân mỗi loại phải từ 0 đến 128.');
    return Array(n).fill(type);
  });
}
function expectedPieces(side) { return el('rule-piece-mode').value === 'random' ? 10 : piecePool(side).length; }
function loadRuleDraft(rules) {
  if (rules.engine !== 'rps-grid-v1' || (rules.playerPieceTypes || [rules.pieceTypes]).flat().some(t => !Object.hasOwn(pieceNames,t))) throw new Error('Trình chỉnh bàn cờ hỗ trợ quân Búa/Bao/Kéo của rps-grid-v1.');
  ruleDraft = structuredClone(rules); previewBoard = null;
  ruleDraft.blockedCells ||= []; ruleDraft.voidCells ||= [];
  el('rule-rows').value=editorRows(); el('rule-cols').value=editorCols();
  el('rule-shape').value=ruleDraft.voidCells.length ? 'custom' : 'rectangle';
  el('rule-max-moves').value=rules.maxMoves; el('rule-repetition').value=rules.repetitionLimit;
  el('rule-theme').value=['classic','forest','sand','slate'].includes(rules.boardTheme) ? rules.boardTheme : 'classic';
  const dirs = rules.directions.map(d=>d.join(',')).sort().join(';');
  const eight = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
  const four = [[-1,0],[0,-1],[0,1],[1,0]];
  el('rule-directions').value = dirs===eight.map(d=>d.join(',')).sort().join(';') ? 'eight' : dirs===four.map(d=>d.join(',')).sort().join(';') ? 'four' : 'custom';
  el('rule-piece-mode').value=rules.randomExtraPiece ? 'random' : 'custom';
  for (const side of [0,1]) for (const type of ['R','P','S']) el(`rule-count-${side}-${type}`).value=(rules.playerPieceTypes?.[side] || rules.pieceTypes).filter(t=>t===type).length;
  updatePieceMode(); renderRuleBoard();
}
function updatePieceMode() {
  const random=el('rule-piece-mode').value==='random';
  el('rule-piece-counts').querySelectorAll('input').forEach(input=>{input.disabled=random;});
  el('rule-piece-counts').classList.toggle('is-muted',random);
}
function buildEditorRules() {
  if (!ruleDraft) throw new Error('Chọn hoặc tạo một bộ luật trước.');
  if (Number(el('rule-rows').value)!==editorRows() || Number(el('rule-cols').value)!==editorCols()) throw new Error('Bấm “Cập nhật bản đồ” để áp dụng số hàng/cột trước khi lưu.');
  const r=structuredClone(ruleDraft);
  Object.assign(r,{boardSize:Math.max(editorRows(),editorCols()),boardRows:editorRows(),boardCols:editorCols(),maxMoves:Number(el('rule-max-moves').value),repetitionLimit:Number(el('rule-repetition').value),boardTheme:el('rule-theme').value,beats:coreBeats});
  r.randomExtraPiece=el('rule-piece-mode').value==='random';
  if (r.randomExtraPiece) { r.pieceTypes=['R','R','R','P','P','P','S','S','S','S']; delete r.playerPieceTypes; }
  else {
    r.playerPieceTypes=[piecePool(0),piecePool(1)]; r.pieceTypes=[...r.playerPieceTypes[0]];
    if (r.playerPieceTypes.some(pool=>!pool.length || pool.length>128)) throw new Error('Mỗi bên cần từ 1 đến 128 quân tổng cộng.');
  }
  if (el('rule-directions').value!=='custom') r.directions=el('rule-directions').value==='four' ? [[-1,0],[0,-1],[0,1],[1,0]] : [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
  for (const side of [0,1]) if(r.startingPositions[side].length!==expectedPieces(side)) throw new Error(`Bên ${side===0?'A':'B'} có ${expectedPieces(side)} quân nhưng đã đặt ${r.startingPositions[side].length} vị trí. Bấm “Xếp quân tự động” hoặc đánh dấu đủ ô.`);
  return r;
}
function renderRuleBoard() {
  if (!ruleDraft) return;
  if (window.refreshAdminChoices) window.refreshAdminChoices();
  const board=el('rule-board'), rows=editorRows(),cols=editorCols();
  board.replaceChildren(); board.style.setProperty('--map-cols',cols); board.dataset.theme=el('rule-theme').value;
  const blocked=new Set(ruleDraft.blockedCells.map(p=>p.join(','))), voids=new Set(ruleDraft.voidCells.map(p=>p.join(',')));
  for(let row=0;row<rows;row++) for(let col=0;col<cols;col++) {
    const key=`${row},${col}`,cell=document.createElement('button'); cell.type='button'; cell.className=`map-cell ${(row+col)%2?'dark-sq':'light-sq'}`;
    const home=ruleDraft.homes.findIndex(h=>h.row===row&&h.col===col), side=ruleDraft.startingPositions.findIndex(positions=>positions.some(p=>sameCell(p,row,col)));
    let meaning='Ô trống';
    if(blocked.has(key)){cell.classList.add('terrain-blocked');meaning='Ô chặn';}
    if(voids.has(key)){cell.classList.add('terrain-void');meaning='Ngoài bản đồ';}
    if(home>=0){cell.classList.add('map-home',`side-${home}`);cell.textContent=home===0?'★A':'★B';meaning=`Nhà ${home===0?'A':'B'}`;}
    if(side>=0){cell.classList.add('map-spawn',`side-${side}`);cell.textContent=side===0?'A':'B';meaning=`Vị trí quân ${side===0?'A':'B'}`;}
    const piece=previewBoard?.[row]?.[col];
    if(piece){cell.replaceChildren();const img=document.createElement('img');img.src={R:'/img/rock.png',P:'/img/paper.png',S:'/img/scissor.png'}[piece.type];img.alt=pieceNames[piece.type];cell.append(img);}
    cell.setAttribute('aria-label',`Hàng ${row+1}, cột ${col+1}: ${meaning}`);cell.title=`Hàng ${row+1}, cột ${col+1} · ${meaning}`;
    cell.addEventListener('click',()=>paintCell(row,col)); board.append(cell);
  }
  let counts;
  try{counts=[0,1].map(side=>`${side===0?'A':'B'}: ${ruleDraft.startingPositions[side].length}/${expectedPieces(side)} vị trí`).join(' · ');}catch{counts='Nhập số quân hợp lệ.';}
  el('rule-board-summary').textContent=`${rows} × ${cols} · ${blocked.size} ô chặn · ${voids.size} ô bỏ · ${counts}${previewBoard?' · Đang xem mẫu chia quân':''}`;
}
function paintCell(row,col) {
  if(!ruleDraft)return; previewBoard=null;
  const home=ruleDraft.homes.findIndex(h=>h.row===row&&h.col===col);
  if(home>=0 && mapTool!==`home${home}`){ruleNotice(new Error('Ô này là nhà. Chọn công cụ Nhà tương ứng rồi đặt nhà sang ô khác trước.'));return;}
  const key=[row,col];
  if(mapTool.startsWith('home')) {
    const side=Number(mapTool.slice(-1));ruleDraft.homes[side]={row,col};
  }
  const wasOwn=mapTool.startsWith('spawn') && ruleDraft.startingPositions[Number(mapTool.slice(-1))].some(p=>sameCell(p,row,col));
  ruleDraft.blockedCells=ruleDraft.blockedCells.filter(p=>!sameCell(p,row,col));ruleDraft.voidCells=ruleDraft.voidCells.filter(p=>!sameCell(p,row,col));
  ruleDraft.startingPositions=ruleDraft.startingPositions.map(positions=>positions.filter(p=>!sameCell(p,row,col)));
  if(mapTool==='blocked')ruleDraft.blockedCells.push(key);
  if(mapTool==='void')ruleDraft.voidCells.push(key);
  if(mapTool.startsWith('spawn')&&!wasOwn)ruleDraft.startingPositions[Number(mapTool.slice(-1))].push(key);
  el('rule-shape').value='custom'; renderRuleBoard(); el('rule-message').textContent='Đã chỉnh bàn cờ. Bấm Lưu bộ luật để lưu thay đổi.';
}
function autoPlace() {
  if(!ruleDraft)return;
  const taken=new Set([...ruleDraft.blockedCells,...ruleDraft.voidCells,...ruleDraft.homes.map(h=>[h.row,h.col])].map(p=>p.join(','))), positions=[[],[]];
  const counts=[expectedPieces(0),expectedPieces(1)];
  if(counts.some(n=>n<1||n>128))throw new Error('Mỗi bên cần từ 1 đến 128 quân.');
  if(editorRows()*editorCols()-taken.size<counts[0]+counts[1])throw new Error('Không đủ ô trống để đặt quân. Giảm số quân, xóa bớt ô chặn hoặc tăng bản đồ.');
  for(const side of [0,1]) {
    const home=ruleDraft.homes[side], available=[];
    for(let row=0;row<editorRows();row++)for(let col=0;col<editorCols();col++)if(!taken.has(`${row},${col}`))available.push([row,col]);
    available.sort((a,b)=>(Math.abs(a[0]-home.row)+Math.abs(a[1]-home.col))-(Math.abs(b[0]-home.row)+Math.abs(b[1]-home.col))||a[0]-b[0]||a[1]-b[1]);
    positions[side]=available.slice(0,counts[side]);positions[side].forEach(p=>taken.add(p.join(',')));
  }
  ruleDraft.startingPositions=positions;previewBoard=null;renderRuleBoard();
}
function applyLayout() {
  const rows=Number(el('rule-rows').value),cols=Number(el('rule-cols').value);
  if(![rows,cols].every(n=>Number.isInteger(n)&&n>=2&&n<=32))throw new Error('Số hàng/cột từ 2 đến 32.');
  const shape=el('rule-shape').value;
  const old=structuredClone(ruleDraft);
  try {
    Object.assign(ruleDraft,{boardRows:rows,boardCols:cols,boardSize:Math.max(rows,cols)});
    const inside=([r,c])=>r>=0&&c>=0&&r<rows&&c<cols;
    ruleDraft.blockedCells=ruleDraft.blockedCells.filter(inside);ruleDraft.voidCells=shape==='custom'?ruleDraft.voidCells.filter(inside):[];
    if(shape!=='custom')for(let r=0;r<rows;r++)for(let c=0;c<cols;c++) {
      const nr=Math.abs((r-(rows-1)/2)/((rows-1)/2)), nc=Math.abs((c-(cols-1)/2)/((cols-1)/2));
      if((shape==='diamond'&&nr+nc>1.15)||(shape==='cross'&&nr>.4&&nc>.4))ruleDraft.voidCells.push([r,c]);
    }
    const voids=new Set(ruleDraft.voidCells.map(p=>p.join(',')));
    ruleDraft.blockedCells=ruleDraft.blockedCells.filter(p=>!voids.has(p.join(',')));
    const blocked=new Set(ruleDraft.blockedCells.map(p=>p.join(','))), cells=[];
    for(let r=0;r<rows;r++)for(let c=0;c<cols;c++)if(!voids.has(`${r},${c}`)&&!blocked.has(`${r},${c}`))cells.push({row:r,col:c});
    if(cells.length<4)throw new Error('Bản đồ cần đủ ô cho hai nhà và quân hai bên.');
    cells.sort((a,b)=>(a.row+(cols-1-a.col))-(b.row+(cols-1-b.col))||a.row-b.row);
    ruleDraft.homes=[cells[0],cells[cells.length-1]];autoPlace();
    el('rule-message').textContent='Đã cập nhật bản đồ và xếp quân. Có thể sửa từng ô trước khi lưu.';
  }catch(error){ruleDraft=old;el('rule-rows').value=editorRows();el('rule-cols').value=editorCols();renderRuleBoard();throw error;}
}
async function loadRuleList(preferId,preferVersion) {
  const data=await api('/api/admin/rule-sets'),id=preferId||el('rule-select').value;
  el('rule-select').replaceChildren(...data.ruleSets.map(row=>{const option=textNode('option',row.name);option.value=row.id;return option;}));
  if(data.ruleSets.some(r=>r.id===id))el('rule-select').value=id;
  const snapshots=await Promise.all(data.ruleSets.map(row=>api(`/api/admin/rule-sets/${encodeURIComponent(row.id)}`)));
  ruleTemplate=snapshots.find(row=>row.id==='ottv2-classic')?.rules||snapshots[0]?.rules;
  const current=el('practice-rule').value;
  el('practice-rule').replaceChildren(...snapshots.flatMap(row=>row.versions.map(v=>{const option=textNode('option',`${data.ruleSets.find(s=>s.id===row.id).name} · bản ${v.version}${v.version===row.version?' (mới nhất)':' (cũ)'}`);option.value=JSON.stringify([row.id,v.version]);return option;})));
  if([...el('practice-rule').options].some(option=>option.value===current))el('practice-rule').value=current;
  await loadRuleSelection(preferVersion);
}
async function loadRuleSelection(version) {
  const id=el('rule-select').value;if(!id)return;
  const row=await api(`/api/admin/rule-sets/${encodeURIComponent(id)}${version?'?version='+version:''}`);
  ruleSelection=row;el('rule-history-field').hidden=row.versions.length<2;
  el('rule-version').replaceChildren(...row.versions.map(v=>{const option=textNode('option',`Bản ${v.version}${v.version===row.versions[0].version?' (mới nhất)':' (cũ)'}`);option.value=v.version;return option;}));
  el('rule-version').value=row.version;el('rule-name').value=row.rules.name;loadRuleDraft(row.rules);el('rule-json').value=JSON.stringify(row.rules,null,2);el('rule-message').textContent='';
}
el('map-tools').querySelectorAll('button').forEach(button=>button.onclick=()=>{mapTool=button.dataset.tool;previewBoard=null;el('map-tools').querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));renderRuleBoard();});
el('rule-select').onchange=()=>loadRuleSelection().catch(ruleNotice);
el('rule-version').onchange=()=>loadRuleSelection(Number(el('rule-version').value)).catch(ruleNotice);
el('rule-new').onclick=()=>{if(!ruleTemplate)return;ruleSelection=null;el('rule-history-field').hidden=true;el('rule-name').value='Bộ luật mới';loadRuleDraft(ruleTemplate);el('rule-message').textContent='Đang tạo luật mới. Chỉnh bản đồ rồi lưu.';};
el('rule-clone').onclick=()=>{try{const r=buildEditorRules();ruleSelection=null;el('rule-history-field').hidden=true;el('rule-name').value=(el('rule-name').value+' (bản sao)').slice(0,80);loadRuleDraft(r);el('rule-message').textContent='Đang tạo bản sao độc lập. Bấm Lưu để tạo bộ luật mới.';}catch(e){ruleNotice(e);}};
el('rule-layout').onclick=()=>{try{applyLayout();}catch(e){ruleNotice(e);}};
el('rule-auto-place').onclick=()=>{try{autoPlace();el('rule-message').textContent='Đã xếp quân ở gần nhà của từng bên.';}catch(e){ruleNotice(e);}};
el('rule-piece-mode').onchange=()=>{previewBoard=null;updatePieceMode();renderRuleBoard();};
el('rule-theme').onchange=renderRuleBoard;
el('rule-json').closest('details').addEventListener('toggle',event=>{if(event.target.open)try{el('rule-json').value=JSON.stringify(buildEditorRules(),null,2);}catch{el('rule-json').value=JSON.stringify(ruleDraft,null,2);}});
el('rule-import-json').onclick=()=>{try{const rules=JSON.parse(el('rule-json').value);loadRuleDraft(rules);el('rule-message').textContent='Đã áp dụng JSON vào bản đang chỉnh. Xem thử trước khi lưu.';}catch(e){ruleNotice(e);}};
el('rule-preview').onclick=async event=>{
  event.target.disabled=true;
  try{const result=await postAdmin('/api/admin/rule-sets/preview',{rules:buildEditorRules()});previewBoard=result.state.board;renderRuleBoard();el('rule-message').textContent=result.state.status==='finished'?'Bàn cờ này kết thúc ngay từ đầu. Kiểm tra lại đường đi và vị trí quân.':'Bàn cờ hợp lệ. Đây là một cách chia quân mẫu; loại quân có thể thay đổi theo mã trận.';}catch(e){ruleNotice(e);}finally{event.target.disabled=false;}
};
el('rule-form').onsubmit=async event=>{
  event.preventDefault();event.submitter.disabled=true;
  try {
    const editing=ruleSelection,rules=buildEditorRules();
    const row=await postAdmin(editing?`/api/admin/rule-sets/${encodeURIComponent(editing.id)}/versions`:'/api/admin/rule-sets',{name:el('rule-name').value,rules,expectedVersion:editing?.version});
    await loadRuleList(row.id,row.version);
    el('practice-rule').value=JSON.stringify([row.id,row.version]);
    if(window.refreshAdminChoices)window.refreshAdminChoices();
    el('rule-message').textContent=`Đã lưu ${row.rules.name} · bản ${row.version}. Chọn bộ luật này trong Đấu thử để chơi trên bản đồ mới.`;
  }catch(e){ruleNotice(e);}finally{event.submitter.disabled=false;}
};
async function startRuleUI(){if(!admin||dashboard.hidden||rulesLoaded)return;rulesLoaded=true;el('rule-panel').hidden=false;try{await loadRuleList();}catch(error){rulesLoaded=false;ruleNotice(error);}}
document.addEventListener('admin-ready',startRuleUI);document.addEventListener('DOMContentLoaded',startRuleUI);
