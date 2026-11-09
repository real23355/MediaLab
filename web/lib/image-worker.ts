import {detectYuv,renderYuvFrame} from "./media";
import {detectRaw,decodeRaw,rawLevels,renderRawPreview,bytesForRawFrame} from "./raw";
self.onmessage = async ({data:t}) => {
  const progress = (percent:number,phase:string) => self.postMessage({percent,phase});
  try {
    let result;
    if (t.file && t.action.startsWith("parse-")) {
      t.bytes = new Uint8Array(await new Promise<ArrayBuffer>((resolve,reject)=>{
        const reader = new FileReader();reader.onprogress=e=>progress(e.lengthComputable?e.loaded/e.total*40:0,"读取文件");
        reader.onload=()=>resolve(reader.result as ArrayBuffer);reader.onerror=()=>reject(reader.error);reader.readAsArrayBuffer(t.file);
      }));
    }
    if(t.action === "parse-yuv") result = {bytes:t.bytes,candidates:detectYuv(t.bytes,t.file.name)};
    if(t.action === "parse-raw") {
      const config=t.config||detectRaw(t.bytes.subarray(0,2*1024*1024),t.bytes.length,t.file.name);
      if(!t.config && (config.needsManual || bytesForRawFrame(config.width,config.height,config.bitDepth,config.packing)!==t.bytes.length)){
        self.postMessage({percent:100,result:{needsConfig:true,bytes:t.bytes,config}},{transfer:[t.bytes.buffer]});
        return;
      }
      const values=decodeRaw(t.bytes,config,p=>progress(40+p*.4,"解包 RAW"));progress(85,"统计 RAW");
      result={bytes:t.bytes,config,values,levels:rawLevels(values,config.bitDepth)};
    }
    if(t.action === "render-yuv")result=renderYuvFrame(t.bytes,t.config,t.frame,t.mode,p=>progress(p,"渲染 YUV"));
    if(t.action === "render-raw")result=renderRawPreview(t.values,t.config,t.mode,t.levels,t.autoStretch,t.blackLevel,t.gain,p=>progress(p,"渲染 RAW"));
    const buffers:Transferable[]=[];
    if(result && "data" in result) buffers.push(result.data.buffer);
    if(result && "bytes" in result) buffers.push(result.bytes.buffer);
    if(result && "values" in result) buffers.push(result.values.buffer);
    self.postMessage({percent:100,result},{transfer:buffers});
  }catch(e){self.postMessage({error:e instanceof Error?e.message:String(e)});}
};
