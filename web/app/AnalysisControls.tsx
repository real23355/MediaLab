"use client";
import {useState,useEffect,useRef} from "react";
import {type YuvCandidate} from "../lib/media";
export function ActivityProgress(){
  const [tasks,setTasks]=useState<Record<string,{name:string;phase:string;percent:number}>>({});
  useEffect(()=>{const handler=(event:Event)=>{const d=(event as CustomEvent).detail;setTasks(prev=>{const next={...prev};if(d.done)delete next[d.id];else next[d.id]=d;return next;});};window.addEventListener("medialab-activity",handler);return()=>window.removeEventListener("medialab-activity",handler);},[]);
  return Object.keys(tasks).length?<section className="parse-progress work-progress" aria-live="polite">{Object.entries(tasks).map(([id,t])=><div key={id} className="work-item"><span>{t.name} · {t.phase} · {Math.floor(t.percent)}%</span><progress max={100} value={t.percent}/></div>)}</section>:null;
}
export function YuvColorControls({config,onChange}:{config:YuvCandidate;onChange:(color:Pick<YuvCandidate,"colorMatrix"|"colorRange">)=>void}){
  return <div className="color-controls"><label>色彩矩阵<select aria-label="色彩矩阵" value={config.colorMatrix||"bt601"} onChange={e=>onChange({colorMatrix:e.target.value as YuvCandidate["colorMatrix"]})}><option value="bt601">BT.601</option><option value="bt709">BT.709</option><option value="bt2020">BT.2020</option></select></label><label>数值范围<select aria-label="数值范围" value={config.colorRange||"limited"} onChange={e=>onChange({colorRange:e.target.value as YuvCandidate["colorRange"]})}><option value="limited">Limited</option><option value="full">Full</option></select></label></div>;
}
type Frame={index:number;size:number;key?:boolean;type?:string};
export function DetailFrameChart({frames,frame,onSelect}:{frames:Frame[];frame:number;onSelect:(i:number)=>void}){
  const [start,setStart]=useState(0),[span,setSpan]=useState(100);
  const canvas=useRef<HTMLCanvasElement>(null);
  useEffect(()=>{const c=canvas.current;if(!c)return;const prevent=(e:Event)=>e.preventDefault();c.addEventListener("wheel",prevent,{passive:false});return()=>c.removeEventListener("wheel",prevent);},[]);
  const end=Math.min(frames.length,start+span),count=Math.max(1,end-start);
  useEffect(()=>{setStart(0);},[frames]);
  useEffect(()=>{const c=canvas.current;if(!c)return;const ctx=c.getContext("2d")!;c.width=1000;c.height=120;
    const max=frames.slice(start,end).reduce((n,f)=>Math.max(n,f.size),1);ctx.clearRect(0,0,c.width,c.height);
    for(let i=start;i<end;i++){const f=frames[i];ctx.fillStyle=i===frame?"#ee552e":f.key?"#c66b2e":"#438771";const h=f.size/max*105;ctx.fillRect((i-start)/count*1000,120-h,Math.max(1,1000/count-1),h);}
  },[frames,frame,start,end,count]);
  return <details className="detail-chart"><summary>局部逐帧图 · 当前 #{frame}</summary><div className="chart-tools"><button onClick={()=>setStart(Math.max(0,start-span))}>←</button><button onClick={()=>setStart(Math.min(Math.max(0,frames.length-span),start+span))}>→</button><button onClick={()=>{setSpan(Math.max(8,Math.floor(span/2)));setStart(Math.max(0,Math.min(frames.length-1,frame-Math.floor(span/4))));}}>放大</button><button onClick={()=>setSpan(Math.min(frames.length,span*2))}>缩小</button><button onClick={()=>setStart(Math.max(0,Math.min(frames.length-span,frame-Math.floor(span/2))))}>跟随当前帧</button><label>起始帧<input type="number" min={0} max={Math.max(0,frames.length-1)} value={start} onChange={e=>setStart(Math.max(0,Math.min(frames.length-1,Number(e.target.value))))}/></label><span>#{start}–{Math.max(start,end-1)} · 点击精确定位</span></div>
    <canvas ref={canvas} aria-label="局部逐帧图" onClick={e=>{const r=e.currentTarget.getBoundingClientRect();onSelect(Math.min(end-1,start+Math.floor((e.clientX-r.left)/r.width*count)));}} onWheel={e=>{if(e.ctrlKey){setSpan(Math.max(8,Math.min(frames.length,Math.round(span*(e.deltaY>0?1.5:.67)))));}else setStart(Math.max(0,Math.min(frames.length-span,start+Math.sign(e.deltaY)*Math.max(1,Math.floor(span/5)))));}}/>
    <input className="overview-range" aria-label="局部帧范围" type="range" min={0} max={Math.max(0,frames.length-span)} value={start} onChange={e=>setStart(Number(e.target.value))}/>
  </details>;
}
