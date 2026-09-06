import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    {
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the finished MediaLab product", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(
    html,
    /<title>MediaLab——视频码流与图像分析工具(?: · MediaLab)?<\/title>/i,
  );
  assert.match(html, /MediaLab/);
  assert.match(html, /视频码流与图像分析工具/);
  assert.match(html, /YUV \/ SYUV/);
  assert.match(html, /Bayer RAW/);
  assert.match(html, /HEIC/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|SkeletonPreview/i);
});

test("ships product metadata and no starter preview", async () => {
  const [page, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /MediaLab/);
  assert.match(layout, /heic2any/);
  assert.match(packageJson, /"name": "videoprobe-web"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await assert.rejects(access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)));
  await access(new URL("public/vendor/heic2any.js", root));
  await access(new URL("lib/raw.ts", root));
});

test("ships V0.0.7 compare and append controls", async () => {
  const [source, packageJson] = await Promise.all([
    readFile(new URL("../app/MediaLab.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  assert.match(source, /V0\.0\.7/);
  assert.match(packageJson, /"version": "0\.0\.7"/);
  assert.match(source, /Compare 图片对比/);
  assert.match(source, /Play Both/);
  assert.match(source, /Pause Both/);
  assert.match(source, /Sync View/);
  assert.match(source, /Sync Playback/);
  assert.match(source, /当前工作区为图片对比模式，只能添加图片类文件/);
  assert.match(source, /当前工作区为视频对比模式，只能添加 H\.264\/H\.265 视频文件/);
  assert.match(source, /TOTAL_FILE_LIMIT/);
});

test("preserves YUV RGB and Y/U/V component viewing", async () => {
  const [source, media, packageJson] = await Promise.all([
    readFile(new URL("../app/MediaLab.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/media.ts", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  assert.match(source, /YUV_DISPLAY_MODES/);
  assert.match(source, /onDisplayMode/);
  assert.match(source, /yuvPixelStatus/);
  assert.match(source, /PIXEL_OVERLAY_MIN_SIZE/);
  assert.match(source, /Pixel Values/);
  assert.match(source, /pixel-overlay/);
  assert.match(source, /stage\.scrollLeft/);
  assert.match(media, /label: "YUV \/ RGB"/);
  assert.match(media, /mode === "u"/);
  assert.match(media, /format === "NV12" \? \[first, second\] : \[second, first\]/);
  assert.match(packageJson, /"version": "0\.0\.7"/);
});
