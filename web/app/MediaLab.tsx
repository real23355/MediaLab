"use client";

import {
  analyzeStream,
  bytesForYuvFrame,
  detectKind,
  detectYuv,
  formatBytes,
  renderYuvFrame,
  type MediaKind,
  type StreamAnalysis,
  type YuvCandidate,
  type YuvFormat,
  YUV_FORMATS,
} from "../lib/media";
import { decodeHeicWithWebCodecs } from "../lib/heic";
import {
  BAYER_PATTERNS,
  RAW_PACKINGS,
  bayerChannel,
  bytesForRawFrame,
  decodeRaw,
  detectRaw,
  rawLevels,
  renderRawPreview,
  type BayerPattern,
  type RawConfig,
  type RawLevels,
  type RawPacking,
  type RawViewMode,
} from "../lib/raw";
import {
  type ChangeEvent,
  type DragEvent,
  type PointerEvent,
  type ReactNode,
  type WheelEvent,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";

declare global {
  interface Window {
    heic2any?: (options: {
      blob: Blob;
      toType?: string;
      quality?: number;
      multiple?: boolean;
    }) => Promise<Blob | Blob[]>;
  }
}

const VERSION = "V0.0.6";
const PAGE_SIZE = 100;
const IMAGE_LIMIT = 10;
const TOTAL_FILE_LIMIT = Math.floor(4.2 * 1024 * 1024 * 1024);

const KIND_OPTIONS: Array<{
  value: MediaKind;
  label: string;
  extension: string;
}> = [
  { value: "yuv", label: "YUV 原始图像", extension: ".yuv / .syuv" },
  { value: "raw", label: "Bayer RAW 图像", extension: ".raw" },
  { value: "heic", label: "HEIC 图片", extension: ".heic / .heif" },
  { value: "image", label: "RGB / 普通图片", extension: ".png / .jpg / .bmp / .webp" },
  { value: "h264", label: "H.264 裸码流", extension: ".264 / .h264 / .avc" },
  { value: "h265", label: "H.265 裸码流", extension: ".265 / .h265 / .hevc" },
];

type PendingItem = {
  id: string;
  file: File;
  kind: MediaKind;
};

type YuvDocument = {
  id: string;
  kind: "yuv";
  file: File;
  bytes: Uint8Array;
  candidates: YuvCandidate[];
  config: YuvCandidate;
  frame: number;
  fps: number;
};

type HeicDocument = {
  id: string;
  kind: "heic" | "image";
  file: File;
  url: string;
  width: number;
  height: number;
};

type RawDocument = {
  id: string;
  kind: "raw";
  file: File;
  bytes: Uint8Array;
  values: Uint16Array;
  config: RawConfig;
  levels: RawLevels;
  mode: RawViewMode;
  autoStretch: boolean;
  blackLevel: number;
  gain: number;
};

type ImageDocument = YuvDocument | RawDocument | HeicDocument;

type StreamDocument = {
  id: string;
  kind: "h264" | "h265";
  file: File;
  bytes: Uint8Array;
  analysis: StreamAnalysis;
  fps: number;
};

type ViewSyncState = {
  zoom: number;
  centerX: number;
  centerY: number;
  mode: "manual" | "fit";
  sourceId: string;
  revision: number;
};

type CompareStreamHandle = {
  play: () => void;
  pause: () => void;
  seekTime: (seconds: number) => void;
  step: (delta: number) => void;
  currentTime: () => number;
};

const isVideoKind = (kind: MediaKind) => kind === "h264" || kind === "h265";

function uid(file: File, index = 0) {
  return `${file.name}-${file.size}-${file.lastModified}-${index}`;
}

function fileDate(file: File) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(file.lastModified));
}

function confidence(index: number, candidate: YuvCandidate, best?: YuvCandidate) {
  if (index === 0 && candidate.score > 70) return "高";
  if (index === 0 || (best && best.score - candidate.score < 5)) return "中";
  return "备选";
}

