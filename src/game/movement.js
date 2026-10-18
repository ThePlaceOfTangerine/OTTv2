(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.RpsMovement=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const orthogonal=[[-1,0],[0,-1],[0,1],[1,0]],diagonal=[[-1,-1],[-1,1],[1,-1],[1,1]];
  const PRESETS={
    king:{directions:[[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]],maxSteps:1,jump:false},
    rook:{directions:orthogonal,maxSteps:32,jump:false},bishop:{directions:diagonal,maxSteps:32,jump:false},
    queen:{directions:[...orthogonal,...diagonal],maxSteps:32,jump:false},
    knight:{directions:[[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]],maxSteps:1,jump:true},
    pawn:{directions:[[1,0],[1,-1],[1,1]],maxSteps:1,jump:false,relative:true}
  };
  function resolve(config,fallback){return config?(config.kind==='custom'?config:PRESETS[config.kind]):{directions:fallback,maxSteps:1,jump:false};}
  function validate(config){
    if(!config||typeof config!=='object'||!['custom',...Object.keys(PRESETS)].includes(config.kind))throw Error('Kiểu di chuyển không hợp lệ.');
    if(config.kind!=='custom')return;
    const dirs=config.directions;
    if(!Array.isArray(dirs)||!dirs.length||dirs.length>48||dirs.some(d=>!Array.isArray(d)||d.length!==2||!d.every(n=>Number.isInteger(n)&&Math.abs(n)<=8)||!d.some(Boolean))||new Set(dirs.map(d=>d.join(','))).size!==dirs.length)throw Error('Hướng tùy chỉnh cần các cặp hàng/cột khác nhau từ -8 đến 8, không dùng [0,0].');
    if(!Number.isInteger(config.maxSteps)||config.maxSteps<1||config.maxSteps>32||typeof config.jump!=='boolean'||(config.relative!==undefined&&typeof config.relative!=='boolean'))throw Error('Tầm di chuyển từ 1 đến 32 ô; chọn có/không nhảy qua ô.');
  }
  return {PRESETS,resolve,validate};
});
