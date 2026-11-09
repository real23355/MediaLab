const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),delay=ms=>new Promise(r=>setTimeout(r,ms));
const input='\\\\192.168.0.112\\GPT\\data\\media_lab\\cap_raw_w5320_h3032_12b_unpack.raw';
const unnamed=path.join(root,'artifacts/compare-fixtures/no_dimensions.raw');
fs.copyFileSync(input,unnamed);
require('../desktop/src/main.cjs');
app.whenReady().then(async()=>{
 const win=BrowserWindow.getAllWindows()[0];if(win.webContents.isLoading())await new Promise(r=>win.webContents.once('did-finish-load',r));win.hide();
 const run=s=>win.webContents.executeJavaScript(s);
 async function wait(expr){for(let i=0;i<300;i++){if(await run(expr))return;await delay(50);}throw Error('Timeout: '+expr);}
 async function start(file){await run(`(async()=>{await receiveInfos([await window.desktop.fileInfo(${JSON.stringify(file)})]);window.__rawParse=parsePendingFiles();})()`);await wait("!!document.querySelector('.raw-config-dialog[open]')");}
 const results=[];
 for(const file of [input,unnamed]){
  await start(file);
  assert.equal(await run("document.querySelector('.raw-config-dialog input[name=width]').value"),'');
  await run("(()=>{const f=document.querySelector('.raw-config-dialog form');f.elements.width.value='5320';f.elements.height.value='3000';f.elements.bitDepth.value='12';f.requestSubmit();})()");
  assert.ok(await run("document.querySelector('.raw-config-error').textContent.includes('对不上')"));
  fs.writeFileSync(path.join(root,'artifacts/raw-manual-desktop-dialog.png'),(await win.webContents.capturePage()).toPNG());
  await run("(()=>{const f=document.querySelector('.raw-config-dialog form');f.elements.height.value='3032';f.requestSubmit();return window.__rawParse;})()");
  const doc=await run("({width:state.docs[0]?.config.width,height:state.docs[0]?.config.height,bitDepth:state.docs[0]?.config.bitDepth,values:state.docs[0]?.values.length,min:state.docs[0]?.levels.min,max:state.docs[0]?.levels.max,canvas:document.querySelector('#raw-canvas').width})");
  assert.deepEqual(doc,{width:5320,height:3032,bitDepth:12,values:16130240,min:212,max:4095,canvas:5320});results.push({file,...doc});
  await run('returnHome();resetSessionPromise;');
 }
 await start(unnamed);await run("document.querySelector('.raw-config-dialog [data-cancel]').click();window.__rawParse;");
 assert.equal(await run('state.pending.length'),1);assert.equal(await run("document.querySelector('#parse-files').disabled"),false);
 await run("window.__rawParse=parsePendingFiles();void 0;");await wait("!!document.querySelector('.raw-config-dialog[open]')");
 await run('returnHome();Promise.all([resetSessionPromise,window.__rawParse]);');
 assert.equal(await run('state.docs.length'),0);assert.equal(await run("!!document.querySelector('.raw-config-dialog')"),false);
 // Existing recognised RAW still takes the automatic path.
 const auto=path.join(root,'artifacts/compare-fixtures/auto_64x64_RGGB_12bit.raw');fs.writeFileSync(auto,Buffer.alloc(64*64*2));
 await run(`(async()=>{await receiveInfos([await window.desktop.fileInfo(${JSON.stringify(auto)})]);await parsePendingFiles();})()`);
 assert.equal(await run('state.docs[0].config.width'),64);assert.equal(await run("!!document.querySelector('.raw-config-dialog')"),false);
 console.log(JSON.stringify({results,cancelKeepsFile:true,returnHomeCancels:true,autoStillWorks:true},null,2));app.quit();
}).catch(e=>{console.error(e);app.exit(1);});
