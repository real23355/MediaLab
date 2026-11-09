const {app,BrowserWindow}=require('electron');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),ffmpeg=path.join(root,'desktop/ffmpeg/bin/ffmpeg.exe');
require('../desktop/src/main.cjs');
app.whenReady().then(async()=>{
 const win=BrowserWindow.getAllWindows()[0];if(win.webContents.isLoading())await new Promise(r=>win.webContents.once('did-finish-load',r));win.hide();
 const run=s=>win.webContents.executeJavaScript(s),fixtures=path.join(root,'artifacts/compare-fixtures');
 await run('window.__updates=[]; window.desktop.onProgress(p=>window.__updates.push(p)); void 0;');
 const results=[];
 const tenbit=spawnSync(ffmpeg,['-v','error','-f','lavfi','-i','testsrc2=size=64x64:rate=25','-frames:v','6','-pix_fmt','yuv420p10le','-c:v','libx265','-preset','ultrafast','-x265-params','log-level=error:pools=1:bframes=0','-y',path.join(fixtures,'native10.h265')],{windowsHide:true});assert.equal(tenbit.status,0,tenbit.stderr.toString());
 for(const name of ['left.h264','rtos_ch0_before.h265','rtos_ch0.h265','native10.h265']){
  const input=path.join(fixtures,name),kind=name.endsWith('h264')?'h264':'h265',index=name==='native10.h265'?4:name.endsWith('h264')?20:120;
  const metadata=await run(`window.desktop.probeStream(${JSON.stringify(input)},${JSON.stringify(kind)})`);
  const frame=await run(`window.desktop.extractFrame(${JSON.stringify(input)},${JSON.stringify(kind)},${index},${metadata.width},${metadata.height},${JSON.stringify(metadata.pixelFormat)},'exact-test')`);
  const reference=spawnSync(ffmpeg,['-v','error','-f',kind==='h265'?'hevc':'h264','-i',input,'-vf',`select=eq(n\\,${index})`,'-frames:v','1','-pix_fmt',metadata.pixelFormat,'-f','rawvideo','pipe:1'],{maxBuffer:80*1024*1024,windowsHide:true});
  assert.equal(reference.status,0,reference.stderr.toString());assert.deepEqual(Buffer.from(frame.bytes),reference.stdout,'native frame must be byte exact');
  assert.equal(Buffer.from(frame.png).subarray(1,4).toString(),'PNG');results.push({name,index,pixelFormat:metadata.pixelFormat,bytes:reference.stdout.length,byteExact:true});
 }
 const file=path.join(fixtures,'rtos_ch0.h265');
 await run(`(async()=>{await receiveInfos([await window.desktop.fileInfo(${JSON.stringify(file)})]);await parsePendingFiles();})()`);
 await run(`state.streams.push({...state.streams[0],id:'right-test',fps:24});state.leftId=state.streams[0].id;state.rightId='right-test';state.compareMode=true;renderStreamCompare();state.alignment='frame';state.frameOffset=3;seekCompareVideo('left',1,true);`);
 const aligned=await run(`({right:document.querySelector('#stream-compare [data-side="right"] video').currentTime,target:alignedTime('left',1),back:alignedTime('right',33/24)})`);
 assert.ok(Math.abs(aligned.right-33/24)<.01);assert.equal(aligned.target,33/24);assert.equal(aligned.back,1);
 await run(`document.querySelector('#stream-compare .detail-chart').open=true;document.querySelector('#stream-compare .detail-chart [data-zoom=".5"]').click();`);
 const detail=await run(`({canvas:document.querySelector('.detail-chart canvas').width,popup:!!document.querySelector('.detail-chart[open] .detail-popup')})`);assert.equal(detail.canvas,1000);assert.ok(detail.popup);
 await run(`showOriginalFrame(state.streams[0],120);void 0;`);
 for(let n=0;n<200;n++){if(await run(`document.querySelector('.original-message')?.textContent.includes('完成')`))break;await new Promise(r=>setTimeout(r,50));}
 assert.ok(await run(`document.querySelector('.original-dialog img').naturalWidth===2560`));
 fs.writeFileSync(path.join(root,'artifacts/desktop-original-v009.png'),(await win.webContents.capturePage()).toPNG());
 await run(`closeOriginalFrame();`);
 await run(`returnHome();resetSessionPromise;`);
 // Real 4K RAW file, progress and worker rendering.
 const rawfile=path.join(fixtures,'progress_3840x2160_RGGB_10bit.raw');
 const rawbytes=Buffer.alloc(3840*2160*2);for(let i=0;i<rawbytes.length;i+=2)rawbytes.writeUInt16LE((i/2)%1024,i);fs.writeFileSync(rawfile,rawbytes);
 const raw=await run(`(async()=>{window.__workPercents=[];const observer=new MutationObserver(()=>document.querySelectorAll('.work-progress progress').forEach(p=>window.__workPercents.push(p.value)));observer.observe(document.body,{subtree:true,childList:true,attributes:true});await receiveInfos([await window.desktop.fileInfo(${JSON.stringify(rawfile)})]);await parsePendingFiles();observer.disconnect();return {kind:state.docs[0]?.kind,values:state.docs[0]?.values.length,width:document.querySelector('#raw-canvas').width,percents:window.__workPercents};})()`);
 assert.equal(raw.kind,'raw');assert.equal(raw.values,3840*2160);assert.equal(raw.width,3840);assert.ok(raw.percents.some(p=>p>0&&p<100));
 await run(`returnHome();resetSessionPromise;`);
 const yuvfile=path.join(fixtures,'color_4x2_NV12.yuv');fs.writeFileSync(yuvfile,Buffer.from([16,235,81,145,16,235,81,145,90,240,54,34]));
 const colors=await run(`(async()=>{await receiveInfos([await window.desktop.fileInfo(${JSON.stringify(yuvfile)})]);await parsePendingFiles();const d=activeDocument();if(!d)throw Error(document.querySelector('#toast').textContent);d.config={width:4,height:2,format:'NV12',frameBytes:12,frameCount:1,dataOffset:0};await renderYuvFrame();const c=document.querySelector('#yuv-canvas'),a=[...c.getContext('2d').getImageData(0,0,4,2).data];d.config.colorMatrix='bt709';d.config.colorRange='full';await renderYuvFrame();return {a,b:[...c.getContext('2d').getImageData(0,0,4,2).data],sample:M.displaySample(d.yuvFrameData,4,2,'NV12','rgb',0,0)};})()`);
 assert.notDeepEqual(colors.a,colors.b);assert.equal(colors.sample.yValue,16);assert.equal(colors.sample.uValue,90);assert.equal(colors.sample.vValue,240);
 const report={frames:results,aligned,detail,raw:{...raw,percents:raw.percents.slice(0,50)},colors};fs.writeFileSync(path.join(root,'artifacts/p0-v009.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));app.quit();
}).catch(e=>{console.error(e);app.exit(1);});
