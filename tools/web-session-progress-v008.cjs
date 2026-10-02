const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const delay = ms => new Promise(r=>setTimeout(r,ms));
const root = path.resolve(__dirname,'..');
app.whenReady().then(async()=>{
  const win = new BrowserWindow({show:false});
  await win.loadURL(process.env.MEDIALAB_TEST_URL || 'http://127.0.0.1:17861/');
  await delay(300);
  const run = code => win.webContents.executeJavaScript(code);
  await run(`window.__progress=[]; window.__workers=0; window.__terminated=0;
    const WorkerOriginal=window.Worker;
    window.Worker=class extends WorkerOriginal {
      constructor(...args){super(...args);window.__workers++;this.addEventListener('message',e=>window.__progress.push(e.data.percent));}
      terminate(){window.__terminated++;super.terminate();}
    }; void 0;`);
  win.webContents.debugger.attach('1.3');
  const input=path.join(root,'artifacts/compare-fixtures/rtos_ch0_before.h265');
  async function select() {
    const {root:dom} = await win.webContents.debugger.sendCommand('DOM.getDocument');
    const {nodeId} = await win.webContents.debugger.sendCommand('DOM.querySelector',{nodeId:dom.nodeId,selector:'input[type=file]'});
    await win.webContents.debugger.sendCommand('DOM.setFileInputFiles',{nodeId,files:[input]});
    await delay(100);
  }
  async function parse() {
    await select(); await run("document.querySelector('.parse-button').click()");
    for(let i=0;i<100;i++){if(await run("!!document.querySelector('.stream-workspace')")) return;await delay(50);}
    throw Error('Web parse timed out');
  }
  await parse();
  await run("[...document.querySelectorAll('.topbar button')].find(b=>b.textContent==='返回首页').click()");
  await delay(80);
  await parse();
  const report = await run('({workers:window.__workers,terminated:window.__terminated,progress:window.__progress})');
  assert.equal(report.workers,2,'same file is parsed anew');
  assert.equal(report.terminated,2,'finished workers release buffers');
  assert.ok(report.progress.some(p=>p>0 && p<100));
  await run("[...document.querySelectorAll('.topbar button')].find(b=>b.textContent==='返回首页').click()");
  await delay(80); await select();
  // Start and cancel in the same event turn, before the real worker can finish.
  await run("document.querySelector('.parse-button').click(); [...document.querySelectorAll('.topbar button')].find(b=>b.textContent==='返回首页').click();");
  await delay(500);
  assert.ok(await run("!!document.querySelector('.landing') && !document.querySelector('.stream-workspace') && !document.querySelector('.parse-progress')"));
  assert.equal(await run('window.__workers'),3);
  assert.equal(await run('window.__terminated'),3);
  report.cancelled=true;
  fs.writeFileSync(path.join(root,'artifacts/web-session-progress-v008.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2)); app.quit();
}).catch(e=>{console.error(e);app.exit(1)});
