type IsoBox = {
  type: string;
  start: number;
  end: number;
  contentStart: number;
};

export type ExtractedHeicFrame = {
  annexB: Uint8Array;
  width: number;
  height: number;
  codecCandidates: string[];
};

const START_CODE = new Uint8Array([0, 0, 0, 1]);

function readUint(data: Uint8Array, offset: number, size: number) {
  let value = 0;
  for (let index = 0; index < size; index += 1) {
    value = value * 256 + (data[offset + index] ?? 0);
  }
  return value;
}

function readType(data: Uint8Array, offset: number) {
  return String.fromCharCode(...data.slice(offset, offset + 4));
}

function boxes(data: Uint8Array, start: number, end: number) {
  const result: IsoBox[] = [];
  let cursor = start;
  while (cursor + 8 <= end) {
    let size = readUint(data, cursor, 4);
    const type = readType(data, cursor + 4);
    let headerSize = 8;
    if (size === 1) {
      size = readUint(data, cursor + 8, 8);
      headerSize = 16;
    } else if (size === 0) {
      size = end - cursor;
    }
    if (size < headerSize || cursor + size > end) break;
    result.push({
      type,
      start: cursor,
      end: cursor + size,
      contentStart: cursor + headerSize,
    });
    cursor += size;
  }
  return result;
}

function childBoxes(data: Uint8Array, box: IsoBox) {
  const offset = box.type === "meta" ? 4 : 0;
  return boxes(data, box.contentStart + offset, box.end);
}

function primaryItemId(data: Uint8Array, pitm: IsoBox) {
  const version = data[pitm.contentStart] ?? 0;
  return readUint(data, pitm.contentStart + 4, version === 0 ? 2 : 4);
}

function itemExtents(data: Uint8Array, iloc: IsoBox, requestedItem: number) {
  const version = data[iloc.contentStart] ?? 0;
  let cursor = iloc.contentStart + 4;
  const sizes = data[cursor++] ?? 0;
  const offsetSize = sizes >> 4;
  const lengthSize = sizes & 0x0f;
  const baseAndIndex = data[cursor++] ?? 0;
  const baseOffsetSize = baseAndIndex >> 4;
  const indexSize = version === 1 || version === 2 ? baseAndIndex & 0x0f : 0;
  const itemCountSize = version < 2 ? 2 : 4;
  const itemCount = readUint(data, cursor, itemCountSize);
  cursor += itemCountSize;

  for (let itemIndex = 0; itemIndex < itemCount; itemIndex += 1) {
    const itemIdSize = version < 2 ? 2 : 4;
    const itemId = readUint(data, cursor, itemIdSize);
    cursor += itemIdSize;
    let constructionMethod = 0;
    if (version === 1 || version === 2) {
      constructionMethod = readUint(data, cursor, 2) & 0x0f;
      cursor += 2;
    }
    cursor += 2; // data_reference_index
    const baseOffset = readUint(data, cursor, baseOffsetSize);
    cursor += baseOffsetSize;
    const extentCount = readUint(data, cursor, 2);
    cursor += 2;
    const extents: Array<{ offset: number; length: number }> = [];
    for (let extentIndex = 0; extentIndex < extentCount; extentIndex += 1) {
      if (indexSize) cursor += indexSize;
      const offset = readUint(data, cursor, offsetSize);
      cursor += offsetSize;
      const length = readUint(data, cursor, lengthSize);
      cursor += lengthSize;
      extents.push({ offset: baseOffset + offset, length });
    }
    if (itemId === requestedItem) {
      if (constructionMethod !== 0) {
        throw new Error("暂不支持这种 HEIC 数据构造方式");
      }
      return extents;
    }
  }
  throw new Error("HEIC 中未找到主图像数据");
}

function reverseBits32(value: number) {
  let source = value >>> 0;
  let reversed = 0;
  for (let index = 0; index < 32; index += 1) {
    reversed = (reversed * 2 + (source & 1)) >>> 0;
    source >>>= 1;
  }
  return reversed >>> 0;
}

function codecCandidates(hvcc: Uint8Array) {
  const profileByte = hvcc[1] ?? 1;
  const profileSpace = profileByte >> 6;
  const tier = profileByte & 0x20 ? "H" : "L";
  const profile = profileByte & 0x1f;
  const compatibility = reverseBits32(readUint(hvcc, 2, 4));
  const level = hvcc[12] ?? 93;
  const constraints = Array.from(hvcc.slice(6, 12));
  while (constraints.length > 1 && constraints.at(-1) === 0) constraints.pop();
  const constraintText = constraints.map((value) => value.toString(16).padStart(2, "0")).join(".");
  const space = ["", "A", "B", "C"][profileSpace] ?? "";
  const core = `${space}${profile}.${compatibility.toString(16)}.${tier}${level}.${constraintText || "B0"}`;
  return [
    `hvc1.${core}`,
    `hev1.${core}`,
    `hvc1.${space}${profile}.${compatibility.toString(16)}.${tier}${level}.B0`,
    `hev1.${space}${profile}.${compatibility.toString(16)}.${tier}${level}.B0`,
    "hev1.1.6.L93.B0",
  ];
}

