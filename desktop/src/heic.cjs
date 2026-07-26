const START_CODE = Buffer.from([0, 0, 0, 1]);

function readUint(data, offset, size) {
  let value = 0;
  for (let index = 0; index < size; index += 1) {
    value = value * 256 + (data[offset + index] ?? 0);
  }
  return value;
}

function boxes(data, start, end) {
  const result = [];
  let cursor = start;
  while (cursor + 8 <= end) {
    let size = readUint(data, cursor, 4);
    const type = data.toString("ascii", cursor + 4, cursor + 8);
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

function childBoxes(data, box) {
  return boxes(data, box.contentStart + (box.type === "meta" ? 4 : 0), box.end);
}

function primaryItemId(data, pitm) {
  const version = data[pitm.contentStart] ?? 0;
  return readUint(data, pitm.contentStart + 4, version === 0 ? 2 : 4);
}

function itemExtents(data, iloc, requestedItem) {
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
    cursor += 2;
    const baseOffset = readUint(data, cursor, baseOffsetSize);
    cursor += baseOffsetSize;
    const extentCount = readUint(data, cursor, 2);
    cursor += 2;
    const extents = [];
    for (let extentIndex = 0; extentIndex < extentCount; extentIndex += 1) {
      if (indexSize) cursor += indexSize;
      const offset = readUint(data, cursor, offsetSize);
      cursor += offsetSize;
      const length = readUint(data, cursor, lengthSize);
      cursor += lengthSize;
      extents.push({ offset: baseOffset + offset, length });
    }
    if (itemId === requestedItem) {
      if (constructionMethod !== 0) throw new Error("暂不支持这种 HEIC 数据构造方式");
      return extents;
    }
  }
  throw new Error("HEIC 中未找到主图像数据");
}

function extractHeicFrame(data) {
  const topLevel = boxes(data, 0, data.length);
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
  const hvcc = data.subarray(hvccBox.contentStart, hvccBox.end);
  const lengthSize = ((hvcc[21] ?? 3) & 3) + 1;
  const arrayCount = hvcc[22] ?? 0;
  let configCursor = 23;
  const chunks = [];
  for (let arrayIndex = 0; arrayIndex < arrayCount; arrayIndex += 1) {
    configCursor += 1;
    const nalCount = readUint(hvcc, configCursor, 2);
    configCursor += 2;
    for (let nalIndex = 0; nalIndex < nalCount; nalIndex += 1) {
      const nalLength = readUint(hvcc, configCursor, 2);
      configCursor += 2;
      chunks.push(START_CODE, hvcc.subarray(configCursor, configCursor + nalLength));
      configCursor += nalLength;
    }
  }

  for (const extent of itemExtents(data, iloc, primaryItemId(data, pitm))) {
    let cursor = extent.offset;
    const end = Math.min(data.length, extent.offset + extent.length);
    while (cursor + lengthSize <= end) {
      const nalLength = readUint(data, cursor, lengthSize);
      cursor += lengthSize;
      if (!nalLength || cursor + nalLength > end) break;
      chunks.push(START_CODE, data.subarray(cursor, cursor + nalLength));
      cursor += nalLength;
    }
  }
  if (chunks.length < 4) throw new Error("HEIC 中没有可解码的 H.265 图像帧");
  return { annexB: Buffer.concat(chunks), width, height };
}

module.exports = { extractHeicFrame };

