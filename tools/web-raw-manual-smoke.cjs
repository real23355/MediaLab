const {app,BrowserWindow}=require('electron'),http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),site=path.join(root,'web/dist/client'),fixtures=path.join(root,'artifacts/compare-fixtures'),delay=ms=>new Promise(r=>setTimeout(r,ms));
const server=http.createServer((q,r)=>{const p=path.resolve(site,'.'+(q.url==='/'?'/index.html':q.url.split('?')[0]));if(!p.startsWith(site+path.sep))return r.writeHead(403).end();fs.readFile(p,(e,b)=>{if(e)return r.writeHead(404).end();r.setHeader('Content-Type',p.endsWith('.js')?'application/javascript':p.endsWith('.css')?'text/css':'text/html');r.end(b);});});
app.whenReady().then(async()=>{
 await new Promise(r=>server.listen(17864,'127.0.0.1',r));const win=new BrowserWindow({show:false,width:1380,height:1000,webPreferences:{backgroundThrottling:false}});await win.loadURL('http://127.0.0.1:17864/');await delay(150);const run=s=>win.webContents.executeJavaScript(s);
 win.webContents.debugger.attach('1.3');
 async function wait(expr){for(let i=0;i<400;i++){if(await run(expr))return;await delay(50);}throw Error('Timeout: '+expr);}
 async function start(file){const {root:dom}=await win.webContents.debugger.sendCommand('DOM.getDocument');const {nodeId}=await win.webContents.debugger.sendCommand('DOM.querySelector',{nodeId:dom.nodeId,selector:'input[type=file]'});await win.webContents.debugger.sendCommand('DOM.setFileInputFiles',{nodeId,files:[file]});await delay(80);await run("document.querySelector('.parse-button').click()");await wait("!!document.querySelector('.raw-config-dialog[open]')");}
 const input=path.join(fixtures,'no_dimensions.raw');
 await start(input);
 await run(`(()=>{const f=document.querySelector('.raw-config-dialog form');for(const [name,value] of [['width','5320'],['height','3000']]){const e=f.elements[name];Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,value);e.dispatchEvent(new Event('input',{bubbles:true}));}f.elements.bitDepth.value='12';f.elements.bitDepth.dispatchEvent(new Event('change',{bubbles:true}));})()`);await delay(30);
 await run("document.querySelector('.raw-config-dialog form').requestSubmit()");await delay(50);
 assert.ok(await run("document.querySelector('.raw-config-error').textContent.includes('对不上')"));
 await delay(200);
 assert.ok(await run("document.querySelector('.raw-config-dialog[open]').getBoundingClientRect().height>300"));
 fs.writeFileSync(path.join(root,'artifacts/raw-manual-web-dialog.png'),(await win.webContents.capturePage()).toPNG());
 await run(`(()=>{const e=document.querySelector('.raw-config-dialog input[name=height]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'3032');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);await delay(30);await run("document.querySelector('.raw-config-dialog form').requestSubmit()");
 await wait("!!document.querySelector('[aria-label=\"Bayer RAW 图像预览\"]') && !document.querySelector('.work-progress')");
 const rendered=await run("({width:document.querySelector('[aria-label=\"Bayer RAW 图像预览\"]').width,height:document.querySelector('[aria-label=\"Bayer RAW 图像预览\"]').height,text:document.querySelector('#root')?.textContent||document.body.textContent})");assert.equal(rendered.width,5320);assert.equal(rendered.height,3032);assert.ok(rendered.text.includes('12'));
 await run("document.querySelector('.brand-button').click()");await delay(100);
 await start(input);await run("document.querySelector('.raw-config-actions button').click()");await delay(100);assert.equal(await run("document.querySelector('.parse-button').disabled"),false);
 await run("document.querySelector('.parse-button').click()");await wait("!!document.querySelector('.raw-config-dialog[open]')");
 await run("document.querySelector('.raw-config-dialog').dispatchEvent(new Event('cancel',{cancelable:true}))");await delay(100);assert.equal(await run("!!document.querySelector('.raw-config-dialog')"),false);
 console.log(JSON.stringify({width:rendered.width,height:rendered.height,unnamedFile:true,sizeValidation:true,cancelKeepsFile:true,retry:true},null,2));win.destroy();server.close();app.quit();
}).catch(e=>{console.error(e);server.close();app.exit(1);});
