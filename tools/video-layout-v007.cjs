// Runs the real desktop IPC / FFmpeg pipeline with user-supplied H.265 samples.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
require('../desktop/src/main.cjs');
app.whenReady().then(async () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (win.webContents.isLoading()) await new Promise(resolve => win.webContents.once('did-finish-load', resolve));
  win.hide();
  const run = code => win.webContents.executeJavaScript(code);
  const errors = [];
  win.webContents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push(message); });
  const inputs = ['rtos_ch0_before.h265', 'rtos_ch0.h265'].map(name => path.join(root, 'artifacts', 'compare-fixtures', name));
  await run(`(async () => {
    const files = await Promise.all(${JSON.stringify(inputs)}.map(p => window.desktop.fileInfo(p)));
    await receiveInfos(files);
    document.querySelector('#parse-files').click();
  })()`);
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    if (await run('state.streams.length === 2 && !document.querySelector("#parse-files").disabled')) break;
    await delay(500);
  }
  const docs = await run('state.streams.map(d => ({name:d.file.name, frames:d.analysis.frames.length, width:d.analysis.width, height:d.analysis.height, fps:d.fps, decoder:d.decoder, proxy:!!d.proxyUrl}))');
  assert.equal(docs.length, 2);
  assert.ok(docs.every(d => d.frames > 0 && d.proxy), JSON.stringify(docs));
  const measure = () => run(`(() => {
    const rect = node => { const r = node.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right}; };
    const compare = state.compareMode;
    const videos = [...document.querySelectorAll(compare ? '#stream-compare video' : '#stream-video')].map(rect);
    const charts = [...document.querySelectorAll(compare ? '#stream-compare .frame-chart' : '#frame-chart')].map(rect);
    return {width:innerWidth,height:innerHeight,compare,videos,charts,scrollHeight:document.documentElement.scrollHeight};
  })()`);
  const measurements = [];
  for (const compare of [false, true]) {
    await run(`state.compareMode = ${compare}; renderStreamCompare();`);
    for (const [width,height,zoom] of [[1920,1080,1],[1366,768,1],[1920,1080,1.5],[1100,720,1]]) {
      win.setContentSize(width,height);
      win.webContents.setZoomFactor(zoom);
      await delay(180);
      const m = await measure();
      measurements.push(m);
      for (const r of [...m.videos,...m.charts]) {
        assert.ok(r.width > 100 && r.height > 40, JSON.stringify(m));
        assert.ok(r.y >= 0 && r.bottom <= m.height + 2 && r.right <= m.width + 2, JSON.stringify(m));
      }
      assert.ok(m.charts.every((r,i) => r.y >= m.videos[i].bottom), JSON.stringify(m));
      assert.ok(m.scrollHeight <= m.height + 2, JSON.stringify(m));
    }
    win.setContentSize(1920,1080); win.webContents.setZoomFactor(1); await delay(200);
    fs.writeFileSync(path.join(root,'artifacts',`video-v007-${compare ? 'compare' : 'single'}.png`), (await win.webContents.capturePage()).toPNG());
  }
  const playback = await run(`(async () => {
    const videos = [...document.querySelectorAll('#stream-compare video')];
    await Promise.all(videos.map(v => v.readyState >= 2 ? Promise.resolve() : new Promise(resolve => v.addEventListener('loadeddata',resolve,{once:true}))));
    document.querySelector('#play-both').click();
    await new Promise(r => setTimeout(r,600));
    const bothPlaying = videos.every(v => !v.paused && v.currentTime > 0);
    const activeWhilePlaying = [...document.querySelectorAll('#stream-compare .frame-chart')].every(chart => chart.querySelector('.active'));
    const bar = document.querySelectorAll('#stream-compare [data-side="left"] .frame-chart button')[25];
    bar.click(); await new Promise(r => setTimeout(r,250));
    const pausedAfterClick = videos.every(v => v.paused);
    const times = videos.map(v => v.currentTime);
    const frame = Number(bar.dataset.frame);
    const expected = frame / state.streams[0].fps;
    const labels = [...document.querySelectorAll('#stream-compare .chart-current')].map(e => e.textContent);
    document.querySelector('#sync-playback').click();
    document.querySelector('#stream-compare [data-side="left"] [data-action="toggle"]').click();
    await new Promise(r => setTimeout(r,200));
    const independent = !videos[0].paused && videos[1].paused;
    document.querySelector('#pause-both').click();
    const divider = document.querySelector('#stream-compare .video-divider');
    const before = divider.nextElementSibling.getBoundingClientRect().height;
    divider.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true}));
    const after = divider.nextElementSibling.getBoundingClientRect().height;
    state.compareMode = false; renderStreamCompare();
    const single = document.querySelector('#stream-video');
    await single.play();
    selectStreamFrame(20,true); await new Promise(r => setTimeout(r,100));
    return {bothPlaying,activeWhilePlaying,pausedAfterClick,times,expected,labels,independent,before,after,singlePaused:single.paused,singleFrame:state.stream.currentFrame};
  })()`);
  assert.ok(playback.bothPlaying && playback.activeWhilePlaying && playback.pausedAfterClick && playback.independent && playback.singlePaused,JSON.stringify(playback));
  assert.ok(playback.times.every(t => Math.abs(t-playback.expected)<.06),JSON.stringify(playback));
  assert.ok(playback.after > playback.before,JSON.stringify(playback));
  assert.equal(playback.singleFrame,20);
  await run('returnHome()');
  assert.equal(await run('document.querySelector("#stream-workspace").classList.contains("comparing")'),false);
  const report = {docs,measurements,playback,errors};
  fs.writeFileSync(path.join(root,'artifacts','video-v007-report.json'),JSON.stringify(report,null,2));
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
  app.quit();
}).catch(error => {process.stderr.write(error.stack+'\n');app.exit(1);});
