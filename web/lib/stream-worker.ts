import { analyzeStream } from "./media";

// One worker per parse: returning home terminates both reading and analysis.
self.onmessage = async ({ data }: MessageEvent<{ file: File; kind: "h264" | "h265" }>) => {
  try {
    const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onprogress = event => self.postMessage({ percent: event.lengthComputable ? event.loaded / event.total * 30 : 0, phase: "读取文件" });
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(data.file);
    });
    const bytes = new Uint8Array(buffer);
    const analysis = analyzeStream(bytes, data.kind, percent => self.postMessage({ percent: 30 + percent * .7, phase: "分析帧结构" }));
    self.postMessage({ percent: 100, phase: "完成", bytes, analysis }, { transfer: [buffer] });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : "文件解析失败" });
  }
};
