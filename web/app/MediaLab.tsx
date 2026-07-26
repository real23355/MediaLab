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
import {
  type ChangeEvent,
  type DragEvent,
  useCallback,
  useEffect,
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

const VERSION = "V0.0.2";
const PAGE_SIZE = 100;
const IMAGE_LIMIT = 10;

const KIND_OPTIONS: Array<{
  value: MediaKind;
  label: string;
  extension: string;
}> = [
  { value: "yuv", label: "YUV 原始图像", extension: ".yuv / .raw / .syuv" },
  { value: "heic", label: "HEIC 图片", extension: ".heic / .heif" },
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
  kind: "heic";
  file: File;
  url: string;
  width: number;
  height: number;
};

type ImageDocument = YuvDocument | HeicDocument;

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

export default function MediaLab() {
  const fileInput = useRef<HTMLInputElement>(null);
  const yuvCanvas = useRef<HTMLCanvasElement>(null);
  const streamCanvas = useRef<HTMLCanvasElement>(null);
  const decoder = useRef<VideoDecoder | null>(null);
  const playbackTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const decodeRun = useRef(0);

  const [pendingItems, setPendingItems] = useState<PendingItem[]>([]);
  const [imageDocs, setImageDocs] = useState<ImageDocument[]>([]);
  const [activeDocId, setActiveDocId] = useState("");
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

  const returnHome = useCallback(() => {
    stopStreamPlayback();
    imageDocs.forEach((doc) => {
      if (doc.kind === "heic") URL.revokeObjectURL(doc.url);
    });
    setPendingItems([]);
    setImageDocs([]);
    setActiveDocId("");
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
    returnHome();
    const accepted = incoming.slice(0, IMAGE_LIMIT);
    if (incoming.length > IMAGE_LIMIT) {
      setError(`YUV / HEIC 一次最多选择 ${IMAGE_LIMIT} 个文件，已保留前 ${IMAGE_LIMIT} 个。`);
    }
    setPendingItems(
      accepted.map((file, index) => ({
        id: uid(file, index),
        file,
        kind: detectKind(file),
      })),
    );
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
    if (streamItems.length && pendingItems.length !== 1) {
      setError("H.264 / H.265 当前一次只支持解析一个文件；请返回首页后单独选择该码流。");
      return;
    }
    if (!streamItems.length && pendingItems.length > IMAGE_LIMIT) {
      setError(`YUV / HEIC 一次最多解析 ${IMAGE_LIMIT} 个文件。`);
      return;
    }

    setBusy(true);
    setError("");
    try {
      if (streamItems[0]) {
        const item = streamItems[0];
        const data = new Uint8Array(await item.file.arrayBuffer());
        setStreamFile(item.file);
        setStreamBytes(data);
        setStream(analyzeStream(data, item.kind as "h264" | "h265"));
        setStreamFrame(0);
        setTablePage(0);
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
        } else {
          if (!window.heic2any) throw new Error("HEIC 解码器尚未加载，请稍后重试。");
          const converted = await window.heic2any({
            blob: item.file,
            toType: "image/png",
          });
          const blob = Array.isArray(converted) ? converted[0] : converted;
          const url = URL.createObjectURL(blob);
          const size = await loadImageSize(url);
          docs.push({
            id: item.id,
            kind: "heic",
            file: item.file,
            url,
            ...size,
          });
        }
      }
      setImageDocs(docs);
      setActiveDocId(docs[0]?.id ?? "");
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
  const hasContent = pendingItems.length > 0 || imageDocs.length > 0 || Boolean(stream);

  return (
    <main>
      <header className="topbar">
        <button className="brand brand-button" type="button" onClick={returnHome}>
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <span>VideoProbe——视频码流与图像诊断工具</span>
          <b>{VERSION}</b>
        </button>
        {hasContent && (
          <button className="button subtle" type="button" onClick={returnHome}>
            返回首页
          </button>
        )}
      </header>

      {!hasContent && (
        <section className="landing">
          <div className="hero-copy">
            <h1>看清每一个<br /><span>像素与编码帧</span></h1>
            <p className="hero-description">
              支持 YUV / SYUV、HEIC 与 H.264 / H.265 裸码流；图像可批量解析，
              码流可播放并逐帧诊断。
            </p>
            <div className="feature-row">
              <span>✓ 最多 10 个 YUV / HEIC</span>
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
            <p>类型选项位于文件名右侧。YUV / HEIC 最多 10 个，码流一次 1 个。</p>
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

      {activeDoc && (
        <section className="workspace shell image-workspace">
          <FileTabs docs={imageDocs} activeId={activeDoc.id} onSelect={setActiveDocId} />
          <div className="image-content">
            <FileSummary file={activeDoc.file} kind={activeDoc.kind === "yuv" ? "YUV / SYUV" : "HEIC"} />
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
            ) : (
              <div className="panel heic-panel">
                <div className="viewer-header">
                  <span>HEIC 图像</span>
                  <small>{activeDoc.width} × {activeDoc.height}</small>
                </div>
                <div className="canvas-stage checkerboard heic-stage">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={activeDoc.url} alt={activeDoc.file.name} />
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {stream && streamFile && streamBytes && (
        <section className="workspace shell">
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
                onFps={setStreamFps}
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
        accept=".yuv,.raw,.syuv,.heic,.heif,.264,.h264,.avc,.265,.h265,.hevc,application/octet-stream,image/heic,image/heif"
        onChange={onPick}
      />
    </main>
  );
}

function FileTabs({
  docs,
  activeId,
  onSelect,
}: {
  docs: ImageDocument[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <aside className="file-tabs" aria-label="已解析图片">
      <h2>已解析文件</h2>
      {docs.map((doc, index) => (
        <button
          key={doc.id}
          type="button"
          className={doc.id === activeId ? "active" : ""}
          onClick={() => onSelect(doc.id)}
        >
          <b>{String(index + 1).padStart(2, "0")}</b>
          <span title={doc.file.name}>{doc.file.name}</span>
          <em>{doc.kind === "yuv" ? "YUV" : "HEIC"}</em>
        </button>
      ))}
    </aside>
  );
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
      <div className="viewer panel">
        <div className="viewer-header"><span>YUV 画面</span><small>帧 {doc.frame + 1} / {doc.config.frameCount}</small></div>
        <div className="canvas-stage checkerboard"><canvas ref={canvasRef} aria-label="YUV 图像预览" /></div>
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
      <p>YUV / SYUV · HEIC · H.264 · H.265</p>
      <button className="button primary" type="button" onClick={onBrowse}>选择文件</button>
      <small>YUV / HEIC 可多选（最多 10 个）；H.264 / H.265 每次仅 1 个</small>
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
