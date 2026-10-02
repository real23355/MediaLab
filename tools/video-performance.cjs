const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
const started = performance.now();
require('../desktop/src/main.cjs');
app.whenReady().then(async () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (win.webContents.isLoading()) await new Promise(r => win.webContents.once('did-finish-load', r));
  win.hide();
  const readyMs = performance.now() - started;
  const files = ['rtos_ch0_before.h265', 'rtos_ch0.h265', 'left.h264'].map(n => path.join(root, 'artifacts/compare-fixtures', n));
  const result = await win.webContents.executeJavaScript(`(async () => {
    const results=[];
    for(const file of ${JSON.stringify(files)}) {
      const kind=file.endsWith('.h264')?'h264':'h265';
      const start=performance.now();
      const analysis=await window.desktop.probeStream(file,kind);
      const probeMs=performance.now()-start;
      const proxy=await window.desktop.createProxy(file,kind,30,analysis.frames.length);
      results.push({file,probeMs,totalMs:performance.now()-start,frames:analysis.frames.length,decoder:proxy.decoder,encoder:proxy.encoder,url:proxy.url});
    }
    return results;
  })()`);
  assert.ok(result.every(r => r.frames > 0 && r.url));
  const report={readyMs,results:result};
  fs.writeFileSync(path.join(root,'artifacts',`performance-${process.env.MEDIALAB_BENCH_LABEL || 'latest'}.json`),JSON.stringify(report,null,2));
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
  app.quit();
}).catch(e=>{process.stderr.write(e.stack+'\n');app.exit(1)});
