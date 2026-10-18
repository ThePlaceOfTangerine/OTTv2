let botCatalog=[], pickerSide=0, pickerKind='contestant', pickerPage=0, pickerGroup=null;
function updateBotCatalog(bots) {botCatalog=bots;renderBotSummaries();}
function renderBotSummaries(){
  for(const side of ['a','b']){
    const bot=botCatalog.find(b=>b.id===el(`bot-${side}`).value),box=el(`bot-${side}-summary`);box.replaceChildren();
    if(!bot){box.textContent='Chưa chọn bot';continue;}
    box.append(textNode('strong',bot.kind==='sample'?bot.label:bot.username),textNode('small',bot.kind==='sample'?'Bot mẫu để đấu thử':`Thí sinh #${String(bot.userId).padStart(4,'0')} · v${bot.version} · ${bot.language}${bot.active?' · Đang dùng':''}${bot.locked?' · Đã khóa':''}`));
  }
}
function pickerGroups(){
  if(pickerKind==='sample')return botCatalog.filter(b=>b.kind==='sample').map(b=>({id:b.id,username:b.label,bots:[b],sample:true}));
  const map=new Map(adminUsers.map(u=>[u.id,{...u,bots:[]}]));
  for(const bot of botCatalog.filter(b=>b.kind==='contestant')){if(!map.has(bot.userId))map.set(bot.userId,{id:bot.userId,username:bot.username,locked:bot.locked,bots:[]});map.get(bot.userId).bots.push(bot);}
  return [...map.values()];
}
function selectBotGroup(group){
  pickerGroup=group;const versions=group.bots.filter(b=>!b.locked).sort((a,b)=>Number(b.active)-Number(a.active)||(b.version||0)-(a.version||0));
  el('bot-version-panel').hidden=!versions.length;
  el('bot-version').replaceChildren(...versions.map(b=>{const option=textNode('option',b.kind==='sample'?b.label:`v${b.version}${b.active?' · Đang dùng':''} · ${b.language} · ${b.filename}`);option.value=b.id;return option;}));
  const current=el(`bot-${pickerSide===0?'a':'b'}`).value;if(versions.some(b=>b.id===current))el('bot-version').value=current;
  el('bot-version-info').textContent=group.sample?'Bot mẫu':`${group.username} · Thí sinh #${String(group.id).padStart(4,'0')}`;
  el('bot-picker-use').disabled=!versions.length;renderBotCandidates();
  if(versions.length){if(window.refreshAdminChoices){window.refreshAdminChoices();window.focusAdminChoice('bot-version');}else el('bot-version').focus();el('bot-version-panel').scrollIntoView({block:'nearest'});}
}
function renderBotCandidates(){
  const query=el('bot-search').value.trim().toLowerCase();
  const groups=pickerGroups().filter(g=>`${g.username} #${String(g.id).padStart(4,'0')} ${g.bots.map(b=>b.filename||'').join(' ')}`.toLowerCase().includes(query));
  pickerPage=Math.min(pickerPage,Math.max(0,Math.ceil(groups.length/24)-1));
  el('bot-picker-count').textContent=`${groups.length} ${pickerKind==='sample'?'bot mẫu':'thí sinh'}`;
  el('bot-candidates').replaceChildren(...groups.slice(pickerPage*24,(pickerPage+1)*24).map(group=>{
    const button=document.createElement('button');button.type='button';button.className='bot-card';button.setAttribute('aria-pressed',String(pickerGroup?.id===group.id));
    button.append(group.sample?textNode('strong',group.username):userIdentity(group));
    button.append(textNode('small',group.sample?group.bots[0].language:group.locked?'Tài khoản đã khóa':group.bots.length?`${group.bots.length} bản bot · ${[...new Set(group.bots.map(b=>b.language))].join(', ')}`:'Chưa có bot hợp lệ'));
    button.disabled=!!group.locked||!group.bots.length;button.onclick=()=>selectBotGroup(group);return button;
  }));
  if(!groups.length)el('bot-candidates').append(textNode('p','Không tìm thấy. Thử tên tài khoản hoặc mã thí sinh khác.'));
  pagination(el('bot-pagination'),pickerPage,groups.length,24,page=>{pickerPage=page;renderBotCandidates();});
}
async function openBotPicker(side){
  pickerSide=side;pickerPage=0;pickerGroup=null;pickerKind='contestant';el('bot-search').value='';el('bot-picker-error').textContent='';el('bot-version-panel').hidden=true;el('bot-picker-use').disabled=true;
  el('bot-picker-title').textContent=`Chọn bot cho bên ${side===0?'A':'B'}`;
  el('bot-kind-filter').querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.kind===pickerKind)));
  renderBotCandidates();el('bot-picker').showModal();el('bot-search').focus();
  try{await Promise.all([loadMatches(),loadUsers()]);renderBotCandidates();}catch(error){el('bot-picker-error').textContent=error.message;}
}
el('choose-bot-a').onclick=()=>openBotPicker(0);el('choose-bot-b').onclick=()=>openBotPicker(1);
el('bot-picker-close').onclick=()=>el('bot-picker').close();
el('bot-search').oninput=()=>{pickerPage=0;renderBotCandidates();};
el('bot-kind-filter').querySelectorAll('button').forEach(button=>button.onclick=()=>{pickerKind=button.dataset.kind;pickerPage=0;pickerGroup=null;el('bot-version-panel').hidden=true;el('bot-picker-use').disabled=true;el('bot-kind-filter').querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));renderBotCandidates();});
el('bot-picker-use').onclick=()=>{const bot=botCatalog.find(b=>b.id===el('bot-version').value);if(!bot||bot.locked)return;el(`bot-${pickerSide===0?'a':'b'}`).value=bot.id;renderBotSummaries();el('bot-picker').close();};
