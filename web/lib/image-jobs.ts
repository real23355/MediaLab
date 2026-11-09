let sequence=0;
const cancellations=new Set<()=>void>();
export function activity(name:string) {
  const id=++sequence;
  const update=(percent:number,phase:string)=>window.dispatchEvent(new CustomEvent("medialab-activity",{detail:{id,name,percent,phase}}));
  update(0,"准备");
  return {update,end:()=>window.dispatchEvent(new CustomEvent("medialab-activity",{detail:{id,done:true}}))};
}
export function cancelImageJobs(){for(const cancel of [...cancellations])cancel();}
export function imageJob<T>(task:object,name:string):Promise<T>{
  const input=task as {action:string;bytes?:Uint8Array;frame?:number;config?:{dataOffset?:number;frameBytes:number};[key:string]:unknown};
  if(input.action==="render-yuv"&&input.config&&input.bytes){
    const offset=(input.config.dataOffset||0)+(input.frame||0)*input.config.frameBytes;
    task={action:input.action,bytes:input.bytes.slice(offset,offset+input.config.frameBytes),config:{...input.config,dataOffset:0},frame:0,mode:input.mode};
  }else if(input.action==="render-raw"){
    task={action:input.action,values:input.values,config:input.config,mode:input.mode,levels:input.levels,autoStretch:input.autoStretch,blackLevel:input.blackLevel,gain:input.gain};
  }
  const status=activity(name);
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL("./image-worker.ts",import.meta.url),{type:"module"});
    const cancel=()=>finish(new Error("解析已取消"));cancellations.add(cancel);
    function finish(error?:Error,result?:T){worker.terminate();cancellations.delete(cancel);status.end();error?reject(error):resolve(result as T);}
    worker.onerror=e=>finish(new Error(e.message));
    worker.onmessage=({data})=>{if(data.error)finish(new Error(data.error));else if("result" in data)finish(undefined,data.result);else status.update(data.percent,data.phase);};
    worker.postMessage(task);
  });
}