function loadImageSize(url: string) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({
      width: image.naturalWidth,
      height: image.naturalHeight,
    });
    image.onerror = () => reject(new Error("转换后的 HEIC 图像无法读取"));
    image.src = url;
  });
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export default function MediaLab() {
  const fileInput = useRef<HTMLInputElement>(null);
  const yuvCanvas = useRef<HTMLCanvasElement>(null);
  const rawCanvas = useRef<HTMLCanvasElement>(null);
  const streamCanvas = useRef<HTMLCanvasElement>(null);
  const decoder = useRef<VideoDecoder | null>(null);
  const playbackTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const decodeRun = useRef(0);

  const [pendingItems, setPendingItems] = useState<PendingItem[]>([]);
  const [imageDocs, setImageDocs] = useState<ImageDocument[]>([]);
  const [activeDocId, setActiveDocId] = useState("");
  const [streamDocs, setStreamDocs] = useState<StreamDocument[]>([]);
  const [activeStreamId, setActiveStreamId] = useState("");
  const [compareMode, setCompareMode] = useState(false);
  const [leftId, setLeftId] = useState("");
  const [rightId, setRightId] = useState("");
  const [syncView, setSyncView] = useState(true);
  const [syncPlayback, setSyncPlayback] = useState(true);
  const [viewSyncState, setViewSyncState] = useState<ViewSyncState | null>(null);
  const [streamFile, setStreamFile] = useState<File | null>(null);
  const [streamBytes, setStreamBytes] = useState<Uint8Array | null>(null);
  const [stream, setStream] = useState<StreamAnalysis | null>(null);
  const [streamFrame, setStreamFrame] = useState(0);
  const [streamPlaying, setStreamPlaying] = useState(false);
  const [decoderSupport, setDecoderSupport] = useState<
    "checking" | "supported" | "unsupported"
  >("checking");
  const [tablePage, setTablePage] = useState(0);
  const [streamFps, setStreamFps] = useState(25);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const activeDoc = imageDocs.find((doc) => doc.id === activeDocId) ?? imageDocs[0];
  const activeStreamDoc = streamDocs.find((doc) => doc.id === activeStreamId) ?? streamDocs[0];
  const workspaceKind = imageDocs.length ? "image" : streamDocs.length ? "video" : null;
  const leftImage = imageDocs.find((doc) => doc.id === leftId) ?? imageDocs[0];
  const rightImage = imageDocs.find((doc) => doc.id === rightId) ?? imageDocs[1];
  const leftStream = streamDocs.find((doc) => doc.id === leftId) ?? streamDocs[0];
  const rightStream = streamDocs.find((doc) => doc.id === rightId) ?? streamDocs[1];
  const leftVideoRef = useRef<CompareStreamHandle>(null);
  const rightVideoRef = useRef<CompareStreamHandle>(null);

  useEffect(() => {
    const docs = imageDocs.length ? imageDocs : streamDocs;
    if (!docs.length) return;
    if (!docs.some((doc) => doc.id === leftId)) setLeftId(docs[0].id);
    if (!docs.some((doc) => doc.id === rightId) || (docs.length > 1 && rightId === leftId)) {
      setRightId(docs[1]?.id ?? docs[0].id);
    }
  }, [imageDocs, leftId, rightId, streamDocs]);

  useEffect(() => {
    if (!compareMode || !syncPlayback || workspaceKind !== "video") return;
    const timer = setInterval(() => {
      const leftTime = leftVideoRef.current?.currentTime();
      const rightTime = rightVideoRef.current?.currentTime();
      if (leftTime == null || rightTime == null) return;
      if (Math.abs(leftTime - rightTime) > 0.1) rightVideoRef.current?.seekTime(leftTime);
    }, 750);
    return () => clearInterval(timer);
  }, [compareMode, syncPlayback, workspaceKind]);

  const stopStreamPlayback = useCallback(() => {
    if (playbackTimer.current) clearInterval(playbackTimer.current);
    playbackTimer.current = null;
    decodeRun.current += 1;
    try {
      decoder.current?.close();
    } catch {
      // Decoder may already be closed after an error.
    }
    decoder.current = null;
    setStreamPlaying(false);
  }, []);

  const activateStream = useCallback((doc: StreamDocument) => {
    stopStreamPlayback();
    setActiveStreamId(doc.id);
    setStreamFile(doc.file);
    setStreamBytes(doc.bytes);
    setStream(doc.analysis);
    setStreamFps(doc.fps);
    setStreamFrame(0);
    setTablePage(0);
  }, [stopStreamPlayback]);

  const returnHome = useCallback(() => {
    stopStreamPlayback();
    imageDocs.forEach((doc) => {
      if (doc.kind === "heic" || doc.kind === "image") URL.revokeObjectURL(doc.url);
    });
    setPendingItems([]);
    setImageDocs([]);
    setActiveDocId("");
    setStreamDocs([]);
    setActiveStreamId("");
    setCompareMode(false);
    setLeftId("");
    setRightId("");
    setViewSyncState(null);
    setStreamFile(null);
    setStreamBytes(null);
    setStream(null);
    setStreamFrame(0);
    setTablePage(0);
    setError("");
  }, [imageDocs, stopStreamPlayback]);

  useEffect(() => () => stopStreamPlayback(), [stopStreamPlayback]);

  const receiveFiles = (incoming: File[]) => {
    if (!incoming.length) return;
    const detected = incoming.map((file) => ({ file, kind: detectKind(file) }));
    const incomingMajor = isVideoKind(detected[0].kind) ? "video" : "image";
    if (detected.some((item) => (isVideoKind(item.kind) ? "video" : "image") !== incomingMajor)) {
      setError("请不要同时拖入图片与视频；请先建立一种媒体类型的工作区。");
      return;
    }
    if (workspaceKind && workspaceKind !== incomingMajor) {
      setError(workspaceKind === "image"
        ? "当前工作区为图片对比模式，只能添加图片类文件"
        : "当前工作区为视频对比模式，只能添加 H.264/H.265 视频文件");
      return;
    }
    const known = new Set([
      ...pendingItems.map((item) => uid(item.file)),
      ...imageDocs.map((doc) => uid(doc.file)),
      ...streamDocs.map((doc) => uid(doc.file)),
    ]);
    let accepted = detected.filter((item) => !known.has(uid(item.file)));
    if (!accepted.length) {
      setError("这些文件已经在当前工作区中。");
      return;
    }
    if (incomingMajor === "image") {
      const remaining = Math.max(0, IMAGE_LIMIT - imageDocs.length - pendingItems.length);
      if (accepted.length > remaining) {
        setError(`图片类文件最多 ${IMAGE_LIMIT} 个，已保留可加入的前 ${remaining} 个。`);
        accepted = accepted.slice(0, remaining);
      }
    }
    const existingBytes = [...imageDocs, ...streamDocs].reduce((sum, doc) => sum + doc.file.size, 0)
      + pendingItems.reduce((sum, item) => sum + item.file.size, 0);
    const acceptedBytes = accepted.reduce((sum, item) => sum + item.file.size, 0);
    if (existingBytes + acceptedBytes > TOTAL_FILE_LIMIT) {
      setError("加入后文件总量将超过 4.2 GB 限制，请减少文件数量。");
      return;
    }
    setPendingItems((items) => [
      ...items,
      ...accepted.map((item, index) => ({
        id: `${uid(item.file, index)}-${Date.now()}-${index}`,
        file: item.file,
        kind: item.kind,
      })),
    ]);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    receiveFiles(Array.from(event.dataTransfer.files));
  };

  const onPick = (event: ChangeEvent<HTMLInputElement>) => {
    receiveFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
  };

  const parsePending = async () => {
    if (!pendingItems.length) return;
    const streamItems = pendingItems.filter(
      (item) => item.kind === "h264" || item.kind === "h265",
    );
    const pendingMajor = streamItems.length ? "video" : "image";
    if (streamItems.length !== 0 && streamItems.length !== pendingItems.length) {
      setError("同一批次不能混合图片与视频文件。");
      return;
    }
    if (workspaceKind && workspaceKind !== pendingMajor) {
      setError(workspaceKind === "image"
        ? "当前工作区为图片对比模式，只能添加图片类文件"
        : "当前工作区为视频对比模式，只能添加 H.264/H.265 视频文件");
      return;
    }
    if (!streamItems.length && imageDocs.length + pendingItems.length > IMAGE_LIMIT) {
      setError(`YUV / RAW / HEIC 一次最多解析 ${IMAGE_LIMIT} 个文件。`);
      return;
    }

    setBusy(true);
    setError("");
    try {
      if (streamItems.length) {
        const docs: StreamDocument[] = [];
        for (const item of streamItems) {
          const data = new Uint8Array(await item.file.arrayBuffer());
          const analysis = analyzeStream(data, item.kind as "h264" | "h265");
          docs.push({
            id: item.id,
            kind: item.kind as "h264" | "h265",
            file: item.file,
            bytes: data,
            analysis,
            fps: 25,
          });
        }
        setStreamDocs((current) => [...current, ...docs]);
        activateStream(docs[0]);
        setLeftId((value) => value || streamDocs[0]?.id || docs[0]?.id || "");
        setRightId((value) => value || streamDocs[1]?.id || docs[1]?.id || docs[0]?.id || "");
        setPendingItems([]);
        return;
      }

      const docs: ImageDocument[] = [];
      for (const item of pendingItems) {
        if (item.kind === "yuv") {
          const data = new Uint8Array(await item.file.arrayBuffer());
          const candidates = detectYuv(data, item.file.name);
          const fallbackBytes = bytesForYuvFrame(1920, 1080, "I420");
          const config = candidates[0] ?? {
            width: 1920,
            height: 1080,
            format: "I420" as const,
            frameBytes: fallbackBytes,
            frameCount: Math.max(1, Math.floor(data.byteLength / fallbackBytes)),
            dataOffset: 0,
            score: 0,
            reason: "手动配置",
          };
          docs.push({
            id: item.id,
            kind: "yuv",
            file: item.file,
            bytes: data,
            candidates,
            config,
            frame: 0,
            fps: 25,
          });
        } else if (item.kind === "raw") {
          if (!item.file.size) throw new Error(`${item.file.name} 是空文件。`);
          if (item.file.size > 256 * 1024 * 1024) {
            throw new Error(`${item.file.name} 超过 256 MB，当前浏览器版本拒绝一次性解码。`);
          }
          const data = new Uint8Array(await item.file.arrayBuffer());
          const config = detectRaw(data.subarray(0, Math.min(data.byteLength, 2 * 1024 * 1024)), data.byteLength, item.file.name);
          const values = decodeRaw(data, config);
          docs.push({
            id: item.id,
            kind: "raw",
            file: item.file,
            bytes: data,
            values,
            config,
            levels: rawLevels(values, config.bitDepth),
            mode: "rgb",
            autoStretch: true,
            blackLevel: 0,
            gain: 1,
          });
        } else if (item.kind === "heic") {
          const bytes = new Uint8Array(await item.file.arrayBuffer());
          let blob: Blob;
          let decodedSize: { width: number; height: number } | undefined;
          try {
            const decoded = await withTimeout(
              decodeHeicWithWebCodecs(bytes),
              15_000,
              "浏览器 H.265 解码超时",
            );
            blob = decoded.blob;
            decodedSize = decoded;
          } catch (nativeError) {
            if (!window.heic2any) {
              throw nativeError instanceof Error
                ? nativeError
                : new Error("当前浏览器无法解码此 HEIC 文件");
            }
            const converted = await withTimeout(
              window.heic2any({
                blob: item.file,
                toType: "image/png",
              }),
              20_000,
              "HEIC 解码超过 20 秒，已停止等待。建议使用 Windows 便携版解析该文件。",
            );
            blob = Array.isArray(converted) ? converted[0] : converted;
          }
          const url = URL.createObjectURL(blob);
          const size = decodedSize ?? await loadImageSize(url);
          docs.push({
            id: item.id,
            kind: "heic",
            file: item.file,
            url,
            ...size,
          });
        } else {
          const url = URL.createObjectURL(item.file);
          const size = await loadImageSize(url);
          docs.push({ id: item.id, kind: "image", file: item.file, url, ...size });
        }
      }
      setImageDocs((current) => [...current, ...docs]);
      setActiveDocId(docs[0]?.id ?? "");
      setLeftId((value) => value || imageDocs[0]?.id || docs[0]?.id || "");
      setRightId((value) => value || imageDocs[1]?.id || docs[1]?.id || docs[0]?.id || "");
      setPendingItems([]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "文件解析失败");
    } finally {
      setBusy(false);
    }
  };

  const updateYuvDoc = useCallback(
    (id: string, update: (doc: YuvDocument) => YuvDocument) => {
      setImageDocs((docs) =>
        docs.map((doc) => (doc.id === id && doc.kind === "yuv" ? update(doc) : doc)),
      );
    },
    [],
  );

  const updateRawDoc = useCallback(
    (id: string, update: (doc: RawDocument) => RawDocument) => {
      setImageDocs((docs) =>
        docs.map((doc) => (doc.id === id && doc.kind === "raw" ? update(doc) : doc)),
      );
    },
    [],
  );

  useEffect(() => {
    if (!activeDoc || activeDoc.kind !== "yuv" || !yuvCanvas.current) return;
    const canvas = yuvCanvas.current;
    canvas.width = activeDoc.config.width;
    canvas.height = activeDoc.config.height;
    try {
      const image = renderYuvFrame(activeDoc.bytes, activeDoc.config, activeDoc.frame);
      canvas.getContext("2d", { alpha: false })?.putImageData(image, 0, 0);
    } catch {
      setError("当前参数超出了文件范围，请检查分辨率、格式或 SYUV 文件头。");
    }
  }, [activeDoc]);

  useEffect(() => {
    if (!activeDoc || activeDoc.kind !== "raw" || !rawCanvas.current) return;
    const canvas = rawCanvas.current;
    canvas.width = activeDoc.config.width;
    canvas.height = activeDoc.config.height;
    try {
      const image = renderRawPreview(
        activeDoc.values,
        activeDoc.config,
        activeDoc.mode,
        activeDoc.levels,
        activeDoc.autoStretch,
        activeDoc.blackLevel,
        activeDoc.gain,
      );
      canvas.getContext("2d", { alpha: false })?.putImageData(image, 0, 0);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "RAW 预览生成失败");
    }
  }, [activeDoc]);

  useEffect(() => {
    if (!stream || typeof VideoDecoder === "undefined") {
      setDecoderSupport("unsupported");
      return;
    }
    let active = true;
    setDecoderSupport("checking");
    VideoDecoder.isConfigSupported({
      codec: stream.codecString,
      optimizeForLatency: true,
    })
      .then((result) => active && setDecoderSupport(result.supported ? "supported" : "unsupported"))
      .catch(() => active && setDecoderSupport("unsupported"));
    return () => {
      active = false;
    };
  }, [stream]);

  const drawVideoFrame = useCallback((videoFrame: VideoFrame) => {
    const canvas = streamCanvas.current;
    if (!canvas) {
      videoFrame.close();
      return;
    }
    canvas.width = videoFrame.displayWidth;
    canvas.height = videoFrame.displayHeight;
    canvas.getContext("2d", { alpha: false })?.drawImage(videoFrame, 0, 0);
    videoFrame.close();
  }, []);

  const makeDecoder = useCallback(
    (minimumFrame: number, run: number) => {
      if (!stream) return null;
      const nextDecoder = new VideoDecoder({
        output: (videoFrame) => {
          if (run !== decodeRun.current) {
            videoFrame.close();
            return;
          }
          const index = Math.round((videoFrame.timestamp * streamFps) / 1_000_000);
          if (index >= minimumFrame) {
            drawVideoFrame(videoFrame);
            setStreamFrame(Math.min(index, stream.frames.length - 1));
          } else {
            videoFrame.close();
          }
        },
        error: (decodeError) => {
          setError(`浏览器解码失败：${decodeError.message}`);
          stopStreamPlayback();
        },
      });
      nextDecoder.configure({
        codec: stream.codecString,
        optimizeForLatency: true,
      });
      decoder.current = nextDecoder;
      return nextDecoder;
    },
    [drawVideoFrame, stopStreamPlayback, stream, streamFps],
  );

  const chunkForFrame = useCallback(
    (index: number) => {
      if (!stream || !streamBytes) return null;
      const frame = stream.frames[index];
      if (!frame) return null;
      return new EncodedVideoChunk({
        type: frame.key ? "key" : "delta",
        timestamp: Math.round((index * 1_000_000) / streamFps),
        duration: Math.round(1_000_000 / streamFps),
        data: streamBytes.slice(frame.start, frame.end),
      });
    },
    [stream, streamBytes, streamFps],
  );

  const showEncodedFrame = useCallback(
    async (target: number) => {
      if (!stream || !streamBytes || decoderSupport !== "supported") return;
      stopStreamPlayback();
      const run = ++decodeRun.current;
      const nextDecoder = makeDecoder(target, run);
      if (!nextDecoder) return;
      setError("");
      try {
        for (let index = 0; index <= target; index += 1) {
          const chunk = chunkForFrame(index);
          if (chunk) nextDecoder.decode(chunk);
          if (nextDecoder.decodeQueueSize > 60) await nextDecoder.flush();
        }
        await nextDecoder.flush();
      } catch (caught) {
        setError(caught instanceof Error ? `无法显示该帧：${caught.message}` : "无法显示该帧");
      } finally {
        if (run === decodeRun.current) {
          try {
            nextDecoder.close();
          } catch {
            // Decoder can be closed by its error callback.
          }
          decoder.current = null;
        }
      }
    },
    [chunkForFrame, decoderSupport, makeDecoder, stopStreamPlayback, stream, streamBytes],
  );

  const selectStreamFrame = useCallback(
    (index: number) => {
      setStreamFrame(index);
      setTablePage(Math.floor(index / PAGE_SIZE));
      showEncodedFrame(index);
    },
    [showEncodedFrame],
  );

  const startStreamPlayback = useCallback(() => {
    if (!stream || !streamBytes || decoderSupport !== "supported") return;
    stopStreamPlayback();
    const start = streamFrame >= stream.frames.length - 1 ? 0 : streamFrame;
    const run = ++decodeRun.current;
    const nextDecoder = makeDecoder(start, run);
    if (!nextDecoder) return;
    setStreamPlaying(true);
    for (let index = 0; index <= start; index += 1) {
      const chunk = chunkForFrame(index);
      if (chunk) nextDecoder.decode(chunk);
    }
    let next = start + 1;
    playbackTimer.current = setInterval(() => {
      if (next >= stream.frames.length) {
        stopStreamPlayback();
        return;
      }
      const chunk = chunkForFrame(next);
      if (chunk) nextDecoder.decode(chunk);
      next += 1;
    }, 1000 / Math.max(1, streamFps));
  }, [
    chunkForFrame,
    decoderSupport,
    makeDecoder,
    stopStreamPlayback,
    stream,
    streamBytes,
    streamFps,
    streamFrame,
  ]);

  const updateYuvConfig = (field: "width" | "height" | "format", value: string) => {
    if (!activeDoc || activeDoc.kind !== "yuv") return;
    updateYuvDoc(activeDoc.id, (doc) => {
      const width = field === "width" ? Math.max(1, Number(value)) : doc.config.width;
      const height = field === "height" ? Math.max(1, Number(value)) : doc.config.height;
      const format = field === "format" ? (value as YuvFormat) : doc.config.format;
      const frameBytes = bytesForYuvFrame(width, height, format);
      return {
        ...doc,
        frame: 0,
        config: {
          ...doc.config,
          width,
          height,
          format,
          frameBytes,
          frameCount: Math.max(
            1,
            Math.floor((doc.bytes.byteLength - doc.config.dataOffset) / frameBytes),
          ),
          reason: "手动调整",
        },
      };
    });
  };

  const updateRawConfig = (
    field: "width" | "height" | "bitDepth" | "bayer" | "packing",
    value: string,
  ) => {
    if (!activeDoc || activeDoc.kind !== "raw") return;
    try {
      const next: RawConfig = {
        ...activeDoc.config,
        width: field === "width" ? Math.max(1, Number(value)) : activeDoc.config.width,
        height: field === "height" ? Math.max(1, Number(value)) : activeDoc.config.height,
        bitDepth: field === "bitDepth" ? Math.max(1, Number(value)) : activeDoc.config.bitDepth,
        bayer: field === "bayer" ? (value as BayerPattern) : activeDoc.config.bayer,
        packing: field === "packing" ? (value as RawPacking) : activeDoc.config.packing,
        frameBytes: 0,
        reason: "手动调整",
      };
      next.frameBytes = bytesForRawFrame(next.width, next.height, next.bitDepth, next.packing);
      const values = decodeRaw(activeDoc.bytes, next);
      updateRawDoc(activeDoc.id, (doc) => ({
        ...doc,
        config: next,
        values,
        levels: rawLevels(values, next.bitDepth),
      }));
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "RAW 参数无效");
    }
  };

  const chartFrames = useMemo(() => {
    if (!stream?.frames.length) return [];
    const slots = Math.min(180, stream.frames.length);
    return Array.from({ length: slots }, (_, slot) => {
      const start = Math.floor((slot * stream.frames.length) / slots);
      const end = Math.max(start + 1, Math.floor(((slot + 1) * stream.frames.length) / slots));
      const group = stream.frames.slice(start, end);
      const largest = group.reduce((best, frame) => (frame.size > best.size ? frame : best));
      return { ...largest, rangeStart: start, rangeEnd: end };
    });
  }, [stream]);

  const tableFrames = useMemo(
    () => stream?.frames.slice(tablePage * PAGE_SIZE, tablePage * PAGE_SIZE + PAGE_SIZE) ?? [],
    [stream, tablePage],
  );

  const duration = stream ? stream.frames.length / Math.max(1, streamFps) : 0;
  const bitrate = streamFile && duration ? (streamFile.size * 8) / duration : 0;
  const maxChartSize = stream?.maxFrameSize || 1;
  const selectedFrame = stream?.frames[streamFrame];
  const yTicks = [1, 0.75, 0.5, 0.25, 0];
  const compareCount = workspaceKind === "image" ? imageDocs.length : streamDocs.length;
  const hasContent = pendingItems.length > 0 || imageDocs.length > 0 || streamDocs.length > 0 || Boolean(stream);

  return (
    <main>
      <header className="topbar">
        <button className="brand brand-button" type="button" onClick={returnHome}>
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <span>MediaLab——视频码流与图像分析工具</span>
          <b>{VERSION}</b>
        </button>
        {hasContent && <div className="topbar-actions">
          {workspaceKind && <button className="button subtle" type="button" onClick={() => fileInput.current?.click()}>
            ＋ 追加文件
          </button>}
          {compareCount >= 2 && <button className={`button ${compareMode ? "primary" : "subtle"}`} type="button" onClick={() => setCompareMode((value) => !value)}>
            {compareMode ? "退出 Compare" : "Compare"}
          </button>}
          <button className="button subtle" type="button" onClick={returnHome}>返回首页</button>
        </div>}
      </header>

      {!hasContent && (
        <section className="landing">
          <div className="hero-copy">
            <h1>MediaLab<br /><span>视频码流与图像分析工具</span></h1>
            <p className="hero-description">
              支持 YUV / SYUV、Bayer RAW、HEIC、RGB 图片与 H.264 / H.265 裸码流；图像可批量解析，
              码流可播放并逐帧诊断。
            </p>
            <div className="feature-row">
              <span>✓ YUV / RAW 专业缩放与像素检查</span>
              <span>✓ 逐帧大小与极值</span>
              <span>✓ 当前播放帧醒目标记</span>
            </div>
          </div>
          <DropZone
            dragging={dragging}
            setDragging={setDragging}
            onDrop={onDrop}
            onBrowse={() => fileInput.current?.click()}
          />
        </section>
      )}

      {pendingItems.length > 0 && (
        <section className="kind-picker shell">
          <div className="picker-copy">
            <h2>确认每个文件的解析方式</h2>
            <p>类型选项位于文件名右侧。图片最多 10 个；视频可追加多个；文件总量上限 4.2 GB。</p>
          </div>
          <div className="pending-list">
            {pendingItems.map((item, index) => (
              <div className="pending-row" key={item.id}>
                <span className="file-icon">{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <strong title={item.file.name}>{item.file.name}</strong>
                  <small>{formatBytes(item.file.size)} · {fileDate(item.file)}</small>
                </div>
                <label>
                  <span>解析选项</span>
                  <select
                    value={item.kind}
                    onChange={(event) =>
                      setPendingItems((items) =>
                        items.map((entry) =>
                          entry.id === item.id
                            ? { ...entry, kind: event.target.value as MediaKind }
                            : entry,
                        ),
                      )
                    }
                  >
                    {KIND_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ))}
          </div>
          <button className="button primary parse-button" type="button" disabled={busy} onClick={parsePending}>
            {busy ? "正在解析…" : `开始解析 ${pendingItems.length} 个文件`}
          </button>
        </section>
      )}

      {imageDocs.length > 0 && (
        <section className="workspace shell image-workspace" onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
          <FileTabs
            docs={imageDocs}
            activeId={activeDoc?.id ?? ""}
            leftId={leftId}
            rightId={rightId}
            onSelect={setActiveDocId}
            onLeft={setLeftId}
            onRight={setRightId}
            onAdd={() => fileInput.current?.click()}
          />
          {compareMode && leftImage && rightImage ? (
            <div className="compare-content">
              <div className="compare-toolbar panel">
                <strong>Compare 图片对比</strong>
                <label><input type="checkbox" checked={syncView} onChange={(event) => setSyncView(event.target.checked)} /> Sync View</label>
                <span>{syncView ? "Zoom / Pan / Fit / 100% 联动" : "左右视图独立"}</span>
              </div>
              <div className="compare-grid image-compare-grid">
                <CompareImageViewer
                  side="Left"
                  doc={leftImage}
                  syncState={syncView ? viewSyncState : null}
                  onViewChange={(next) => syncView && setViewSyncState(next)}
                />
                <CompareImageViewer
                  side="Right"
                  doc={rightImage}
                  syncState={syncView ? viewSyncState : null}
                  onViewChange={(next) => syncView && setViewSyncState(next)}
                />
              </div>
            </div>
          ) : activeDoc ? (
          <div className="image-content">
            <FileSummary
              file={activeDoc.file}
              kind={activeDoc.kind === "yuv" ? "YUV / SYUV" : activeDoc.kind === "raw" ? "Bayer RAW" : activeDoc.kind === "heic" ? "HEIC" : "RGB 图片"}
            />
            {activeDoc.kind === "yuv" ? (
              <YuvViewer
                doc={activeDoc}
                canvasRef={yuvCanvas}
                onConfig={updateYuvConfig}
                onCandidate={(candidate) =>
                  updateYuvDoc(activeDoc.id, (doc) => ({ ...doc, config: candidate, frame: 0 }))
                }
                onFrame={(frame) =>
                  updateYuvDoc(activeDoc.id, (doc) => ({ ...doc, frame }))
                }
                onFps={(fps) =>
                  updateYuvDoc(activeDoc.id, (doc) => ({ ...doc, fps }))
                }
              />
            ) : activeDoc.kind === "raw" ? (
              <RawViewer
                doc={activeDoc}
                canvasRef={rawCanvas}
                onConfig={updateRawConfig}
                onUpdate={(update) => updateRawDoc(activeDoc.id, update)}
              />
            ) : (
              <HeicViewer doc={activeDoc} />
            )}
          </div>
          ) : null}
        </section>
      )}

      {stream && streamFile && streamBytes && (
        <section className="workspace shell stream-workspace" onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
          <StreamTabs
            docs={streamDocs}
            activeId={activeStreamDoc?.id ?? ""}
            leftId={leftId}
            rightId={rightId}
            onSelect={activateStream}
            onLeft={setLeftId}
            onRight={setRightId}
            onAdd={() => fileInput.current?.click()}
          />
          {compareMode && leftStream && rightStream && <div className="compare-content video-compare-content">
            <div className="compare-toolbar panel">
              <strong>Compare 视频对比</strong>
              <button type="button" className="button primary" onClick={() => {
                leftVideoRef.current?.play();
                rightVideoRef.current?.play();
              }}>▶ Play Both</button>
              <button type="button" className="button subtle" onClick={() => {
                leftVideoRef.current?.pause();
                rightVideoRef.current?.pause();
              }}>Ⅱ Pause Both</button>
              <label><input type="checkbox" checked={syncPlayback} onChange={(event) => setSyncPlayback(event.target.checked)} /> Sync Playback</label>
            </div>
            <div className="compare-grid video-compare-grid">
              <CompareStreamViewer
                ref={leftVideoRef}
                side="Left"
                doc={leftStream}
                onSeek={(seconds) => syncPlayback && rightVideoRef.current?.seekTime(seconds)}
                onStep={(delta) => syncPlayback && Math.abs(leftStream.fps - rightStream.fps) < 0.01 && rightVideoRef.current?.step(delta)}
              />
              <CompareStreamViewer
                ref={rightVideoRef}
                side="Right"
                doc={rightStream}
                onSeek={(seconds) => syncPlayback && leftVideoRef.current?.seekTime(seconds)}
                onStep={(delta) => syncPlayback && Math.abs(leftStream.fps - rightStream.fps) < 0.01 && leftVideoRef.current?.step(delta)}
              />
            </div>
          </div>}
          <FileSummary file={streamFile} kind={stream.codecLabel} />
          <div className="stream-stats">
            <Metric label="分辨率" value={stream.width ? `${stream.width} × ${stream.height}` : "未读出"} />
            <Metric label="编码帧" value={stream.frames.length.toLocaleString("zh-CN")} />
            <Metric label="I 帧" value={stream.keyframes.toLocaleString("zh-CN")} />
            <Metric label="最大帧" value={formatBytes(stream.maxFrameSize)} />
            <Metric label="最小帧" value={formatBytes(stream.minFrameSize)} />
            <Metric label="估算时长" value={formatDuration(duration)} />
          </div>

          <div className="stream-layout">
            <div className="viewer panel">
              <div className="viewer-header">
                <div>
                  <span>解码画面</span>
                  <small>{decoderSupport === "supported" ? "浏览器解码器可用" : "当前浏览器仅支持码流分析"}</small>
                </div>
                <span className={`support-badge ${decoderSupport}`}>
                  {decoderSupport === "supported" ? "可播放" : "仅分析"}
                </span>
              </div>
              <div className="canvas-stage stream-stage">
                <canvas ref={streamCanvas} aria-label="H.26x 解码画面" />
                <div className="current-frame-badge">
                  <span>当前播放帧</span>
                  <strong>#{streamFrame}</strong>
                  <em>{selectedFrame?.type ?? "—"} · {formatBytes(selectedFrame?.size ?? 0)}</em>
                </div>
                {decoderSupport !== "supported" && (
                  <div className="empty-canvas">
                    <b>码流分析已完成</b>
                    <span>当前浏览器不支持该码流的 WebCodecs 解码，逐帧统计仍可使用。</span>
                  </div>
                )}
              </div>
              <PlaybackControls
                playing={streamPlaying}
                frame={streamFrame}
                count={stream.frames.length}
                fps={streamFps}
                disabled={decoderSupport !== "supported"}
                onToggle={() => streamPlaying ? stopStreamPlayback() : startStreamPlayback()}
                onFrame={selectStreamFrame}
                onFps={(fps) => {
                  setStreamFps(fps);
                  if (activeStreamDoc) setStreamDocs((docs) => docs.map((doc) => doc.id === activeStreamDoc.id ? { ...doc, fps } : doc));
                }}
              />
            </div>

            <aside className="bitstream-panel panel">
              <PanelTitle step="02" title="码流信息" subtitle="Annex-B 裸码流结构" />
              <dl className="info-list">
                <div><dt>编码</dt><dd>{stream.codecLabel}</dd></div>
                <div><dt>Codec String</dt><dd>{stream.codecString}</dd></div>
                <div><dt>Profile</dt><dd>{stream.profile ?? "—"}</dd></div>
                <div><dt>Level</dt><dd>{stream.level ?? "—"}</dd></div>
                <div><dt>NAL 单元</dt><dd>{stream.nalCount.toLocaleString("zh-CN")}</dd></div>
                <div><dt>平均帧大小</dt><dd>{formatBytes(stream.averageFrameSize)}</dd></div>
                <div><dt>最大帧大小</dt><dd>{formatBytes(stream.maxFrameSize)}</dd></div>
                <div><dt>最小帧大小</dt><dd>{formatBytes(stream.minFrameSize)}</dd></div>
                <div><dt>估算码率</dt><dd>{bitrate ? `${(bitrate / 1_000_000).toFixed(2)} Mbps` : "—"}</dd></div>
              </dl>
              <div className="nal-list">
                <h3>NAL 分布</h3>
                {stream.nalHistogram.slice(0, 7).map((item) => (
                  <div key={item.type}><span>{item.label}</span><b>{item.count.toLocaleString("zh-CN")}</b></div>
                ))}
              </div>
            </aside>
          </div>

          <div className="frame-analysis panel">
            <div className="section-heading">
              <div><h2>逐帧编码大小</h2></div>
              <div className="legend">
                <span><i className="key-color" /> I 帧</span>
                <span><i className="delta-color" /> P 帧</span>
              </div>
            </div>
            <div className="chart-shell">
              <div className="y-axis" aria-hidden="true">
                {yTicks.map((tick) => (
                  <span key={tick} style={{ bottom: `${tick * 100}%` }}>
                    {formatBytes(maxChartSize * tick)}
                  </span>
                ))}
              </div>
              <div className="frame-chart" aria-label="逐帧编码大小图">
                {chartFrames.map((frame) => (
                  <button
                    type="button"
                    key={`${frame.rangeStart}-${frame.rangeEnd}`}
                    className={`${frame.key ? "key" : "delta"} ${
                      streamFrame >= frame.rangeStart && streamFrame < frame.rangeEnd ? "active" : ""
                    }`}
                    style={{ height: `${Math.max(4, (frame.size / maxChartSize) * 100)}%` }}
                    title={`帧 ${frame.index}: ${formatBytes(frame.size)}`}
                    onClick={() => selectStreamFrame(frame.index)}
                  />
                ))}
              </div>
            </div>
            <div className="chart-axis"><span>帧 0</span><span>帧 {Math.max(0, stream.frames.length - 1)}</span></div>

            <div className="table-toolbar">
              <strong>帧明细</strong>
              <span>第 {tablePage * PAGE_SIZE + 1}–{Math.min((tablePage + 1) * PAGE_SIZE, stream.frames.length)} 帧</span>
              <div>
                <button type="button" disabled={tablePage === 0} onClick={() => setTablePage((page) => Math.max(0, page - 1))}>上一页</button>
                <button type="button" disabled={(tablePage + 1) * PAGE_SIZE >= stream.frames.length} onClick={() => setTablePage((page) => page + 1)}>下一页</button>
              </div>
            </div>
            <div className="frame-table-wrap">
              <table>
                <thead><tr><th>帧号</th><th>类型</th><th>编码大小</th><th>文件偏移</th><th>NAL 类型</th><th /></tr></thead>
                <tbody>
                  {tableFrames.map((frame) => (
                    <tr key={frame.index} className={streamFrame === frame.index ? "selected" : ""}>
                      <td>#{frame.index}</td>
                      <td><span className={`frame-type ${frame.key ? "key" : "delta"}`}>{frame.type}</span></td>
                      <td><b>{formatBytes(frame.size)}</b></td>
                      <td>0x{frame.start.toString(16).toUpperCase().padStart(8, "0")}</td>
                      <td>{frame.nalTypes.join(", ")}</td>
                      <td><button type="button" onClick={() => selectStreamFrame(frame.index)}>定位</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {error && (
        <div className="error-toast" role="alert">
          <b>提示</b><span>{error}</span>
          <button type="button" onClick={() => setError("")}>×</button>
        </div>
      )}

      <input
        ref={fileInput}
        className="visually-hidden"
        type="file"
        multiple
        accept=".yuv,.raw,.syuv,.nv12,.nv21,.heic,.heif,.png,.jpg,.jpeg,.bmp,.webp,.264,.h264,.avc,.265,.h265,.hevc,application/octet-stream,image/*"
        onChange={onPick}
      />
    </main>
  );
}

function FileTabs({
  docs,
  activeId,
  leftId,
  rightId,
  onSelect,
  onLeft,
  onRight,
  onAdd,
}: {
  docs: ImageDocument[];
  activeId: string;
  leftId: string;
  rightId: string;
  onSelect: (id: string) => void;
  onLeft: (id: string) => void;
  onRight: (id: string) => void;
  onAdd: () => void;
}) {
  return (
    <aside className="file-tabs" aria-label="已解析图片">
      <h2>已解析文件</h2>
      {docs.map((doc, index) => <div className={`file-tab-row ${doc.id === activeId ? "active" : ""}`} key={doc.id}>
        <button type="button" className="file-tab-main" onClick={() => onSelect(doc.id)}>
          <b>{String(index + 1).padStart(2, "0")}</b>
          <span title={doc.file.name}>{doc.file.name}</span>
          <em>{doc.kind === "yuv" ? "YUV" : doc.kind === "raw" ? "RAW" : doc.kind === "heic" ? "HEIC" : "RGB"}</em>
        </button>
        <div className="side-assign">
          <button type="button" className={doc.id === leftId ? "selected" : ""} onClick={() => onLeft(doc.id)}>Left</button>
          <button type="button" className={doc.id === rightId ? "selected" : ""} onClick={() => onRight(doc.id)}>Right</button>
        </div>
      </div>)}
      <button type="button" className="add-file-tab" onClick={onAdd}>＋ 拖入或追加文件</button>
    </aside>
  );
}

function StreamTabs({
  docs, activeId, leftId, rightId, onSelect, onLeft, onRight, onAdd,
}: {
  docs: StreamDocument[];
  activeId: string;
  leftId: string;
  rightId: string;
  onSelect: (doc: StreamDocument) => void;
  onLeft: (id: string) => void;
  onRight: (id: string) => void;
  onAdd: () => void;
}) {
  return <aside className="stream-file-tabs panel" aria-label="已解析视频">
    <h2>视频文件</h2>
    <div className="stream-tab-list">
      {docs.map((doc, index) => <div className={`stream-tab-row ${doc.id === activeId ? "active" : ""}`} key={doc.id}>
        <button type="button" className="file-tab-main" onClick={() => onSelect(doc)}>
          <b>{String(index + 1).padStart(2, "0")}</b><span title={doc.file.name}>{doc.file.name}</span><em>{doc.kind.toUpperCase()}</em>
        </button>
        <div className="side-assign">
          <button type="button" className={doc.id === leftId ? "selected" : ""} onClick={() => onLeft(doc.id)}>Left</button>
          <button type="button" className={doc.id === rightId ? "selected" : ""} onClick={() => onRight(doc.id)}>Right</button>
        </div>
      </div>)}
      <button type="button" className="add-file-tab" onClick={onAdd}>＋ 追加 H.264/H.265</button>
    </div>
  </aside>;
}

function ZoomToolbar({
  zoom,
  onZoom,
  onFit,
  onFullscreen,
}: {
  zoom: number;
  onZoom: (zoom: number) => void;
  onFit: () => void;
  onFullscreen: () => void;
}) {
  return (
    <div className="zoom-toolbar" aria-label="图片缩放控制">
      <button type="button" title="缩小" onClick={() => onZoom(zoom / 1.25)}>−</button>
      <select
        className="zoom-value"
        aria-label="当前缩放比例"
        value={Math.round(zoom * 100)}
        onChange={(event) => onZoom(Number(event.target.value) / 100)}
      >
        {[25, 50, 75, 100, 125, 150, 200, 300, 400, 800].map((value) => (
          <option key={value} value={value}>{value}%</option>
        ))}
        {!([25, 50, 75, 100, 125, 150, 200, 300, 400, 800].includes(Math.round(zoom * 100))) && (
          <option value={Math.round(zoom * 100)}>{Math.round(zoom * 100)}%</option>
        )}
      </select>
      <button type="button" title="放大" onClick={() => onZoom(zoom * 1.25)}>＋</button>
      <button type="button" title="适应窗口" onClick={onFit}>Fit</button>
      <button type="button" title="实际大小" onClick={() => onZoom(1)}>100%</button>
      <button type="button" title="全屏查看" onClick={onFullscreen}>全屏</button>
    </div>
  );
}

function ImageViewport({
  title,
  detail,
  width,
  height,
  resetKey,
  className = "",
  children,
  onPixel,
  status,
  viewerId,
  syncState,
  onViewChange,
}: {
  title: string;
  detail: string;
  width: number;
  height: number;
  resetKey: string;
  className?: string;
  children: ReactNode;
  onPixel?: (x: number, y: number) => void;
  status?: string;
  viewerId?: string;
  syncState?: ViewSyncState | null;
  onViewChange?: (state: ViewSyncState) => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [zoom, setZoomState] = useState(1);
  const [fitMode, setFitMode] = useState(true);
  const fitModeRef = useRef(true);
  const [panning, setPanning] = useState(false);
  const revisionRef = useRef(0);
  const reportView = useCallback((nextZoom: number, mode: "manual" | "fit") => {
    const stage = stageRef.current;
    const surface = surfaceRef.current;
    if (!stage || !surface || !viewerId || !onViewChange) return;
    const centerImageX = (stage.scrollLeft + stage.clientWidth / 2 - surface.offsetLeft) / Math.max(0.1, nextZoom);
    const centerImageY = (stage.scrollTop + stage.clientHeight / 2 - surface.offsetTop) / Math.max(0.1, nextZoom);
    onViewChange({
      zoom: nextZoom,
      centerX: Math.max(0, Math.min(1, centerImageX / Math.max(1, width))),
      centerY: Math.max(0, Math.min(1, centerImageY / Math.max(1, height))),
      mode,
      sourceId: viewerId,
      revision: ++revisionRef.current,
    });
  }, [height, onViewChange, viewerId, width]);
  const setZoom = useCallback((value: number, clientX?: number, clientY?: number, notify = true) => {
    const stage = stageRef.current;
    const surface = surfaceRef.current;
    const next = Math.max(0.1, Math.min(16, value));
    fitModeRef.current = false;
    setFitMode(false);
    if (!stage || !surface) {
      setZoomState(next);
      return;
    }
    const bounds = stage.getBoundingClientRect();
    const anchorX = clientX ?? bounds.left + stage.clientWidth / 2;
    const anchorY = clientY ?? bounds.top + stage.clientHeight / 2;
    const viewportX = anchorX - bounds.left;
    const viewportY = anchorY - bounds.top;
    const imageX = (stage.scrollLeft + viewportX - surface.offsetLeft) / zoom;
    const imageY = (stage.scrollTop + viewportY - surface.offsetTop) / zoom;
    setZoomState(next);
    requestAnimationFrame(() => {
      stage.scrollLeft = surface.offsetLeft + imageX * next - viewportX;
      stage.scrollTop = surface.offsetTop + imageY * next - viewportY;
      if (notify) reportView(next, "manual");
    });
  }, [reportView, zoom]);
  const fit = useCallback((notify = true) => {
    const stage = stageRef.current;
    if (!stage) return;
    const style = getComputedStyle(stage);
    const horizontalPadding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    const verticalPadding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const availableWidth = Math.max(1, stage.clientWidth - horizontalPadding);
    const availableHeight = Math.max(1, stage.clientHeight - verticalPadding);
    const next = Math.max(0.1, Math.min(
      16,
      availableWidth / width,
      availableHeight / height,
    ));
    fitModeRef.current = true;
    setFitMode(true);
    setZoomState(next);
    requestAnimationFrame(() => {
      stage.scrollLeft = 0;
      stage.scrollTop = 0;
      if (notify) reportView(next, "fit");
    });
  }, [height, reportView, width]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => fit(false));
    return () => cancelAnimationFrame(frame);
  }, [resetKey, fit]);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || typeof ResizeObserver === "undefined") return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      if (!fitModeRef.current) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (fitModeRef.current) fit(false);
      });
    });
    observer.observe(stage);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [fit]);
  useEffect(() => {
    if (!syncState || !viewerId || syncState.sourceId === viewerId) return;
    const stage = stageRef.current;
    const surface = surfaceRef.current;
    if (!stage || !surface) return;
    if (syncState.mode === "fit") {
      fit(false);
      return;
    }
    fitModeRef.current = false;
    setFitMode(false);
    setZoomState(syncState.zoom);
    requestAnimationFrame(() => {
      stage.scrollLeft = surface.offsetLeft + syncState.centerX * width * syncState.zoom - stage.clientWidth / 2;
      stage.scrollTop = surface.offsetTop + syncState.centerY * height * syncState.zoom - stage.clientHeight / 2;
    });
  }, [fit, height, syncState, viewerId, width]);

  const updatePixel = (event: PointerEvent<HTMLDivElement>) => {
    if (!onPixel || dragRef.current || !surfaceRef.current) return;
    const bounds = surfaceRef.current.getBoundingClientRect();
    const x = Math.floor(((event.clientX - bounds.left) / Math.max(1, bounds.width)) * width);
    const y = Math.floor(((event.clientY - bounds.top) / Math.max(1, bounds.height)) * height);
    if (x >= 0 && y >= 0 && x < width && y < height) onPixel(x, y);
  };

  return (
    <div
      ref={panelRef}
      className={`viewer panel image-viewer-panel ${className}`}
      data-fit-mode={fitMode ? "true" : "false"}
    >
      <div className="viewer-header">
        <span>{title}</span>
        <small>{detail}</small>
        <ZoomToolbar
          zoom={zoom}
          onZoom={setZoom}
          onFit={fit}
          onFullscreen={() => {
            if (document.fullscreenElement) void document.exitFullscreen();
            else void panelRef.current?.requestFullscreen();
          }}
        />
      </div>
      <div
        ref={stageRef}
        className={`canvas-stage checkerboard zoom-stage ${panning ? "panning" : ""}`}
        onWheel={(event: WheelEvent<HTMLDivElement>) => {
          event.preventDefault();
          setZoom(zoom * (event.deltaY < 0 ? 1.12 : 1 / 1.12), event.clientX, event.clientY);
        }}
        onPointerDown={(event) => {
          if (event.button !== 0 && event.button !== 1) return;
          const stage = stageRef.current;
          if (!stage) return;
          dragRef.current = { x: event.clientX, y: event.clientY, left: stage.scrollLeft, top: stage.scrollTop };
          stage.setPointerCapture(event.pointerId);
          setPanning(true);
          event.preventDefault();
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          const stage = stageRef.current;
          if (drag && stage) {
            stage.scrollLeft = drag.left - (event.clientX - drag.x);
            stage.scrollTop = drag.top - (event.clientY - drag.y);
            reportView(zoom, "manual");
            return;
          }
          updatePixel(event);
        }}
        onPointerUp={(event) => {
          dragRef.current = null;
          setPanning(false);
          event.currentTarget.releasePointerCapture(event.pointerId);
          updatePixel(event);
        }}
        onPointerCancel={() => {
          dragRef.current = null;
          setPanning(false);
        }}
      >
        <div
          ref={surfaceRef}
          className="image-surface"
          style={{ width: `${Math.max(1, Math.round(width * zoom))}px`, height: `${Math.max(1, Math.round(height * zoom))}px` }}
        >
          {children}
        </div>
      </div>
      {status && <div className="viewer-status">{status} · Zoom {Math.round(zoom * 100)}%</div>}
    </div>
  );
}

