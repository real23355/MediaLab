"use client";

import {useCallback,useEffect,useRef,useState} from "react";
import {BAYER_PATTERNS,RAW_PACKINGS,bytesForRawFrame,type RawConfig,type RawLevels,type RawPacking,type BayerPattern} from "../lib/raw";
import {imageJob} from "../lib/image-jobs";

export class RawConfigCancelled extends Error {}
type ParsedRaw={needsConfig?:boolean;bytes:Uint8Array;config:RawConfig;values?:Uint16Array;levels?:RawLevels;message?:string};
type Prompt={file:File;seed:RawConfig;message:string;resolve:(config:RawConfig|null)=>void};

export function useRawImport(){
  const [prompt,setPrompt]=useState<Prompt|null>(null);
  const pending=useRef<Prompt|null>(null);
  const generation=useRef(0);
  const cancel=useCallback(()=>{generation.current++;pending.current?.resolve(null);pending.current=null;setPrompt(null);},[]);
  useEffect(()=>()=>{pending.current?.resolve(null);pending.current=null;},[]);
  const parseRaw=useCallback(async(file:File)=>{
    const epoch=generation.current;
    const check=()=>{if(epoch!==generation.current)throw new RawConfigCancelled("解析已取消");};
    let result=await imageJob<ParsedRaw>({action:"parse-raw",file},file.name);
    check();
    while(result.needsConfig){
      const config=await new Promise<RawConfig|null>(resolve=>{
        const request={file,seed:result.config,message:result.message||"",resolve};
        pending.current=request;setPrompt(request);
      });
      check();
      if(!config)throw new RawConfigCancelled("已取消 RAW 参数设置。文件仍在待解析列表中，准备好后可以再次尝试。");
      try{result=await imageJob<ParsedRaw>({action:"parse-raw",bytes:result.bytes,config},file.name);check();}
      catch(error){check();result={...result,config,needsConfig:true,message:`按这些参数还没能打开图像，请再检查一下。${error instanceof Error?error.message:""}`};}
    }
    if(!result.values||!result.levels)throw Error("RAW 数据未能完整解码，请重新选择文件后再试。");
    return {bytes:result.bytes,config:result.config,values:result.values,levels:result.levels};
  },[]);
  const finish=(config:RawConfig|null)=>{pending.current?.resolve(config);pending.current=null;setPrompt(null);};
  return {parseRaw,cancelRawPrompt:cancel,rawPrompt:prompt?<RawConfigDialog key={prompt.file.name+prompt.message} prompt={prompt} onFinish={finish}/>:null};
}

function RawConfigDialog({prompt,onFinish}:{prompt:Prompt;onFinish:(config:RawConfig|null)=>void}){
  const dialog=useRef<HTMLDialogElement>(null);
  const [width,setWidth]=useState(prompt.seed.needsManual?"":String(prompt.seed.width));
  const [height,setHeight]=useState(prompt.seed.needsManual?"":String(prompt.seed.height));
  const [bitDepth,setBitDepth]=useState(prompt.seed.bitDepth);
  const [packing,setPacking]=useState<RawPacking>(prompt.seed.packing);
  const [bayer,setBayer]=useState<BayerPattern>(prompt.seed.bayer);
  const [error,setError]=useState(prompt.message);
  useEffect(()=>{dialog.current?.showModal();},[]);
  const expected=bytesForRawFrame(Number(width),Number(height),bitDepth,packing);
  const format=(n:number)=>n.toLocaleString("zh-CN");
  const hint=!width||!height?"请输入图像的实际宽度和高度。":!expected?"MIPI RAW10 Packed 需要选择 10-bit 位深。":expected===prompt.file.size?"尺寸与文件大小匹配，可以尝试解析。":`按当前参数需要 ${format(expected)} 字节，文件实际为 ${format(prompt.file.size)} 字节。请再确认宽高和存储方式。`;
  return <dialog ref={dialog} className="raw-config-dialog" aria-label="补充 RAW 图像参数" onCancel={event=>{event.preventDefault();onFinish(null);}}>
    <form onSubmit={event=>{
      event.preventDefault();
      if(!expected||expected!==prompt.file.size){setError("这些参数暂时还对不上文件大小。请检查后再试；如果文件含有额外文件头或每行填充，当前方式还不能直接读取。");return;}
      onFinish({width:Number(width),height:Number(height),bitDepth,packing,bayer,frameBytes:expected,needsManual:false,reason:"手动输入 RAW 参数"});
    }}>
      <h2>补充 RAW 图像参数</h2>
      <p>暂时没能自动确定这张图的尺寸。输入宽度和高度后，就可以继续尝试解析，无需修改文件名。</p>
      <p className="raw-file-name">{prompt.file.name} · {format(prompt.file.size)} 字节</p>
      <div className="raw-field-row">
        <label>宽度（像素）<input name="width" type="number" min={1} max={65535} step={1} required autoFocus value={width} onChange={e=>setWidth(e.target.value)}/></label>
        <label>高度（像素）<input name="height" type="number" min={1} max={65535} step={1} required value={height} onChange={e=>setHeight(e.target.value)}/></label>
      </div>
      <div className="raw-field-row">
        <label>位深<select name="bitDepth" value={bitDepth} onChange={e=>setBitDepth(Number(e.target.value))}>{[8,10,12,14,16].map(n=><option key={n} value={n}>{n}-bit</option>)}</select></label>
        <label>存储方式<select name="packing" value={packing} onChange={e=>setPacking(e.target.value as RawPacking)}>{RAW_PACKINGS.map(p=><option key={p.value} value={p.value}>{p.label}</option>)}</select></label>
      </div>
      <label>Bayer 排列<select name="bayer" value={bayer} onChange={e=>setBayer(e.target.value as BayerPattern)}>{BAYER_PATTERNS.map(b=><option key={b}>{b}</option>)}</select></label>
      <p className="raw-config-hint">12-bit Unpacked 通常选择“RAW Unpacked16 LE”。颜色不对时，可在解析后调整 Bayer 排列或切换灰度显示。</p>
      <p className="raw-size-hint" aria-live="polite">{hint}</p>
      <p className="raw-config-error" role="alert">{error}</p>
      <div className="raw-config-actions"><button type="button" onClick={()=>onFinish(null)}>取消</button><button type="submit" className="button primary">按这些参数解析</button></div>
    </form>
  </dialog>;
}
