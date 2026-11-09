function alignedTime(side,seconds){
  const left=streamCompareDoc("left"),right=streamCompareDoc("right");if(!left||!right)return seconds;
  const offset=state.frameOffset||0;
  if(state.alignment==="frame")return side==="left"?(Math.round(seconds*left.fps)+offset)/right.fps:(Math.round(seconds*right.fps)-offset)/left.fps;
  return seconds+(side==="left"?1:-1)*offset/right.fps;
}
function addYuvColorControls(root,doc,change){
  for(const [key,label,options] of [["colorMatrix","色彩矩阵",["bt601","bt709","bt2020"]],["colorRange","数值范围",["limited","full"]]]){
    const field=document.createElement("label");field.textContent=label;
    const select=document.createElement("select");for(const value of options){const opt=document.createElement("option");opt.value=value;opt.textContent=value.toUpperCase();select.append(opt);}select.value=doc.config[key]||options[0];select.onchange=()=>{doc.config[key]=select.value;change();};field.append(select);root.append(field);
  }
}
function attachFrameDetail(root,doc,onSelect){
  root.querySelector(".detail-chart")?.remove();
  const el=document.createElement("details");el.className="detail-chart";
  el.innerHTML='<summary>局部逐帧图</summary><div class="detail-popup"><div class="chart-tools"><button data-step="-1">←</button><button data-step="1">→</button><button data-zoom=".5">放大</button><button data-zoom="2">缩小</button><label>起始帧<input type="number" min="0" value="0"/></label><button data-follow>跟随当前帧</button><span></span></div><canvas aria-label="局部逐帧图"></canvas><input class="overview-range" type="range" min="0" value="0"/></div>';
  (root.querySelector(".compare-frame-analysis")||root).prepend(el);
  const frames=doc.analysis.frames,c=el.querySelector("canvas"),input=el.querySelector('input[type="number"]'),range=el.querySelector('input[type="range"]');
  let start=0,span=Math.min(100,frames.length);
  const draw=()=>{
    start=Math.max(0,Math.min(Math.max(0,frames.length-span),start));input.value=start;range.max=Math.max(0,frames.length-span);range.value=start;
    const end=Math.min(frames.length,start+span);el.querySelector(".chart-tools span").textContent=`#${start}–${end-1} · 点击精确定位`;
    c.width=1000;c.height=120;const ctx=c.getContext("2d"),max=frames.slice(start,end).reduce((a,f)=>Math.max(a,f.size),1);
    for(let i=start;i<end;i++){const f=frames[i];ctx.fillStyle=f.key?"#c66b2e":"#438771";const h=f.size/max*105;ctx.fillRect((i-start)/span*1000,120-h,Math.max(1,1000/span-1),h);}
  };
  input.onchange=()=>{start=Number(input.value);draw();};range.oninput=()=>{start=Number(range.value);draw();};
  for(const b of el.querySelectorAll('[data-step]'))b.onclick=()=>{start+=Number(b.dataset.step)*span;draw();};
  for(const b of el.querySelectorAll('[data-zoom]'))b.onclick=()=>{span=Math.max(1,Math.min(frames.length,Math.round(span*Number(b.dataset.zoom))));draw();};
  el.querySelector('[data-follow]').onclick=()=>{const video=root.querySelector("video")||$("#stream-video");start=Math.round(video.currentTime*doc.fps)-Math.floor(span/2);draw();};
  c.onclick=e=>{const r=c.getBoundingClientRect();onSelect(Math.min(frames.length-1,start+Math.floor((e.clientX-r.left)/r.width*span)));};
  c.onwheel=e=>{e.preventDefault();if(e.ctrlKey)span=Math.max(1,Math.min(frames.length,Math.round(span*(e.deltaY>0?2:.5))));else start+=Math.sign(e.deltaY)*Math.max(1,Math.floor(span/5));draw();};
  el.ontoggle=draw;draw();
}
let originalDialog=null,originalToken=0,originalUrl="",originalJob="";
function closeOriginalFrame(){originalToken++;if(originalJob)window.desktop.cancelJob(originalJob).catch(()=>{});originalJob="";originalDialog?.remove();originalDialog=null;if(originalUrl)URL.revokeObjectURL(originalUrl);originalUrl="";}
function addOriginalButton(root,get){const b=document.createElement("button");b.textContent="原始解码帧";b.className="original-frame-button";b.onclick=()=>{const {doc,index}=get();if(doc)showOriginalFrame(doc,index);};root.append(b);}
async function showOriginalFrame(doc,index){
  closeOriginalFrame();const token=originalToken,epoch=state.sessionToken;
  const dialog=document.createElement("dialog");originalDialog=dialog;dialog.className="original-dialog";
  dialog.innerHTML='<div class="original-head"><strong></strong><button data-close>关闭</button></div><progress max="100" value="0"></progress><span class="original-message">准备解码 · 0%</span><div class="original-tools"><button data-fit>Fit</button><button data-actual>100%</button><label>Zoom<input type="number" min="10" max="12800" value="100" step="25"/>%</label><button data-full>全屏</button><button data-save disabled>保存 PNG</button></div><div class="original-stage"><img draggable="false"/></div><div class="original-pixel"></div>';
  dialog.querySelector("strong").textContent=`${doc.file.name} · 原始解码帧 #${index}`;document.body.append(dialog);dialog.showModal();
  dialog.querySelector('[data-close]').onclick=closeOriginalFrame;dialog.oncancel=e=>{e.preventDefault();closeOriginalFrame();};
  const jobId=`original-${epoch}-${token}`,status=window.desktop.onProgress(p=>{if(p.jobId===jobId){dialog.querySelector("progress").value=p.percent||0;dialog.querySelector(".original-message").textContent=`${p.phase} · ${Math.floor(p.percent||0)}%`;}});
  originalJob=jobId;
  try{
    const frame=await window.desktop.extractFrame(doc.file.path,doc.kind,index,doc.analysis.width,doc.analysis.height,doc.analysis.pixelFormat,jobId);
    if(token!==originalToken||epoch!==state.sessionToken)return;
    const blob=new Blob([frame.png],{type:"image/png"});originalUrl=URL.createObjectURL(blob);
    const image=dialog.querySelector("img"),stage=dialog.querySelector(".original-stage"),zoom=dialog.querySelector('.original-tools input');image.src=originalUrl;
    let scale=1;
    const apply=s=>{scale=Math.max(.1,Math.min(128,s));image.style.width=`${frame.width*scale}px`;image.style.height=`${frame.height*scale}px`;zoom.value=Math.round(scale*100);};
    dialog.querySelector('[data-fit]').onclick=()=>apply(Math.min(stage.clientWidth/frame.width,stage.clientHeight/frame.height));dialog.querySelector('[data-actual]').onclick=()=>apply(1);zoom.onchange=()=>apply(Number(zoom.value)/100);
    image.onload=()=>dialog.querySelector('[data-fit]').click();
    stage.onwheel=e=>{e.preventDefault();const r=stage.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top,sx=(stage.scrollLeft+x)/scale,sy=(stage.scrollTop+y)/scale;apply(scale*(e.deltaY<0?1.25:.8));stage.scrollLeft=sx*scale-x;stage.scrollTop=sy*scale-y;};
    stage.onpointerdown=e=>{stage.setPointerCapture(e.pointerId);const x=e.clientX,y=e.clientY,l=stage.scrollLeft,t=stage.scrollTop;stage.onpointermove=m=>{stage.scrollLeft=l+x-m.clientX;stage.scrollTop=t+y-m.clientY;};};stage.onlostpointercapture=()=>stage.onpointermove=null;
    image.onmousemove=e=>{const r=image.getBoundingClientRect(),x=Math.min(frame.width-1,Math.max(0,Math.floor((e.clientX-r.left)/scale))),y=Math.min(frame.height-1,Math.max(0,Math.floor((e.clientY-r.top)/scale)));dialog.querySelector('.original-pixel').textContent=originalSample(frame,x,y);};
    dialog.querySelector('[data-full]').onclick=()=>document.fullscreenElement?document.exitFullscreen():dialog.requestFullscreen();
    const save=dialog.querySelector('[data-save]');save.disabled=false;save.onclick=()=>{const a=document.createElement("a");a.href=originalUrl;a.download=`${doc.file.name}-frame-${index}.png`;a.click();};
    dialog.querySelector('.original-message').textContent=`完成 · 100% · ${frame.pixelFormat} · 原始解码数据（预览转换为 RGB，PNG 无损保存预览）`;
  }catch(e){if(token===originalToken)dialog.querySelector('.original-message').textContent=e.message;}finally{status();}
}
function originalSample(f,x,y){
  const match=f.pixelFormat.match(/(10|12|16)le$/),step=match?2:1,bytes=f.bytes;
  const read=i=>step===1?bytes[i]:(bytes[i*2]|bytes[i*2+1]<<8);
  const yv=read(y*f.width+x);
  if(f.pixelFormat.startsWith("gray"))return `X:${x} Y:${y} · Y:${yv}`;
  const sx=f.pixelFormat.includes("444")?1:2,sy=f.pixelFormat.includes("420")?2:1,cw=Math.ceil(f.width/sx),ch=Math.ceil(f.height/sy),ci=Math.floor(y/sy)*cw+Math.floor(x/sx),base=f.width*f.height;
  return `X:${x} Y:${y} · Y:${yv} U:${read(base+ci)} V:${read(base+cw*ch+ci)} · ${match?match[1]:8}bit 原始采样`;
}
addOriginalButton($("#play-badge").parentElement,()=>{ $("#stream-video").pause();return {doc:state.streams.find(d=>d.id===state.activeStreamId),index:state.stream.currentFrame};});