function concatenate(chunks: Uint8Array[]) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

export function extractHeicFrame(data: Uint8Array): ExtractedHeicFrame {
  const topLevel = boxes(data, 0, data.byteLength);
  const meta = topLevel.find((box) => box.type === "meta");
  if (!meta) throw new Error("HEIC 缺少 meta 容器");
  const metaChildren = childBoxes(data, meta);
  const pitm = metaChildren.find((box) => box.type === "pitm");
  const iloc = metaChildren.find((box) => box.type === "iloc");
  const iprp = metaChildren.find((box) => box.type === "iprp");
  if (!pitm || !iloc || !iprp) throw new Error("HEIC 主图像索引不完整");

  const ipco = childBoxes(data, iprp).find((box) => box.type === "ipco");
  if (!ipco) throw new Error("HEIC 缺少图像属性");
  const properties = childBoxes(data, ipco);
  const ispe = properties.find((box) => box.type === "ispe");
  const hvccBox = properties.find((box) => box.type === "hvcC");
  if (!ispe || !hvccBox) throw new Error("HEIC 缺少尺寸或 H.265 配置");

  const width = readUint(data, ispe.contentStart + 4, 4);
  const height = readUint(data, ispe.contentStart + 8, 4);
  const hvcc = data.slice(hvccBox.contentStart, hvccBox.end);
  const lengthSize = ((hvcc[21] ?? 3) & 3) + 1;
  const arrayCount = hvcc[22] ?? 0;
  let configCursor = 23;
  const chunks: Uint8Array[] = [];
  for (let arrayIndex = 0; arrayIndex < arrayCount; arrayIndex += 1) {
    configCursor += 1;
    const nalCount = readUint(hvcc, configCursor, 2);
    configCursor += 2;
    for (let nalIndex = 0; nalIndex < nalCount; nalIndex += 1) {
      const nalLength = readUint(hvcc, configCursor, 2);
      configCursor += 2;
      chunks.push(START_CODE, hvcc.slice(configCursor, configCursor + nalLength));
      configCursor += nalLength;
    }
  }

  const extents = itemExtents(data, iloc, primaryItemId(data, pitm));
  for (const extent of extents) {
    let cursor = extent.offset;
    const end = Math.min(data.byteLength, extent.offset + extent.length);
    while (cursor + lengthSize <= end) {
      const nalLength = readUint(data, cursor, lengthSize);
      cursor += lengthSize;
      if (!nalLength || cursor + nalLength > end) break;
      chunks.push(START_CODE, data.slice(cursor, cursor + nalLength));
      cursor += nalLength;
    }
  }
  if (chunks.length < 4) throw new Error("HEIC 中没有可解码的 H.265 图像帧");
  return {
    annexB: concatenate(chunks),
    width,
    height,
    codecCandidates: codecCandidates(hvcc),
  };
}

function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("无法生成 HEIC 预览图"));
    }, "image/png");
  });
}

export async function decodeHeicWithWebCodecs(data: Uint8Array) {
  if (typeof VideoDecoder === "undefined") {
    throw new Error("当前浏览器没有可用的 H.265 图像解码器");
  }
  const extracted = extractHeicFrame(data);
  let codec = "";
  for (const candidate of extracted.codecCandidates) {
    try {
      const support = await VideoDecoder.isConfigSupported({
        codec: candidate,
        optimizeForLatency: true,
      });
      if (support.supported) {
        codec = candidate;
        break;
      }
    } catch {
      // Try the next valid HEVC codec spelling.
    }
  }
  if (!codec) throw new Error("当前浏览器不支持此 HEIC 的 H.265 Profile");

  const canvas = document.createElement("canvas");
  canvas.width = extracted.width;
  canvas.height = extracted.height;
  let resolveFrame: (() => void) | undefined;
  let rejectFrame: ((error: Error) => void) | undefined;
  const frameReady = new Promise<void>((resolve, reject) => {
    resolveFrame = resolve;
    rejectFrame = reject;
  });
  const decoder = new VideoDecoder({
    output: (frame) => {
      canvas.width = frame.displayWidth;
      canvas.height = frame.displayHeight;
      canvas.getContext("2d", { alpha: false })?.drawImage(frame, 0, 0);
      frame.close();
      resolveFrame?.();
    },
    error: (error) => rejectFrame?.(error),
  });
  try {
    decoder.configure({ codec, optimizeForLatency: true });
    decoder.decode(new EncodedVideoChunk({
      type: "key",
      timestamp: 0,
      data: extracted.annexB,
    }));
    await decoder.flush();
    await frameReady;
    return {
      blob: await canvasBlob(canvas),
      width: canvas.width,
      height: canvas.height,
    };
  } finally {
    try {
      decoder.close();
    } catch {
      // Decoder errors can close it before cleanup.
    }
  }
}