function HeicViewer({ doc }: { doc: HeicDocument }) {
  return (
    <ImageViewport
      title={doc.kind === "heic" ? "HEIC 图像" : "RGB 图像"}
      detail={`${doc.width} × ${doc.height}`}
      width={doc.width}
      height={doc.height}
      resetKey={doc.id}
      className="heic-panel"
      status={`${doc.width}×${doc.height} | ${doc.kind === "heic" ? "HEIC" : "RGB"}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={doc.url} alt={doc.file.name} draggable={false} />
    </ImageViewport>
  );
}

function CompareImageViewer({
  side,
  doc,
  syncState,
  onViewChange,
}: {
  side: "Left" | "Right";
  doc: ImageDocument;
  syncState: ViewSyncState | null;
  onViewChange: (state: ViewSyncState) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pixel, setPixel] = useState({ x: 0, y: 0 });
  const raster = doc.kind === "heic" || doc.kind === "image";
  const width = raster ? doc.width : doc.config.width;
  const height = raster ? doc.height : doc.config.height;
  useEffect(() => {
    if (raster || !canvasRef.current) return;
    const canvas = canvasRef.current;
    canvas.width = width;
    canvas.height = height;
    const image = doc.kind === "yuv"
      ? renderYuvFrame(doc.bytes, doc.config, doc.frame)
      : renderRawPreview(doc.values, doc.config, doc.mode, doc.levels, doc.autoStretch, doc.blackLevel, doc.gain);
    canvas.getContext("2d", { alpha: false })?.putImageData(image, 0, 0);
  }, [doc, height, raster, width]);
  const format = doc.kind === "yuv"
    ? `${doc.config.format} · 帧 ${doc.frame + 1}/${doc.config.frameCount}`
    : doc.kind === "raw"
      ? `${doc.config.bayer} · RAW${doc.config.bitDepth}`
      : doc.kind === "heic" ? "HEIC" : "RGB";
  return <div className="compare-side">
    <div className="compare-side-label"><b>{side}</b><span title={doc.file.name}>{doc.file.name}</span><em>{format}</em></div>
    <ImageViewport
      title={`${side} Viewer`}
      detail={`${width} × ${height}`}
      width={width}
      height={height}
      resetKey={`${side}-${doc.id}-${width}-${height}`}
      viewerId={`${side}-${doc.id}`}
      syncState={syncState}
      onViewChange={onViewChange}
      onPixel={(x, y) => setPixel({ x, y })}
      status={`${width}×${height} | ${format} | X:${pixel.x} Y:${pixel.y}`}
      className="compare-image-viewer"
    >
      {raster ? <img src={doc.url} alt={doc.file.name} draggable={false} /> : <canvas ref={canvasRef} />}
    </ImageViewport>
  </div>;
}

function YuvViewer({
  doc,
  canvasRef,
  onConfig,
  onCandidate,
  onFrame,
  onFps,
}: {
  doc: YuvDocument;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  onConfig: (field: "width" | "height" | "format", value: string) => void;
  onCandidate: (candidate: YuvCandidate) => void;
  onFrame: (frame: number) => void;
  onFps: (fps: number) => void;
}) {
  const [playing, setPlaying] = useState(false);
  const [pixel, setPixel] = useState({ x: 0, y: 0 });
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      if (doc.frame >= doc.config.frameCount - 1) {
        setPlaying(false);
      } else {
        onFrame(doc.frame + 1);
      }
    }, 1000 / Math.max(1, doc.fps));
    return () => clearInterval(timer);
  }, [doc.fps, doc.frame, doc.config.frameCount, onFrame, playing]);

  return (
    <div className="workspace-grid">
      <aside className="control-panel panel">
        <PanelTitle step="01" title="解析参数" subtitle="自动识别后仍可手动校正" />
        <label>像素格式
          <select value={doc.config.format} onChange={(event) => onConfig("format", event.target.value)}>
            {YUV_FORMATS.map((format) => <option key={format}>{format}</option>)}
          </select>
        </label>
        <div className="field-pair">
          <label>宽度<input type="number" min="1" value={doc.config.width} onChange={(event) => onConfig("width", event.target.value)} /></label>
          <label>高度<input type="number" min="1" value={doc.config.height} onChange={(event) => onConfig("height", event.target.value)} /></label>
        </div>
        <div className="detected">
          <span>当前解析</span>
          <strong>{doc.config.width} × {doc.config.height} · {doc.config.format}</strong>
          <small>
            每帧 {formatBytes(doc.config.frameBytes)} · 共 {doc.config.frameCount.toLocaleString("zh-CN")} 帧
            {doc.config.dataOffset ? ` · 文件头 ${doc.config.dataOffset} B` : ""}
          </small>
        </div>
        {doc.candidates.length > 1 && (
          <details className="candidates">
            <summary>查看自动识别候选 ({doc.candidates.length})</summary>
            <div>
              {doc.candidates.slice(0, 8).map((candidate, index) => (
                <button type="button" key={`${candidate.width}-${candidate.height}-${candidate.format}`} onClick={() => onCandidate(candidate)}>
                  <b>{confidence(index, candidate, doc.candidates[0])}</b>
                  <span>{candidate.width}×{candidate.height} {candidate.format}</span>
                  <small>{candidate.reason}</small>
                </button>
              ))}
            </div>
          </details>
        )}
      </aside>
      <div className="viewer-column">
        <ImageViewport
          title="YUV 画面"
          detail={`帧 ${doc.frame + 1} / ${doc.config.frameCount}`}
          width={doc.config.width}
          height={doc.config.height}
          resetKey={`${doc.id}-${doc.config.width}-${doc.config.height}`}
          onPixel={(x, y) => setPixel({ x, y })}
          status={`${doc.config.width}×${doc.config.height} | ${doc.config.format} | X:${pixel.x} Y:${pixel.y}`}
        >
          <canvas
            ref={canvasRef}
            aria-label="YUV 图像预览"
          />
        </ImageViewport>
        <PlaybackControls
          playing={playing}
          frame={doc.frame}
          count={doc.config.frameCount}
          fps={doc.fps}
          onToggle={() => setPlaying((value) => !value)}
          onFrame={(frame) => {
            setPlaying(false);
            onFrame(frame);
          }}
          onFps={onFps}
        />
      </div>
    </div>
  );
}

function RawViewer({
  doc,
  canvasRef,
  onConfig,
  onUpdate,
}: {
  doc: RawDocument;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  onConfig: (field: "width" | "height" | "bitDepth" | "bayer" | "packing", value: string) => void;
  onUpdate: (update: (doc: RawDocument) => RawDocument) => void;
}) {
  const [pixel, setPixel] = useState({ x: 0, y: 0 });
  const rawValue = doc.values[pixel.y * doc.config.width + pixel.x] ?? 0;
  const channel = bayerChannel(doc.config.bayer, pixel.x, pixel.y);
  const packingLabel = RAW_PACKINGS.find((item) => item.value === doc.config.packing)?.label ?? doc.config.packing;
  return (
    <div className="workspace-grid">
      <aside className="control-panel panel raw-controls">
        <PanelTitle step="RAW" title="RAW 参数" subtitle="自动识别后仍可手动校正" />
        <div className="field-pair">
          <label>宽度<input type="number" min="1" value={doc.config.width} onChange={(event) => onConfig("width", event.target.value)} /></label>
          <label>高度<input type="number" min="1" value={doc.config.height} onChange={(event) => onConfig("height", event.target.value)} /></label>
        </div>
        <div className="field-pair">
          <label>Bit Depth
            <select value={doc.config.bitDepth} onChange={(event) => onConfig("bitDepth", event.target.value)}>
              {[8, 10, 12, 14, 16].map((value) => <option key={value} value={value}>{value} bit</option>)}
            </select>
          </label>
          <label>Bayer
            <select value={doc.config.bayer} onChange={(event) => onConfig("bayer", event.target.value)}>
              {BAYER_PATTERNS.map((pattern) => <option key={pattern}>{pattern}</option>)}
            </select>
          </label>
        </div>
        <label>Packing Format
          <select value={doc.config.packing} onChange={(event) => onConfig("packing", event.target.value)}>
            {RAW_PACKINGS.map((packing) => <option key={packing.value} value={packing.value}>{packing.label}</option>)}
          </select>
        </label>
        <label>显示模式
          <select value={doc.mode} onChange={(event) => onUpdate((current) => ({ ...current, mode: event.target.value as RawViewMode }))}>
            <option value="rgb">Demosaic RGB</option>
            <option value="gray">Grayscale RAW</option>
          </select>
        </label>
        <label className="check-field">
          <input type="checkbox" checked={doc.autoStretch} onChange={(event) => onUpdate((current) => ({ ...current, autoStretch: event.target.checked }))} />
          Auto Stretch（0.1%–99.9%）
        </label>
        <div className="field-pair">
          <label>Black Level<input type="number" min="0" max={2 ** doc.config.bitDepth - 1} value={doc.blackLevel} onChange={(event) => onUpdate((current) => ({ ...current, blackLevel: Math.max(0, Number(event.target.value) || 0) }))} /></label>
          <label>Preview Gain<input type="number" min="0.1" max="16" step="0.1" value={doc.gain} onChange={(event) => onUpdate((current) => ({ ...current, gain: Math.max(0.1, Number(event.target.value) || 1) }))} /></label>
        </div>
        <div className="detected">
          <span>检测结果</span>
          <strong>{doc.config.width} × {doc.config.height} · {doc.config.bayer} · {doc.config.bitDepth} bit</strong>
          <small>{packingLabel} · {formatBytes(doc.config.frameBytes)}</small>
          <small>数据范围 {doc.levels.min}–{doc.levels.max} · 拉伸 {doc.levels.low}–{doc.levels.high}</small>
          <small>{doc.config.reason}</small>
        </div>
      </aside>
      <ImageViewport
        title="Bayer RAW 画面"
        detail={`${doc.mode === "rgb" ? "Demosaic RGB" : "Grayscale"} · ${doc.config.bayer}`}
        width={doc.config.width}
        height={doc.config.height}
        resetKey={`${doc.id}-${doc.config.width}-${doc.config.height}`}
        onPixel={(x, y) => setPixel({ x, y })}
        status={`${doc.config.width}×${doc.config.height} | ${doc.config.bayer} | RAW${doc.config.bitDepth} | X:${pixel.x} Y:${pixel.y} RAW:${rawValue} ${channel}`}
      >
        <canvas ref={canvasRef} aria-label="Bayer RAW 图像预览" />
      </ImageViewport>
    </div>
  );
}

const CompareStreamViewer = forwardRef<CompareStreamHandle, {
  side: "Left" | "Right";
  doc: StreamDocument;
  onSeek: (seconds: number) => void;
  onStep: (delta: number) => void;
}>(function CompareStreamViewer({ side, doc, onSeek, onStep }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const decoderRef = useRef<VideoDecoder | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const runRef = useRef(0);
  const frameRef = useRef(0);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [support, setSupport] = useState<"checking" | "supported" | "unsupported">("checking");
  const fps = Math.max(1, doc.fps);
  const count = doc.analysis.frames.length;

  const pause = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    runRef.current += 1;
    try { decoderRef.current?.close(); } catch { /* already closed */ }
    decoderRef.current = null;
    setPlaying(false);
  }, []);

  useEffect(() => {
    let active = true;
    if (typeof VideoDecoder === "undefined") {
      setSupport("unsupported");
      return;
    }
    setSupport("checking");
    VideoDecoder.isConfigSupported({ codec: doc.analysis.codecString, optimizeForLatency: true })
      .then((result) => active && setSupport(result.supported ? "supported" : "unsupported"))
      .catch(() => active && setSupport("unsupported"));
    return () => { active = false; pause(); };
  }, [doc.id, doc.analysis.codecString, pause]);

  const chunk = useCallback((index: number) => {
    const item = doc.analysis.frames[index];
    if (!item) return null;
    return new EncodedVideoChunk({
      type: item.key ? "key" : "delta",
      timestamp: Math.round(index * 1_000_000 / fps),
      duration: Math.round(1_000_000 / fps),
      data: doc.bytes.slice(item.start, item.end),
    });
  }, [doc, fps]);

  const createDecoder = useCallback((minimum: number, run: number) => {
    const decoder = new VideoDecoder({
      output: (videoFrame) => {
        if (run !== runRef.current) { videoFrame.close(); return; }
        const index = Math.max(0, Math.min(count - 1, Math.round(videoFrame.timestamp * fps / 1_000_000)));
        if (index < minimum) { videoFrame.close(); return; }
        const canvas = canvasRef.current;
        if (canvas) {
          canvas.width = videoFrame.displayWidth;
          canvas.height = videoFrame.displayHeight;
          canvas.getContext("2d", { alpha: false })?.drawImage(videoFrame, 0, 0);
        }
        videoFrame.close();
        frameRef.current = index;
        setFrame(index);
      },
      error: () => pause(),
    });
    decoder.configure({ codec: doc.analysis.codecString, optimizeForLatency: true });
    decoderRef.current = decoder;
    return decoder;
  }, [count, doc.analysis.codecString, fps, pause]);

  const seekFrame = useCallback(async (target: number, notify: boolean) => {
    const next = Math.max(0, Math.min(count - 1, target));
    pause();
    frameRef.current = next;
    setFrame(next);
    if (notify) onSeek(next / fps);
    if (support !== "supported") return;
    const run = ++runRef.current;
    const decoder = createDecoder(next, run);
    try {
      for (let index = 0; index <= next; index += 1) {
        const encoded = chunk(index);
        if (encoded) decoder.decode(encoded);
        if (decoder.decodeQueueSize > 60) await decoder.flush();
      }
      await decoder.flush();
    } catch {
      // Analysis remains usable when a browser decoder rejects the stream.
    } finally {
      if (run === runRef.current) {
        try { decoder.close(); } catch { /* already closed */ }
        decoderRef.current = null;
      }
    }
  }, [chunk, count, createDecoder, fps, onSeek, pause, support]);

  const play = useCallback(() => {
    if (support !== "supported" || !count) return;
    pause();
    const start = frameRef.current >= count - 1 ? 0 : frameRef.current;
    frameRef.current = start;
    setFrame(start);
    const run = ++runRef.current;
    const decoder = createDecoder(start, run);
    for (let index = 0; index <= start; index += 1) {
      const encoded = chunk(index);
      if (encoded) decoder.decode(encoded);
    }
    let next = start + 1;
    setPlaying(true);
    timerRef.current = setInterval(() => {
      if (next >= count) { pause(); return; }
      const encoded = chunk(next);
      if (encoded) decoder.decode(encoded);
      next += 1;
    }, 1000 / fps);
  }, [chunk, count, createDecoder, fps, pause, support]);

  useImperativeHandle(ref, () => ({
    play,
    pause,
    seekTime: (seconds) => void seekFrame(Math.round(seconds * fps), false),
    step: (delta) => void seekFrame(frameRef.current + delta, false),
    currentTime: () => frameRef.current / fps,
  }), [fps, pause, play, seekFrame]);

  const selected = doc.analysis.frames[frame];
  return <section className="panel compare-video-card">
    <div className="compare-side-label"><b>{side}</b><span title={doc.file.name}>{doc.file.name}</span><em>{doc.analysis.codecLabel}</em></div>
    <div className="canvas-stage compare-video-stage">
      <canvas ref={canvasRef} aria-label={`${side} H.26x 解码画面`} />
      <div className="current-frame-badge"><span>当前帧</span><strong>#{frame}</strong><em>{selected?.type ?? "—"} · {formatBytes(selected?.size ?? 0)}</em></div>
      {support !== "supported" && <div className="empty-canvas"><b>码流分析可用</b><span>{support === "checking" ? "正在检查浏览器解码器…" : "浏览器无法解码此码流"}</span></div>}
    </div>
    <PlaybackControls
      playing={playing}
      frame={frame}
      count={count}
      fps={fps}
      disabled={support !== "supported"}
      onToggle={() => playing ? pause() : play()}
      onFrame={(next) => {
        const delta = next - frameRef.current;
        if (Math.abs(delta) === 1) {
          void seekFrame(next, false);
          onStep(delta);
        } else {
          void seekFrame(next, true);
        }
      }}
      onFps={() => undefined}
    />
    <div className="compare-video-meta">{doc.analysis.width || "—"}×{doc.analysis.height || "—"} · {count.toLocaleString("zh-CN")} 帧 · WebCodecs</div>
  </section>;
});

function DropZone({
  dragging,
  setDragging,
  onDrop,
  onBrowse,
}: {
  dragging: boolean;
  setDragging: (value: boolean) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onBrowse: () => void;
}) {
  return (
    <div
      className={`drop-zone ${dragging ? "dragging" : ""}`}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <div className="drop-visual"><span /><b>+</b></div>
      <h2>拖入媒体文件</h2>
      <p>YUV / SYUV · Bayer RAW · HEIC / RGB 图片 · H.264 · H.265</p>
      <button className="button primary" type="button" onClick={onBrowse}>选择文件</button>
      <small>YUV / RAW / HEIC 可多选（最多 10 个）；H.264 / H.265 每次仅 1 个</small>
    </div>
  );
}

function FileSummary({ file, kind }: { file: File; kind: string }) {
  return (
    <div className="file-summary">
      <span className="file-icon">01</span>
      <div><strong>{file.name}</strong><small>{formatBytes(file.size)} · {fileDate(file)}</small></div>
      <span className="kind-pill">{kind}</span>
    </div>
  );
}

function PanelTitle({ step, title, subtitle }: { step: string; title: string; subtitle: string }) {
  return (
    <div className="panel-title">
      <span>{step}</span>
      <div><h2>{title}</h2><p>{subtitle}</p></div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong></div>;
}

function PlaybackControls({
  playing,
  frame,
  count,
  fps,
  disabled = false,
  onToggle,
  onFrame,
  onFps,
}: {
  playing: boolean;
  frame: number;
  count: number;
  fps: number;
  disabled?: boolean;
  onToggle: () => void;
  onFrame: (frame: number) => void;
  onFps: (fps: number) => void;
}) {
  return (
    <div className="playback">
      <button className="transport" type="button" disabled={disabled || frame <= 0} onClick={() => onFrame(Math.max(0, frame - 1))}>|←</button>
      <button className="play-button" type="button" disabled={disabled} onClick={onToggle}>{playing ? "Ⅱ" : "▶"}</button>
      <button className="transport" type="button" disabled={disabled || frame >= count - 1} onClick={() => onFrame(Math.min(count - 1, frame + 1))}>→|</button>
      <span className="timecode">{formatDuration(frame / Math.max(1, fps))}</span>
      <input
        className="timeline"
        type="range"
        min="0"
        max={Math.max(0, count - 1)}
        value={Math.min(frame, Math.max(0, count - 1))}
        disabled={disabled}
        onChange={(event) => onFrame(Number(event.target.value))}
        aria-label="帧位置"
      />
      <label className="fps-control">
        <input type="number" min="1" max="120" value={fps} onChange={(event) => onFps(Math.max(1, Number(event.target.value)))} />
        fps
      </label>
    </div>
  );
}

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds)) return "00:00.000";
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${remaining.toFixed(3).padStart(6, "0")}`;
}
