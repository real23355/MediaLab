const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const cp = require('node:child_process');
const realSpawn = cp.spawn;
let forceCpu = false;
const active = new Set();
cp.spawn = (file, args, options) => {
  if (forceCpu && file.endsWith('ffmpeg.exe') && args.includes('-hwaccel')) args = ['-invalid-hardware-test'];
  const child = realSpawn(file, args, options);
  active.add(child); child.once('close', () => active.delete(child));
  return child;
};
require('../desktop/src/main.cjs');
const root = path.resolve(__dirname, '..');
const delay = ms => new Promise(r => setTimeout(r, ms));
app.whenReady().then(async () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (win.webContents.isLoading()) await new Promise(r => win.webContents.once('did-finish-load', r));
  win.hide();
  const run = code => win.webContents.executeJavaScript(code);
  const files = ['rtos_ch0_before.h265', 'rtos_ch0.h265'].map(n => path.join(root, 'artifacts/compare-fixtures', n));
  await run(`window.__progress=[]; window.desktop.onProgress(p=>window.__progress.push(p)); void 0;`);
  const parse = () => run(`(async()=>{await receiveInfos(await Promise.all(${JSON.stringify(files)}.map(p=>window.desktop.fileInfo(p)))); await parsePendingFiles(); return state.streams.map(d=>({url:d.proxyUrl,frames:d.analysis.frames.length,encoder:d.encoder}));})()`);
  const first = await parse();
  assert.equal(first.length, 2);
  const updates = await run('window.__progress');
  assert.ok(updates.some(p => p.percent > 0 && p.percent < 45), 'probe byte progress');
  assert.ok(updates.some(p => p.percent >= 45 && p.percent < 100), 'proxy progress');
  assert.ok(updates.some(p => p.percent === 100));
  for (const id of new Set(updates.map(p => p.jobId))) {
    const values = updates.filter(p => p.jobId === id && p.percent != null).map(p => p.percent);
    assert.ok(values.every((p, i) => !i || p >= values[i - 1]), 'monotonic per-job progress');
  }
  await run(`document.querySelector('#compare-mode').click(); returnHome(); resetSessionPromise;`);
  const home = await run(`({compare:state.compareMode, label:document.querySelector('#compare-mode').textContent,streams:state.streams.length,analysis:state.stream.analysis,progressHidden:document.querySelector('#parse-progress').classList.contains('hidden')})`);
  assert.deepEqual(home, { compare:false, label:'Compare', streams:0, analysis:null, progressHidden:true });
  assert.ok(first.every(d => !fs.existsSync(fileURLToPath(d.url))), 'old proxies removed');
  const second = await parse();
  assert.ok(second.every((d, i) => d.url !== first[i].url), 'same files reparsed');
  assert.equal(await run(`document.querySelector('#compare-mode').textContent`), 'Compare');
  await run(`returnHome(); resetSessionPromise;`);
  // Cancel while FFprobe is running, then ensure it cannot resurrect old state.
  await run(`(async()=>{await receiveInfos([await window.desktop.fileInfo(${JSON.stringify(files[0])})]);window.__cancelledParse=parsePendingFiles();})()`);
  await delay(80);
  await run(`returnHome(); Promise.all([resetSessionPromise,window.__cancelledParse]);`);
  assert.equal(active.size, 0, 'cancelled processes have exited');
  assert.equal(await run('state.streams.length'), 0);
  assert.equal(await run('document.querySelector("#parse-files").disabled'), false);
  // Cancel proxy generation explicitly as well.
  await run(`window.__proxy=window.desktop.createProxy(${JSON.stringify(files[0])},'h265',30,297,'cancel-proxy').then(()=>false,()=>true); void 0;`);
  await delay(60);
  await run('window.desktop.resetSession()');
  assert.equal(await run('window.__proxy'), true);
  assert.equal(active.size, 0);
  // Force every GPU attempt to fail; CPU must still produce a playable proxy.
  forceCpu = true;
  const cpu = await run(`window.desktop.createProxy(${JSON.stringify(files[1])},'h265',30,224,'cpu-fallback')`);
  assert.equal(cpu.hardware, false); assert.equal(cpu.encoder, 'libx264');
  assert.ok(fs.existsSync(fileURLToPath(cpu.url)));
  await run('window.desktop.resetSession()');
  assert.ok(!fs.existsSync(fileURLToPath(cpu.url)));
  const report = { progressEvents:updates.length, stages:[...new Set(updates.map(p=>p.phase))], first, second, home, cancellation:true, cpuFallback:true };
  fs.writeFileSync(path.join(root,'artifacts/session-progress-v008.json'), JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
  app.quit();
}).catch(error => { console.error(error); app.exit(1); });
