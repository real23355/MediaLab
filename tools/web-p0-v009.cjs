const {app,BrowserWindow}=require('electron');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),site=path.join(root,'web/dist/client'),fixtures=path.join(root,'artifacts/compare-fixtures');
const hevc=process.env.MEDIALAB_TEST_HEVC==='1';
const server=http.createServer((req,res)=>{const file=path.resolve(site,'.'+decodeURIComponent(req.url.split('?')[0]==='/'?'/index.html':req.url.split('?')[0]));if(!file.startsWith(site+path.sep)){res.writeHead(403).end();return;}fs.readFile(file,(e,data)=>{if(e){res.writeHead(404).end();return;}res.setHeader('Content-Type',({'.js':'application/javascript','.css':'text/css','.html':'text/html'})[path.extname(file)]||'application/octet-stream');res.end(data);});});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
 await new Promise(r=>server.listen(17862,'127.0.0.1',r));const win=new BrowserWindow({show:false,width:1920,height:1080});await win.loadURL('http://127.0.0.1:17862');await delay(200);const run=c=>win.webContents.executeJavaScript(c);
 const errors=[];win.webContents.on('console-message',e=>{if(e.level==='error')errors.push(e.message);});
 win.webContents.debugger.attach('1.3');
 async function pick(names){const {root:dom}=await win.webContents.debugger.sendCommand('DOM.getDocument');const {nodeId}=await win.webContents.debugger.sendCommand('DOM.querySelector',{nodeId:dom.nodeId,selector:'input[type=file]'});await win.webContents.debugger.sendCommand('DOM.setFileInputFiles',{nodeId,files:names.map(n=>path.join(fixtures,n))});await delay(80);await run("document.querySelector('.parse-button').click()");}
 async function wait(expression){for(let i=0;i<300;i++){if(await run(expression))return;await delay(50);}throw Error('Timeout: '+expression+' / '+await run("document.querySelector('dialog')?.textContent||document.body.textContent.slice(-700)"));}
 async function home(){await run("document.querySelector('.brand-button').click()");await delay(150);}
 fs.copyFileSync(path.join(fixtures,'left.h264'),path.join(fixtures,'left_copy.h264'));
 await pick(hevc?['rtos_ch0_before.h265','rtos_ch0.h265']:['left.h264','left_copy.h264']);await wait("document.querySelectorAll('.stream-tab').length>=0 && !!document.querySelector('.stream-workspace') && !document.querySelector('.parse-button')");await delay(500);
 await run("[...document.querySelectorAll('.topbar button')].find(b=>b.textContent==='Compare').click()");await delay(100);
 if(hevc){await run("document.querySelector('.video-compare-content .primary').click()");await delay(2500);await run("[...document.querySelectorAll('.video-compare-content button')].find(b=>b.textContent.includes('Pause Both')).click()");}
 let exact;
 if(hevc){await run("document.querySelector('.video-compare-grid .original-frame-button').click()");await wait("!!document.querySelector('dialog[open]') && document.querySelector('dialog p').textContent.includes('100%')");exact=await run("({width:document.querySelector('dialog canvas').width,height:document.querySelector('dialog canvas').height,message:document.querySelector('dialog p').textContent})");await run("document.querySelector('dialog button').click()");}
 await run("document.querySelector('[aria-label=对齐]').value='frame';document.querySelector('[aria-label=对齐]').dispatchEvent(new Event('change',{bubbles:true}));const o=document.querySelector('[aria-label=右侧偏移]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(o,'3');o.dispatchEvent(new Event('input',{bubbles:true}));");await delay(100);
 await run(`document.querySelectorAll('.video-compare-grid .frame-chart button')[${hevc?90:20}].click()`);await delay(700);
 const aligned=await run("[...document.querySelectorAll('.video-compare-grid .current-frame-badge strong')].map(e=>Number(e.textContent.slice(1)))");assert.equal(aligned[1]-aligned[0],3);
 if(!hevc){await run("document.querySelector('.video-compare-grid .original-frame-button').click()");await wait("!!document.querySelector('dialog[open]') && document.querySelector('dialog p').textContent.includes('100%')");exact=await run("({width:document.querySelector('dialog canvas').width,height:document.querySelector('dialog canvas').height,message:document.querySelector('dialog p').textContent})");}
 assert.equal(exact.width,hevc?2560:320);assert.equal(exact.height,hevc?1440:240);
 fs.writeFileSync(path.join(root,'artifacts/web-original-v009.png'),(await win.webContents.capturePage()).toPNG());
 await run("document.querySelector('dialog button')?.click(); document.querySelector('.detail-chart').open=true;");await delay(100);
 assert.equal(await run("document.querySelector('.detail-chart canvas').width"),1000);
 await home();
 await run("window.__percents=[];new MutationObserver(()=>document.querySelectorAll('.work-progress progress').forEach(p=>window.__percents.push(p.value))).observe(document.body,{childList:true,subtree:true,attributes:true});void 0;");
 await pick(['progress_3840x2160_RGGB_10bit.raw']);await wait("!!document.querySelector('[aria-label=\"Bayer RAW 图像预览\"]') && !document.querySelector('.work-progress')");
 const raw=await run("({width:document.querySelector('[aria-label=\"Bayer RAW 图像预览\"]').width,progress:window.__percents})");assert.equal(raw.width,3840);assert.ok(raw.progress.some(p=>p>0&&p<100));
 await home();
 const bytes=Buffer.alloc(320*240*3/2,81);bytes.fill(90,320*240,320*240+320*240/4);bytes.fill(240,320*240+320*240/4);fs.writeFileSync(path.join(fixtures,'color_320x240_I420.yuv'),bytes);
 await pick(['color_320x240_I420.yuv']);await wait("!!document.querySelector('[aria-label=\"YUV 图像预览\"]') && !document.querySelector('.work-progress')");
 const before=await run("[...document.querySelector('[aria-label=\"YUV 图像预览\"]').getContext('2d').getImageData(0,0,1,1).data]");
 await run("const s=document.querySelector('[aria-label=色彩矩阵]');s.value='bt709';s.dispatchEvent(new Event('change',{bubbles:true}));");await delay(350);
 const after=await run("[...document.querySelector('[aria-label=\"YUV 图像预览\"]').getContext('2d').getImageData(0,0,1,1).data]");assert.notDeepEqual(before,after);
 const report={aligned,exact,raw:{width:raw.width,progressEvents:raw.progress.length},colors:{before,after},errors};fs.writeFileSync(path.join(root,'artifacts/web-p0-v009.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));win.destroy();server.close();app.quit();
}).catch(e=>{console.error(e);server.close();app.exit(1);});
