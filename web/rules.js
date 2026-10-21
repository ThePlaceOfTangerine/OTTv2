let ruleSelection = null, ruleTemplate = null, rulesLoaded = false;
let ruleDraft = null, mapTool = 'floor', previewBoard = null;
const coreBeats = { R:'S', S:'P', P:'R' };
const pieceNames = { R:'Búa', P:'Bao', S:'Kéo' };
const ruleNotice = error => { el('rule-message').textContent = error.message; };
const sameCell = (p, row, col) => p[0] === row && p[1] === col;
const editorRows = () => ruleDraft.boardRows ?? ruleDraft.boardSize;
const editorCols = () => ruleDraft.boardCols ?? ruleDraft.boardSize;
let movementDraft={};
const movementNames={king:'Vua · 1 ô, 8 hướng',rook:'Xe · ngang/dọc',bishop:'Tượng · đường chéo',queen:'Hậu · ngang/dọc/chéo',knight:'Mã · chữ L, bị cản chân',pawn:'Tốt · tiến, ăn chéo',custom:'Tự chỉnh'};
function loadMovementFields(rules){
  const eight=JSON.stringify([...rules.directions].map(d=>d.join(',')).sort())===JSON.stringify(RpsMovement.PRESETS.king.directions.map(d=>d.join(',')).sort());
  movementDraft=Object.fromEntries(['R','P','S'].map(type=>[type,structuredClone(rules.movementByType?.[type]||(eight?{kind:'king'}:{kind:'custom',directions:rules.directions,maxSteps:1,jump:false}))]));
  renderMovementFields();
}
function renderMovementFields(){
  el('rule-movement-editor').hidden=el('rule-directions').value!=='custom';
  const host=el('rule-movement-fields');host.replaceChildren();
  for(const type of ['R','P','S']){
    const config=movementDraft[type],card=textNode('fieldset','');card.append(textNode('legend',pieceNames[type]));
    const choices=document.createElement('div');choices.className='movement-choices';
    for(const [kind,label]of Object.entries(movementNames)){
      const button=textNode('button',label);button.type='button';button.setAttribute('aria-pressed',String(config.kind===kind));
      button.onclick=()=>{movementDraft[type]=kind==='custom'?{...structuredClone(RpsMovement.resolve(config,ruleDraft.directions)),kind:'custom'}:{kind};renderMovementFields();};choices.append(button);
    }
    card.append(choices);
    if(config.kind==='custom'){
      const directions=document.createElement('textarea');directions.rows=5;directions.value=config.directions.map(d=>d.join(',')).join('\n');
      const label=textNode('label','Các hướng: mỗi dòng là thay đổi hàng, cột (−8 đến 8). Ví dụ −1,0 = lên; 0,1 = phải.');label.append(directions);card.append(label);
      directions.oninput=()=>{config.directions=directions.value.trim().split(/\n/).map(line=>line.trim().split(',').map(value=>value.trim()===''?NaN:Number(value)));};
      const range=document.createElement('input');range.type='number';range.min=1;range.max=32;range.value=config.maxSteps;range.oninput=()=>config.maxSteps=Number(range.value);
      const rangeLabel=textNode('label','Số bước tối đa theo mỗi hướng');rangeLabel.append(range);card.append(rangeLabel);
      for(const [key,title]of [['relative','Đảo hướng cho bên B (hai bên tiến về nhau)']]){
        const check=document.createElement('input');check.type='checkbox';check.checked=!!config[key];check.onchange=()=>config[key]=check.checked;
        const checkLabel=textNode('label',title);checkLabel.className='check-label';checkLabel.prepend(check);card.append(checkLabel);
      }
    }
    if(config.kind==='pawn')card.append(textNode('p','A tiến xuống, B tiến lên; đi thẳng 1 ô, ăn chéo 1 ô. Không có đi 2 ô, phong cấp hay bắt qua đường.'));
    host.append(card);
  }
}
function readMovementFields(types){
  const result={};for(const type of new Set(types)){try{RpsMovement.validate(movementDraft[type]);}catch(error){throw Error(`${pieceNames[type]}: ${error.message}`);}result[type]=structuredClone(movementDraft[type]);}return result;
}
function countFields() {
    const group = document.createElement('fieldset'), legend = textNode('legend', 'Áp dụng giống nhau cho A và B');
    group.append(legend);
    for (const type of ['R','P','S']) {
      const label = textNode('label', pieceNames[type]), input = document.createElement('input');
      input.id = `rule-count-${type}`; input.type='number'; input.min='0'; input.max='128'; input.required=true;
      label.htmlFor=input.id; group.append(label,input);
      input.addEventListener('input', () => { previewBoard=null; renderRuleBoard(); });
      input.addEventListener('change',()=>{
        if(!ruleDraft||el('rule-piece-mode').value==='random')return;
        try{for(const side of [0,1]){
          const limit=expectedPieces(side);
          if(limit>=1&&limit<=128&&ruleDraft.startingPositions[side].length>limit){
            ruleDraft.startingPositions[side]=ruleDraft.startingPositions[side].slice(0,limit);
            renderRuleBoard();boardNotice(`Đã giảm vị trí quân bên ${side===0?'A':'B'} còn ${limit} theo số quân mới. Bạn có thể bỏ quân rồi đặt lại vị trí.`);
          }
        }}catch{/* Keep invalid input editable; saving still validates it. */}
      });
    }
    el('rule-piece-counts').append(group);
}
countFields();
function piecePool(side) {
  return ['R','P','S'].flatMap(type => {
    const n = Number(el(`rule-count-${type}`).value);
    if (!Number.isInteger(n) || n < 0 || n > 128) throw new Error('Số quân mỗi loại phải từ 0 đến 128.');
    return Array(n).fill(type);
  });
}
function expectedPieces(side) { return el('rule-piece-mode').value === 'random' ? 10 : piecePool(side).length; }
function boardNotice(message){el('rule-board-feedback').textContent=message;el('rule-message').textContent=message;}
function loadRuleDraft(rules) {
  if (rules.engine !== 'rps-grid-v1' || (rules.playerPieceTypes || [rules.pieceTypes]).flat().some(t => !Object.hasOwn(pieceNames,t))) throw new Error('Trình chỉnh bàn cờ hỗ trợ quân Búa/Bao/Kéo của rps-grid-v1.');
  ruleDraft = structuredClone(rules); previewBoard = null;
  ruleDraft.blockedCells ||= []; ruleDraft.voidCells ||= [];
  if (ruleDraft.tileTypes) ruleDraft.tiles ||= [];
  el('rule-rows').value=editorRows(); el('rule-cols').value=editorCols();
  el('rule-shape').value=['rectangle','diamond','cross','custom'].includes(ruleDraft.boardShape)?ruleDraft.boardShape:ruleDraft.voidCells.length ? 'custom' : 'rectangle';
  el('rule-max-moves').value=rules.maxMoves; el('rule-repetition').value=rules.repetitionLimit;
  el('rule-theme').value=['classic','forest','sand','slate'].includes(rules.boardTheme) ? rules.boardTheme : 'classic';
  const dirs = rules.directions.map(d=>d.join(',')).sort().join(';');
  const eight = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
  const four = [[-1,0],[0,-1],[0,1],[1,0]];
  el('rule-directions').value = rules.movementByType?'custom':dirs===eight.map(d=>d.join(',')).sort().join(';') ? 'eight' : dirs===four.map(d=>d.join(',')).sort().join(';') ? 'four' : 'custom';
  el('rule-piece-mode').value=rules.randomExtraPiece ? 'random' : 'custom';
  for (const type of ['R','P','S']) el(`rule-count-${type}`).value=(rules.playerPieceTypes?.[0] || rules.pieceTypes).filter(t=>t===type).length;
  el('rule-power-ups').checked=!!rules.powerUps;
  // Data-driven tiles replace the legacy power-up switch.
  el('rule-power-ups').disabled=!!rules.tileTypes;
  el('rule-power-ups').title=rules.tileTypes?'Bộ luật dùng loại ô (tileTypes); khai báo ô hiệu ứng bằng tileSpawns trong JSON nâng cao.':'';
  renderTileTools();loadMovementFields(rules);updatePieceMode(); renderRuleBoard();
}
// One map tool per tile type declared in the RuleSet; new types appear here without changing this file.
function renderTileTools() {
  el('map-tools').querySelectorAll('.tile-tool').forEach(button => button.remove());
  if (mapTool.startsWith('tile:') && !ruleDraft.tileTypes?.[mapTool.slice(5)]) mapTool = 'floor';
  for (const [type, definition] of Object.entries(ruleDraft.tileTypes || {})) {
    const button = textNode('button', definition.render.label); button.type = 'button'; button.className = 'tile-tool'; button.dataset.tool = `tile:${type}`;
    const swatch = textNode('span', ''); swatch.className = 'tile-swatch'; swatch.style.setProperty('--tile-color', definition.render.color); button.prepend(swatch);
    button.setAttribute('aria-pressed', String(mapTool === button.dataset.tool)); el('map-tools').append(button);
  }
  el('map-tools').querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.tool === mapTool)));
}
function updatePieceMode() {
  const random=el('rule-piece-mode').value==='random';
  el('rule-piece-counts').querySelectorAll('input').forEach(input=>{input.disabled=random;});
  el('rule-piece-counts').classList.toggle('is-muted',random);
}
function buildEditorRules() {
  if (!ruleDraft) throw new Error('Chọn hoặc tạo một bộ luật trước.');
  if (Number(el('rule-rows').value)!==editorRows() || Number(el('rule-cols').value)!==editorCols()) throw new Error('Nhập xong số hàng/cột rồi chuyển sang ô khác để áp dụng bản đồ.');
  const r=structuredClone(ruleDraft);
  Object.assign(r,{boardSize:Math.max(editorRows(),editorCols()),boardRows:editorRows(),boardCols:editorCols(),maxMoves:Number(el('rule-max-moves').value),repetitionLimit:Number(el('rule-repetition').value),boardTheme:el('rule-theme').value,beats:coreBeats});
  r.randomExtraPiece=el('rule-piece-mode').value==='random';
  r.symmetricArmies=true;r.powerUps=!r.tileTypes&&el('rule-power-ups').checked;delete r.playerPieceTypes;
  if(!r.tileTypes)delete r.tiles;
  if (r.randomExtraPiece) { r.pieceTypes=['R','R','R','P','P','P','S','S','S','S']; delete r.playerPieceTypes; }
  else {
    r.pieceTypes=piecePool(0);
    if (!r.pieceTypes.length || r.pieceTypes.length>128) throw new Error('Mỗi bên cần từ 1 đến 128 quân tổng cộng.');
  }
  if (el('rule-directions').value!=='custom') r.directions=el('rule-directions').value==='four' ? [[-1,0],[0,-1],[0,1],[1,0]] : [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
  if(el('rule-directions').value==='custom')r.movementByType=readMovementFields(r.pieceTypes);else delete r.movementByType;
  for (const side of [0,1]) if(r.startingPositions[side].length!==expectedPieces(side)) throw new Error(`Bên ${side===0?'A':'B'} cần ${expectedPieces(side)} quân nhưng đã đặt ${r.startingPositions[side].length} vị trí. Thêm hoặc bỏ vị trí quân trên bàn để đủ số lượng.`);
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
    const tile=ruleDraft.tiles?.find(t=>sameCell(t.at,row,col));
    if(tile)meaning=paintTile(cell,ruleDraft,tile.type);
    if((ruleDraft.tileSpawns||[]).some(s=>{const g={rowFrom:0,rowTo:rows-1,colFrom:0,colTo:cols-1,...s.region};return row>=g.rowFrom&&row<=g.rowTo&&col>=g.colFrom&&col<=g.colTo;})){cell.classList.add('spawn-region');meaning+=' · Vùng rải ô ngẫu nhiên mỗi trận';}
    if(home>=0){cell.classList.add('map-home',`side-${home}`);cell.textContent=home===0?'★A':'★B';meaning=`Nhà ${home===0?'A':'B'}`;}
    if(side>=0){cell.classList.add('map-spawn',`side-${side}`);cell.textContent=side===0?'A':'B';meaning=`Vị trí quân ${side===0?'A':'B'}`;}
    const piece=previewBoard?.[row]?.[col];
    if(piece){cell.replaceChildren();const img=document.createElement('img');img.src={R:'/img/rock.png',P:'/img/paper.png',S:'/img/scissor.png'}[piece.type];img.alt=pieceNames[piece.type];cell.append(img);}
    cell.setAttribute('aria-label',`Hàng ${row+1}, cột ${col+1}: ${meaning}`);cell.title=`Hàng ${row+1}, cột ${col+1} · ${meaning}`;
    cell.addEventListener('click',()=>paintCell(row,col)); board.append(cell);
  }
  const summary=el('rule-board-summary');summary.replaceChildren();
  const terrain=document.createElement('div');terrain.className='board-facts';
  const facts=[['Kích thước',`${rows} hàng × ${cols} cột`],['Ô chặn',`${blocked.size} ô không thể đi vào`],['Ngoài bản đồ',`${voids.size} ô đã bỏ`]];
  if(ruleDraft.tileTypes)facts.push(['Ô đặt sẵn',`${ruleDraft.tiles.length} ô theo loại ô của bộ luật`]);
  for(const spawn of ruleDraft.tileSpawns||[])facts.push(['Rải mỗi trận',`${spawn.count[0]}–${spawn.count[1]} ${spawn.symmetry==='point'?'cặp đối xứng':'ô'} trong vùng viền cam`]);
  for(const [label,value]of facts){
    const item=document.createElement('div');item.append(textNode('span',label),textNode('strong',value));terrain.append(item);
  }
  const armies=document.createElement('div');armies.className='board-armies';
  for(const side of [0,1]){
    const item=document.createElement('div');item.className=`army-count side-${side}`;
    const placed=ruleDraft.startingPositions[side].length;item.append(textNode('strong',`Quân bên ${side===0?'A':'B'}`));
    try{
      const limit=expectedPieces(side),valid=limit>=1&&limit<=128;
      item.dataset.state=valid&&placed===limit?'complete':'incomplete';
      item.append(textNode('span',`Đã đặt ${placed} / ${limit} quân`),textNode('small',!valid?'Nhập tổng số quân từ 1 đến 128.':placed===limit?'Đã đủ quân':placed<limit?`Còn thiếu ${limit-placed} quân`:`Cần bỏ bớt ${placed-limit} quân`));
    }catch{item.append(textNode('span',`Đã đặt ${placed} quân`),textNode('small','Nhập số quân hợp lệ.'));}
    armies.append(item);
  }
  summary.append(terrain,armies);
  summary.append(textNode('p','Ô nhà ★ không tính vào số quân của mỗi bên.'));
  if(previewBoard)summary.append(textNode('p','Đang xem một cách chia loại quân mẫu ở đầu trận.'));
  const spawnSide=mapTool.startsWith('spawn')?Number(mapTool.slice(-1)):null;
  let full=false;
  if(spawnSide!==null)try{const limit=expectedPieces(spawnSide);full=limit>=1&&limit<=128&&ruleDraft.startingPositions[spawnSide].length>=limit;}catch{}
  const positions=spawnSide===null?new Set():new Set(ruleDraft.startingPositions[spawnSide].map(p=>p.join(',')));
  if(full)for(const [index,cell]of [...board.children].entries())if(!positions.has(`${Math.floor(index/cols)},${index%cols}`))cell.setAttribute('aria-disabled','true');
  const toolHints={floor:'Ô cờ: bấm ô đang có để xóa khỏi bản đồ; bấm ô đã bỏ để thêm lại. Quân hoặc ô chặn trên ô bị xóa cũng được bỏ.',blocked:'Ô chặn: bấm để thêm chướng ngại vật; bấm lại ô chặn để bỏ chướng ngại vật.',home0:'Nhà A: bấm ô mới để chuyển nhà A đến đó. Nhà luôn có đúng một ô.',home1:'Nhà B: bấm ô mới để chuyển nhà B đến đó. Nhà luôn có đúng một ô.',spawn0:'Quân A: bấm ô để thêm quân A; bấm lại quân A để bỏ.',spawn1:'Quân B: bấm ô để thêm quân B; bấm lại quân B để bỏ.'};
  if(mapTool.startsWith('tile:'))toolHints[mapTool]=`${ruleDraft.tileTypes[mapTool.slice(5)].render.label}: bấm ô để đặt, bấm lại để bỏ. Không đặt trên nhà hoặc vị trí quân.`;
  el('rule-board-feedback').textContent=full?`Bên ${spawnSide===0?'A':'B'} đã đủ quân. Bấm lại một quân cùng bên để bỏ, rồi chọn ô mới. Muốn tăng quân, đổi số lượng ở mục 4.`:toolHints[mapTool];
}
function paintCell(row,col) {
  if(!ruleDraft)return;
  const home=ruleDraft.homes.findIndex(h=>h.row===row&&h.col===col);
  if(home>=0 && mapTool!==`home${home}`){boardNotice('Ô này là nhà. Chọn công cụ Nhà tương ứng rồi đặt nhà sang ô khác trước.');return;}
  if(mapTool.startsWith('tile:')&&ruleDraft.startingPositions.some(positions=>positions.some(p=>sameCell(p,row,col)))){boardNotice('Không đặt ô đặc biệt trên vị trí xuất phát của quân. Bỏ quân ở ô này trước.');return;}
  const wasOwn=mapTool.startsWith('spawn') && ruleDraft.startingPositions[Number(mapTool.slice(-1))].some(p=>sameCell(p,row,col));
  if(mapTool.startsWith('spawn')&&!wasOwn){
    const side=Number(mapTool.slice(-1));
    try{
      const limit=expectedPieces(side);
      if(limit<1||limit>128)throw new Error('Mỗi bên cần từ 1 đến 128 quân.');
      if(ruleDraft.startingPositions[side].length>=limit){boardNotice(`Bên ${side===0?'A':'B'} đã đủ ${limit}/${limit} quân, không thể thêm. Bỏ một quân cùng bên trước khi đặt ô mới, hoặc tăng số quân ở mục 4.`);return;}
    }catch(error){boardNotice(error.message);return;}
  }
  previewBoard=null;
  const key=[row,col];
  const wasBlocked=ruleDraft.blockedCells.some(p=>sameCell(p,row,col));
  const wasVoid=ruleDraft.voidCells.some(p=>sameCell(p,row,col));
  const wasTile=ruleDraft.tiles?.some(t=>sameCell(t.at,row,col)&&`tile:${t.type}`===mapTool);
  if(ruleDraft.tiles)ruleDraft.tiles=ruleDraft.tiles.filter(t=>!sameCell(t.at,row,col));
  if(mapTool.startsWith('home')) {
    const side=Number(mapTool.slice(-1));ruleDraft.homes[side]={row,col};
  }
  ruleDraft.blockedCells=ruleDraft.blockedCells.filter(p=>!sameCell(p,row,col));ruleDraft.voidCells=ruleDraft.voidCells.filter(p=>!sameCell(p,row,col));
  ruleDraft.startingPositions=ruleDraft.startingPositions.map(positions=>positions.filter(p=>!sameCell(p,row,col)));
  if(mapTool==='blocked'&&!wasBlocked)ruleDraft.blockedCells.push(key);
  if(mapTool==='floor'&&!wasVoid)ruleDraft.voidCells.push(key);
  if(mapTool.startsWith('spawn')&&!wasOwn)ruleDraft.startingPositions[Number(mapTool.slice(-1))].push(key);
  if(mapTool.startsWith('tile:')&&!wasTile)ruleDraft.tiles.push({at:key,type:mapTool.slice(5)});
  ruleDraft.boardShape='custom';el('rule-shape').value='custom'; renderRuleBoard(); el('rule-message').textContent='Đã chỉnh bàn cờ. Bấm Lưu bộ luật để lưu thay đổi.';
}
function autoPlace() {
  if(!ruleDraft)return;
  const taken=new Set([...ruleDraft.blockedCells,...ruleDraft.voidCells,...(ruleDraft.tiles||[]).map(t=>t.at),...ruleDraft.homes.map(h=>[h.row,h.col])].map(p=>p.join(','))), positions=[[],[]];
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
    Object.assign(ruleDraft,{boardRows:rows,boardCols:cols,boardSize:Math.max(rows,cols),boardShape:shape});
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
    ruleDraft.homes=[cells[0],cells[cells.length-1]];
    if(ruleDraft.tiles)ruleDraft.tiles=ruleDraft.tiles.filter(t=>inside(t.at)&&!voids.has(t.at.join(','))&&!blocked.has(t.at.join(','))&&!ruleDraft.homes.some(h=>sameCell(t.at,h.row,h.col)));
    autoPlace();
    el('rule-message').textContent='Đã cập nhật bản đồ và xếp quân. Có thể sửa từng ô trước khi lưu.';
  }catch(error){ruleDraft=old;el('rule-rows').value=editorRows();el('rule-cols').value=editorCols();el('rule-shape').value=old.boardShape||(old.voidCells.length?'custom':'rectangle');renderRuleBoard();throw error;}
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
// Delegated so tile tools added per RuleSet work like the fixed tools.
el('map-tools').addEventListener('click',event=>{const button=event.target.closest('button[data-tool]');if(!button)return;mapTool=button.dataset.tool;previewBoard=null;el('map-tools').querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));renderRuleBoard();});
el('rule-select').onchange=()=>loadRuleSelection().catch(ruleNotice);
el('rule-version').onchange=()=>loadRuleSelection(Number(el('rule-version').value)).catch(ruleNotice);
el('rule-new').onclick=()=>{if(!ruleTemplate)return;ruleSelection=null;el('rule-history-field').hidden=true;el('rule-name').value='Bộ luật mới';loadRuleDraft(ruleTemplate);el('rule-message').textContent='Đang tạo luật mới. Chỉnh bản đồ rồi lưu.';};
el('rule-clone').onclick=()=>{try{const r=buildEditorRules();ruleSelection=null;el('rule-history-field').hidden=true;el('rule-name').value=(el('rule-name').value+' (bản sao)').slice(0,80);loadRuleDraft(r);el('rule-message').textContent='Đang tạo bản sao độc lập. Bấm Lưu để tạo bộ luật mới.';}catch(e){ruleNotice(e);}};
for(const id of ['rule-shape','rule-rows','rule-cols'])el(id).addEventListener('change',()=>{if(!ruleDraft)return;try{applyLayout();}catch(e){boardNotice(e.message);}});
el('rule-piece-mode').onchange=()=>{
  previewBoard=null;updatePieceMode();let reduced=false;
  for(const side of [0,1])try{const limit=expectedPieces(side);if(limit>=1&&limit<=128&&ruleDraft.startingPositions[side].length>limit){ruleDraft.startingPositions[side]=ruleDraft.startingPositions[side].slice(0,limit);reduced=true;}}catch{}
  renderRuleBoard();if(reduced)boardNotice('Đã bỏ bớt các vị trí thừa để khớp số quân của chế độ vừa chọn.');
};
el('rule-theme').onchange=renderRuleBoard;
el('rule-directions').onchange=renderMovementFields;
el('rule-power-ups').onchange=()=>{renderRuleBoard();boardNotice(el('rule-power-ups').checked?'Mỗi trận sẽ có 1–3 power-up ở ô trống ngẫu nhiên. Dấu + trên quân cho biết quân đã được nâng cấp.':'Đã tắt power-up.');};
el('rule-json').closest('details').addEventListener('toggle',event=>{if(event.target.open)try{el('rule-json').value=JSON.stringify(buildEditorRules(),null,2);}catch{el('rule-json').value=JSON.stringify(ruleDraft,null,2);}});
el('rule-import-json').onclick=()=>{try{const rules=JSON.parse(el('rule-json').value);loadRuleDraft(rules);el('rule-message').textContent='Đã áp dụng JSON vào bản đang chỉnh. Xem thử trước khi lưu.';}catch(e){ruleNotice(e);}};
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
