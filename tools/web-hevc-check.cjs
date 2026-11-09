const {app,BrowserWindow}=require('electron'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');let site='';const delay=ms=>new Promise(r=>setTimeout(r,ms));
app.on('window-all-closed',()=>{});
const server=http.createServer((q,r)=>{const p=path.resolve(site,'.'+(q.url==='/'?'/index.html':q.url.split('?')[0]));fs.readFile(p,(e,b)=>{if(e)return r.writeHead(404).end();r.setHeader('Content-Type',p.endsWith('.js')?'application/javascript':p.endsWith('.css')?'text/css':'text/html');r.end(b);});});
app.whenReady().then(async()=>{
 await new Promise(r=>server.listen(17863,'127.0.0.1',r));const report=[];
 for(const [label,folder] of [['v008','release/MediaLab-Web'],['v009','web/dist/client']]){
  site=path.join(root,folder);const win=new BrowserWindow({show:false});await win.loadURL('http://127.0.0.1:17863/');await delay(200);const run=s=>win.webContents.executeJavaScript(s);win.webContents.debugger.attach('1.3');
  const {root:dom}=await win.webContents.debugger.sendCommand('DOM.getDocument');const {nodeId}=await win.webContents.debugger.sendCommand('DOM.querySelector',{nodeId:dom.nodeId,selector:'input[type=file]'});
  await win.webContents.debugger.sendCommand('DOM.setFileInputFiles',{nodeId,files:['rtos_ch0_before.h265','rtos_ch0.h265'].map(n=>path.join(root,'artifacts/compare-fixtures',n))});await delay(100);await run("document.querySelector('.parse-button').click()");await delay(600);await run("[...document.querySelectorAll('.topbar button')].find(b=>b.textContent==='Compare').click()");await delay(100);await run("document.querySelector('.video-compare-content .primary').click()");await delay(2500);
  const state=await run("({labels:[...document.querySelectorAll('.current-frame-badge strong')].map(e=>e.textContent),errors:[...document.querySelectorAll('.video-compare-grid .empty-canvas')].map(e=>e.textContent),pixels:[...document.querySelectorAll('.compare-video-stage canvas')].map(c=>[...c.getContext('2d').getImageData(100,100,1,1).data])})");report.push({label,...state});win.destroy();
 }
 fs.writeFileSync(path.join(root,'artifacts/web-hevc-baseline-v009.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));server.close();app.quit();
}).catch(e=>{console.error(e);server.close();app.exit(1);});
