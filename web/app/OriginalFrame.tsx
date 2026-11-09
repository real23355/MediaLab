"use client";
import {useState,useRef,useEffect} from "react";
import {activity} from "../lib/image-jobs";
import {keyFrameData} from "../lib/encoded";
type Source={file:File;bytes:Uint8Array;fps:number;analysis:{codecString:string;frames:{start:number;end:number;key:boolean}[]}};
export function OriginalFrameButton({doc,index,onPause,getSnapshot}:{doc:Source;index:number;onPause:()=>void;getSnapshot?:()=>VideoFrame|null}){
  const [open,setOpen]=useState(false);
  const snapshot=useRef<VideoFrame|null>(null);
  useEffect(()=>()=>{snapshot.current?.close();},[]);
  return <><button className="original-frame-button" onClick={()=>{snapshot.current?.close();snapshot.current=getSnapshot?.()||null;onPause();setOpen(true);}}>原始解码帧</button>{open&&<OriginalFrame doc={doc} index={index} snapshot={snapshot.current} close={()=>{setOpen(false);snapshot.current?.close();snapshot.current=null;}}/>}</>;
}
function OriginalFrame({doc,index,close,snapshot}:{doc:Source;index:number;close:()=>void;snapshot:VideoFrame|null}){
  const dialog=useRef<HTMLDialogElement>(null),canvas=useRef<HTMLCanvasElement>(null),stage=useRef<HTMLDivElement>(null);
  const raw=useRef<{bytes:Uint8Array;layout:PlaneLayout[];format:string|null;width:number;height:number}|null>(null);
  const [scale,setScale]=useState(1),[message,setMessage]=useState("准备解码"),[pixel,setPixel]=useState("");
  const [percent,setPercent]=useState(0);
  useEffect(()=>{
    dialog.current?.showModal();let active=true;const status=activity(`${doc.file.name} · 原始帧 #${index}`);let decoder:VideoDecoder|undefined;
    const run=async()=>{
      if(typeof VideoDecoder==="undefined")throw Error("浏览器不支持 WebCodecs，请使用 EXE");
      let first=-1;for(let i=index;i>=0;i--)if(doc.analysis.frames[i]?.key){first=i;break;}if(first<0)throw Error("缺少前置关键帧，不能可靠解码此帧");
      let selected:VideoFrame|undefined=snapshot?.clone();
      decoder=new VideoDecoder({output:f=>{if(Math.round(f.timestamp*doc.fps/1e6)===index){selected?.close();selected=f;}else f.close();},error:e=>{if(active)setMessage(e.message);}});
      try{
        if(!selected){decoder.configure({codec:doc.analysis.codecString,optimizeForLatency:true});
        for(let i=first;i<=index;i++){
          if(!active)return;const f=doc.analysis.frames[i],bytes=doc.bytes.subarray(f.start,f.end);decoder.decode(new EncodedVideoChunk({type:f.key?"key":"delta",timestamp:Math.round(i*1e6/doc.fps),duration:Math.round(1e6/doc.fps),data:i===first?keyFrameData(doc.bytes.subarray(0,f.start),bytes,doc.analysis.codecString):bytes}));
          while(decoder.decodeQueueSize>4&&active)await new Promise(r=>setTimeout(r,2));
          if((i-first)%32===0){while(decoder.decodeQueueSize>32&&active)await new Promise(r=>setTimeout(r,2));await new Promise(r=>setTimeout(r,0));const p=(i-first)/Math.max(1,index-first+1)*95;status.update(p,"解码原始帧");setPercent(p);setMessage(`解码原始帧 · ${Math.floor(p)}%`);}
        }
        await decoder.flush();}if(!active)return;if(!selected)throw Error("该帧未成功解码");
        const frame=selected as VideoFrame,c=canvas.current!;c.width=frame.displayWidth;c.height=frame.displayHeight;c.getContext("2d")!.drawImage(frame,0,0);
        try{const bytes=new Uint8Array(frame.allocationSize());const layout=await frame.copyTo(bytes);raw.current={bytes,layout,format:frame.format,width:frame.codedWidth,height:frame.codedHeight};}catch{}
        status.update(100,"完成");setPercent(100);setMessage(`完成 · 100% · ${raw.current?.format||"浏览器未暴露原始 Plane"} · 原码流解码，PNG 保存 RGB 预览`);
        const s=stage.current!;setScale(Math.min(s.clientWidth/c.width,s.clientHeight/c.height));
      }finally{selected?.close();}
    };
    run().catch(e=>{if(active)setMessage(`浏览器未能独立解码此帧；可正常播放到该帧后查看，或使用 Windows 版。${e.message}`);}).finally(()=>{try{decoder?.close();}catch{}status.end();});
    return()=>{active=false;try{decoder?.close();}catch{}status.end();};
  },[doc,index,snapshot]);
  const fit=()=>{const s=stage.current,c=canvas.current;if(s&&c)setScale(Math.min(s.clientWidth/c.width,s.clientHeight/c.height));};
  useEffect(()=>{if(dialog.current){let p=dialog.current.querySelector('progress');if(!p){p=document.createElement('progress');p.max=100;dialog.current.querySelector('p')?.before(p);}p.value=percent;}},[percent]);
  return <dialog className="original-dialog" ref={dialog} onCancel={e=>{e.preventDefault();close();}}><div className="original-head"><strong>{doc.file.name} · 原始解码帧 #{index}</strong><button onClick={close}>关闭</button></div><p>{message}</p><div className="original-tools"><button onClick={fit}>Fit</button><button onClick={()=>setScale(1)}>100%</button><label>Zoom<input type="number" min={10} max={12800} value={Math.round(scale*100)} onChange={e=>setScale(Math.max(.1,Math.min(128,Number(e.target.value)/100)))}/>%</label><button onClick={()=>document.fullscreenElement?document.exitFullscreen():dialog.current?.requestFullscreen()}>全屏</button><button onClick={()=>canvas.current?.toBlob(blob=>{if(!blob)return;const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=`${doc.file.name}-frame-${index}.png`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);})}>保存 PNG</button></div>
    <div className="original-stage" ref={stage} onWheel={e=>{const s=stage.current!,r=s.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top,sx=(s.scrollLeft+x)/scale,sy=(s.scrollTop+y)/scale,next=Math.max(.1,Math.min(128,scale*(e.deltaY<0?1.25:.8)));setScale(next);requestAnimationFrame(()=>{s.scrollLeft=sx*next-x;s.scrollTop=sy*next-y;});}} onPointerDown={e=>{const s=e.currentTarget;s.setPointerCapture(e.pointerId);const x=e.clientX,y=e.clientY,l=s.scrollLeft,t=s.scrollTop;s.onpointermove=m=>{s.scrollLeft=l+x-m.clientX;s.scrollTop=t+y-m.clientY;};s.onlostpointercapture=()=>s.onpointermove=null;}}>
    <canvas ref={canvas} style={{width:canvas.current?canvas.current.width*scale:0,height:canvas.current?canvas.current.height*scale:0}} onMouseMove={e=>{const r=e.currentTarget.getBoundingClientRect(),x=Math.min(e.currentTarget.width-1,Math.max(0,Math.floor((e.clientX-r.left)/scale))),y=Math.min(e.currentTarget.height-1,Math.max(0,Math.floor((e.clientY-r.top)/scale)));const f=raw.current;
      if(f&&["I420","I422","I444","NV12"].includes(f.format||"")){const read=(p:number,xx:number,yy:number)=>f.bytes[f.layout[p].offset+yy*f.layout[p].stride+xx];const sx=f.format==="I444"?1:2,sy=["I420","NV12"].includes(f.format!)?2:1,cx=Math.floor(x/sx),cy=Math.floor(y/sy);const u=f.format==="NV12"?read(1,cx*2,cy):read(1,cx,cy),v=f.format==="NV12"?read(1,cx*2+1,cy):read(2,cx,cy);setPixel(`X:${x} Y:${y} · Y:${read(0,x,y)} U:${u} V:${v} · 原始采样`);}else{const p=e.currentTarget.getContext("2d")!.getImageData(x,y,1,1).data;setPixel(`X:${x} Y:${y} · RGB预览 ${p[0]},${p[1]},${p[2]}（浏览器未暴露可读取的 YUV Plane）`);}}}/></div><div className="original-pixel">{pixel}</div></dialog>;
}
