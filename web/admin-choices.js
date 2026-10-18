// Native selects remain the form state; the admin interacts with visible buttons.
(() => {
  if (!location.pathname.startsWith('/admin')) return;
  document.body.classList.add('admin-console');
  for(const details of document.querySelectorAll('details')){
    const summary=details.querySelector('summary');if(!summary)continue;
    const button=document.createElement('button');button.type='button';button.className='disclosure-button';button.textContent=summary.textContent;
    details.id ||= `admin-disclosure-${document.querySelectorAll('.disclosure-button').length}`;
    button.setAttribute('aria-controls',details.id);summary.hidden=true;details.before(button);
    const sync=()=>button.setAttribute('aria-expanded',String(details.open));button.onclick=()=>{details.open=!details.open;sync();};details.addEventListener('toggle',sync);sync();
  }
  const collections = new Set(['score-round','rule-select','rule-version','practice-rule','bot-version']);
  const controls = [];
  const hints = {
    'rule-shape': {rectangle:'Giữ đầy đủ các ô',diamond:'Bản đồ thu gọn về giữa',cross:'Bốn nhánh nối ở giữa',custom:'Tự chỉnh từng ô trên bàn'},
    'rule-piece-mode': {random:'Mỗi bên 10 quân, cùng cơ cấu',custom:'Tăng giảm từng loại quân của A và B'},
    'rule-directions': {eight:'Đi ngang, dọc và chéo',four:'Chỉ đi ngang và dọc',custom:'Dùng cấu hình đã lưu'}
  };
  for (const select of document.querySelectorAll('select:not([hidden])')) {
    const label = document.querySelector(`label[for="${select.id}"]`);
    const wrapper = document.createElement('div'); wrapper.className='choice-block'; wrapper.id=`${select.id}-choices`;
    const search=document.createElement('input'); search.type='search'; search.placeholder='Gõ để tìm…'; search.className='choice-search'; search.setAttribute('aria-label',`Tìm ${label?.textContent.toLowerCase() || 'lựa chọn'}`);
    const group=document.createElement('div'); group.className=collections.has(select.id)?'choice-grid':'choice-buttons'; group.setAttribute('role','group');
    if(label){label.id ||= `${select.id}-label`;group.setAttribute('aria-labelledby',label.id);}
    else group.setAttribute('aria-label','Lựa chọn');
    const empty=document.createElement('p');empty.className='choice-empty';empty.textContent=select.id==='score-round'?'Chưa có vòng điểm. Tạo vòng đầu tiên ở phía trên.':'Chưa có lựa chọn phù hợp.';
    const pages=document.createElement('div');pages.className='choice-pages';
    const current=document.createElement('p');current.className='choice-current';
    wrapper.append(current,search,group,empty,pages);select.after(wrapper);select.hidden=true;select.classList.add('admin-choice-source');
    const state={select,wrapper,search,group,empty,pages,current,page:0,signature:''};controls.push(state);
    search.addEventListener('input',()=>{state.page=0;render(state);});
    select.addEventListener('change',()=>render(state));
    new MutationObserver(()=>render(state)).observe(select,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['disabled','selected','label']});
    render(state);
  }
  function render(state) {
    const {select,search,group,empty,pages}=state, all=[...select.options];
    const selected=select.selectedOptions[0];state.current.hidden=!collections.has(select.id)||all.length<=8||!selected;
    const currentText=selected?`Đang chọn: ${selected.textContent}`:'';if(state.current.textContent!==currentText)state.current.textContent=currentText;
    search.hidden=!collections.has(select.id)||all.length<=8;
    const query=search.hidden?'':search.value.trim().toLocaleLowerCase('vi');
    const options=all.filter(o=>o.textContent.toLocaleLowerCase('vi').includes(query)), size=12;
    state.page=Math.min(state.page,Math.max(0,Math.ceil(options.length/size)-1));
    const visible=options.slice(state.page*size,(state.page+1)*size);
    const signature=JSON.stringify([visible.map(o=>[o.value,o.textContent,o.disabled]),select.disabled,options.length,state.page]);
    if(signature!==state.signature){
      state.signature=signature;group.replaceChildren();
      for(const option of visible){
        const button=document.createElement('button');button.type='button';button.className='choice-button';button.dataset.value=option.value;button.disabled=select.disabled||option.disabled;
        const title=document.createElement('span');title.className='choice-title';title.textContent=option.textContent;button.append(title);
        const hint=hints[select.id]?.[option.value];if(hint){const description=document.createElement('small');description.textContent=hint;button.append(description);}
        if(select.id==='rule-theme'){button.dataset.swatch=option.value;button.classList.add('theme-choice');}
        button.addEventListener('click',()=>{
          if(select.value===option.value)return;
          select.value=option.value;render(state);
          select.dispatchEvent(new Event('input',{bubbles:true}));select.dispatchEvent(new Event('change',{bubbles:true}));
        });group.append(button);
      }
      pages.replaceChildren();
      if(options.length>size){
        for(const [text,delta] of [['Trang trước',-1],['Trang sau',1]]){
          const button=document.createElement('button');button.type='button';button.textContent=text;button.disabled=delta<0?state.page===0:(state.page+1)*size>=options.length;
          button.onclick=()=>{state.page+=delta;render(state);pages.querySelector('button:not(:disabled)')?.focus();};pages.append(button);
        }
        const status=document.createElement('span');status.textContent=`${state.page+1} / ${Math.ceil(options.length/size)}`;pages.prepend(status);
      }
    }
    for(const button of group.children)button.setAttribute('aria-pressed',String(button.dataset.value===select.value));
    empty.hidden=options.length>0;
  }
  window.refreshAdminChoices=()=>controls.forEach(render);
  window.focusAdminChoice=id=>{
    const wrapper=document.getElementById(`${id}-choices`);
    (wrapper?.querySelector('[aria-pressed="true"]')||wrapper?.querySelector('.choice-button'))?.focus();
  };
})();
