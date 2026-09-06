const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const root = path.join(__dirname,'..');
const delay = ms => new Promise(resolve => setTimeout(resolve,ms));
app.whenReady().then(async () => {
  const win = new BrowserWindow({show:false,width:1920,height:1080,useContentSize:true});
  const run = code => win.webContents.executeJavaScript(code);
  await win.loadURL(process.env.MEDIALAB_TEST_URL || 'http://localhost:3000/');
  await delay(500);
  await run(`window.__decodeErrors=[]; const OriginalDecoder=window.VideoDecoder;
    window.VideoDecoder=class extends OriginalDecoder {
      constructor(init){super({...init,error:e=>{window.__decodeErrors.push(e.message);init.error(e)}})}
      decode(chunk){try{return super.decode(chunk)}catch(e){window.__decodeErrors.push(e.message);throw e}}
    }; void 0;`);
  const home = await run(`(() => {
    const home = document.querySelector('.landing');
    home.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true}));
    const highlighted = home.classList.contains('dragging');
    return {width:home.clientWidth,height:home.clientHeight,redText:!!home.querySelector('.feature-row,h1 span'),highlighted};
  })()`);
  // React commits the drag feedback on the next frame.
  await delay(50);
  home.highlighted = await run("document.querySelector('.landing').classList.contains('dragging')");
  assert.ok(home.highlighted && !home.redText && home.width>1500);
  win.webContents.debugger.attach('1.3');
  const {root:dom} = await win.webContents.debugger.sendCommand('DOM.getDocument');
  const {nodeId} = await win.webContents.debugger.sendCommand('DOM.querySelector',{nodeId:dom.nodeId,selector:'input[type=file]'});
  await win.webContents.debugger.sendCommand('DOM.setFileInputFiles',{nodeId,files:['rtos_ch0_before.h265','rtos_ch0.h265'].map(n=>path.join(root,'artifacts','compare-fixtures',n))});
  await delay(300);
  await run("document.querySelector('.parse-button').click()");
  for(let i=0;i<120;i++) {
    if(await run("!!document.querySelector('.stream-workspace')")) break;
    await delay(200);
  }
  assert.ok(await run("!!document.querySelector('.stream-workspace')"));
  await delay(500);
  const results = [];
  for (const compare of [false,true]) {
    if(compare) await run("[...document.querySelectorAll('.topbar button')].find(b=>b.textContent==='Compare').click()");
    await delay(300);
    for(const [w,h] of [[1920,1080],[1366,768],[1100,720]]) {
      win.setContentSize(w,h); await delay(180);
      const m = await run(`(() => {
        const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right}};
        const compare=!!document.querySelector('.stream-workspace.comparing');
        return {width:innerWidth,height:innerHeight,compare,scroll:document.documentElement.scrollHeight,
        videos:[...document.querySelectorAll(compare?'.video-compare-grid canvas':'.stream-layout canvas')].map(rect),
        charts:[...document.querySelectorAll(compare?'.video-compare-grid .frame-chart':'.frame-analysis .frame-chart')].map(rect)};
      })()`);
      results.push(m);
      for(const r of [...m.videos,...m.charts]) assert.ok(r.height>40 && r.width>100 && r.bottom<=m.height+2 && r.right<=m.width+2,JSON.stringify(m));
      assert.ok(m.scroll<=m.height+2,JSON.stringify(m));
    }
    win.setContentSize(1920,1080); await delay(150);
    fs.writeFileSync(path.join(root,'artifacts',`web-v007-${compare?'compare':'single'}.png`),(await win.webContents.capturePage()).toPNG());
  }
  await run("document.querySelector('.video-compare-content .primary').click()");
  await delay(2500);
  const playing = await run("[...document.querySelectorAll('.video-compare-grid .current-frame-badge strong')].map(e=>e.textContent)");
  const canvases = await run("[...document.querySelectorAll('.video-compare-grid canvas')].map(c=>({width:c.width,height:c.height,pixel:[...c.getContext('2d').getImageData(100,100,1,1).data]}))");
  await run("document.querySelectorAll('.video-compare-grid .frame-chart button')[25].click()");
  await delay(1000);
  const click = await run("[...document.querySelectorAll('.video-compare-grid .current-frame-badge strong')].map(e=>e.textContent)");
  const support = await run("[...document.querySelectorAll('.video-compare-grid .empty-canvas')].map(e=>e.textContent)");
  const decodeErrors=await run('window.__decodeErrors');
  assert.ok(playing.every(value=>Number(value.slice(1))>60),JSON.stringify(playing));
  assert.ok(Math.abs(Number(playing[0].slice(1))-Number(playing[1].slice(1)))<=3,JSON.stringify(playing));
  assert.ok(canvases.every(c=>c.width===2560 && c.height===1440 && c.pixel[3]===255));
  assert.deepEqual(click,['#37','#37']);
  assert.deepEqual(decodeErrors,[]);
  await run("document.querySelectorAll('.video-compare-grid .frame-chart button')[90].click()");
  await delay(700);
  const validSeek = await run("[...document.querySelectorAll('.video-compare-grid .current-frame-badge strong')].map(e=>e.textContent)");
  assert.equal(validSeek[0],validSeek[1]);
  assert.ok(await run("[...document.querySelectorAll('.video-compare-grid .play-button')].every(e=>e.textContent==='▶')"));
  fs.writeFileSync(path.join(root,'artifacts','web-v007-compare-playing.png'),(await win.webContents.capturePage()).toPNG());
  const report={home,results,playing,canvases,click,validSeek,support,decodeErrors};
  fs.writeFileSync(path.join(root,'artifacts','web-video-v007-report.json'),JSON.stringify(report,null,2));
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
  win.destroy();app.quit();
}).catch(e=>{process.stderr.write(e.stack+'\n');app.exit(1)});
