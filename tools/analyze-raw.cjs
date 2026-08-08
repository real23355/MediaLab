const fs = require("node:fs");
const path = require("node:path");

const directory = process.argv[2];
if (!directory) {
  console.error("Usage: node tools/analyze-raw.cjs <RAW directory>");
  process.exit(2);
}

const width = 3840;
const height = 2160;
const packedSize = (width * height * 10) / 8;
const unpackedSize = width * height * 2;
const files = fs.readdirSync(directory, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".raw"))
  .map((entry) => {
    const filePath = path.join(directory, entry.name);
    const stat = fs.statSync(filePath);
    const handle = fs.openSync(filePath, "r");
    const sample = Buffer.allocUnsafe(Math.min(stat.size, 2 * 1024 * 1024));
    const bytesRead = fs.readSync(handle, sample, 0, sample.length, 0);
    fs.closeSync(handle);

    let leWithin10 = 0;
    let beWithin10 = 0;
    let leLow6Zero = 0;
    let beLow6Zero = 0;
    let leMax = 0;
    let beMax = 0;
    const words = Math.floor(bytesRead / 2);
    for (let offset = 0; offset + 1 < bytesRead; offset += 2) {
      const le = sample[offset] | (sample[offset + 1] << 8);
      const be = (sample[offset] << 8) | sample[offset + 1];
      if (le <= 1023) leWithin10 += 1;
      if (be <= 1023) beWithin10 += 1;
      if ((le & 0x3f) === 0) leLow6Zero += 1;
      if ((be & 0x3f) === 0) beLow6Zero += 1;
      leMax = Math.max(leMax, le);
      beMax = Math.max(beMax, be);
    }

    const ratio = (value) => Number((value / Math.max(1, words)).toFixed(6));
    let detectedPacking = "Unknown";
    let alignment = "Unknown";
    if (stat.size === packedSize) detectedPacking = "MIPI RAW10 Packed";
    if (stat.size === unpackedSize) {
      if (ratio(leWithin10) > 0.99) {
        detectedPacking = "RAW10 Unpacked16 LE";
        alignment = "LSB/right-aligned";
      } else if (ratio(beWithin10) > 0.99) {
        detectedPacking = "RAW10 Unpacked16 BE";
        alignment = "LSB/right-aligned";
      } else if (ratio(leLow6Zero) > 0.99) {
        detectedPacking = "RAW10 Unpacked16 LE";
        alignment = "MSB/left-aligned (>> 6)";
      } else if (ratio(beLow6Zero) > 0.99) {
        detectedPacking = "RAW10 Unpacked16 BE";
        alignment = "MSB/left-aligned (>> 6)";
      } else {
        detectedPacking = "16-bit container (alignment requires review)";
      }
    }
    return {
      filename: entry.name,
      fileSize: stat.size,
      width,
      height,
      expectedRaw10PackedSize: packedSize,
      expectedRaw10UnpackedSize: unpackedSize,
      detectedPacking,
      alignment,
      sample: {
        words,
        leWithin10: ratio(leWithin10),
        beWithin10: ratio(beWithin10),
        leLow6Zero: ratio(leLow6Zero),
        beLow6Zero: ratio(beLow6Zero),
        leMax,
        beMax,
      },
    };
  });

console.log(JSON.stringify(files, null, 2));
