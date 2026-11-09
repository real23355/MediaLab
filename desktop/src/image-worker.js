self.window = self;
importScripts("media.js", "raw.js");
self.onmessage = ({data:t}) => {
  const progress = (percent, phase) => postMessage({percent, phase});
  try {
    let result;
    if (t.action === "detect-yuv") result = MediaTools.detectYuv(t.bytes, t.size, t.name);
    if (t.action === "parse-raw") {
      const config = t.config || RawTools.detect(t.bytes.subarray(0, 2*1024*1024), t.bytes.length, t.name);
      const values = RawTools.decode(t.bytes,config,p=>progress(p*.8,"解包 RAW"));
      progress(85,"统计 RAW");
      result = {config,values,levels:RawTools.levels(values,config.bitDepth)};
    }
    if (t.action === "render-yuv") result = MediaTools.renderYuv(t.bytes,t.config.width,t.config.height,t.config.format,t.mode,t.config,p=>progress(p,"渲染 YUV"));
    if (t.action === "render-raw") result = RawTools.render(t.values,t.config,t.mode,t.levels,t.autoStretch,t.blackLevel,t.gain,p=>progress(p,"渲染 RAW"));
    postMessage({percent:100,phase:"完成",result}, result?.data?.buffer instanceof ArrayBuffer ? [result.data.buffer] : result?.values?.buffer instanceof ArrayBuffer ? [result.values.buffer] : []);
  } catch(e) { postMessage({error:e.message}); }
};
