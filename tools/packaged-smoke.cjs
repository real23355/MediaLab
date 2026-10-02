const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const path = require('node:path');
const executable = path.resolve(__dirname,'../release/MediaLab-Windows/MediaLab.exe');
const child = spawn(executable,['--remote-debugging-port=19227'],{windowsHide:true,stdio:'ignore'});
const delay = ms => new Promise(resolve=>setTimeout(resolve,ms));
async function command(url,method,params={}) {
  const ws = new WebSocket(url);
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject});
  return new Promise((resolve,reject)=>{
    ws.onmessage=event=>{const data=JSON.parse(event.data);if(data.id===1){ws.close();data.error?reject(Error(JSON.stringify(data.error))):resolve(data.result)}};
    ws.send(JSON.stringify({id:1,method,params}));
  });
}
(async()=>{
  let pages;
  for(let i=0;i<50;i++) {
    try { pages=await (await fetch('http://127.0.0.1:19227/json')).json(); if(pages.some(p=>p.type==='page'))break; } catch {}
    await delay(200);
  }
  const page=pages.find(p=>p.type==='page');
  await delay(500);
  const result=await command(page.webSocketDebuggerUrl,'Runtime.evaluate',{expression:'JSON.stringify({title:document.title,version:document.querySelector(".brand b").textContent,home:!!document.querySelector("#home"),ipc:typeof window.desktop.probeStream})',returnByValue:true});
  const value=JSON.parse(result.result.value);
  assert.equal(value.version,`V${require('../desktop/package.json').version}`); assert.equal(value.ipc,'function'); assert.ok(value.home);
  process.stdout.write(JSON.stringify(value)+'\n');
  await command(page.webSocketDebuggerUrl,'Runtime.evaluate',{expression:'window.close()'}).catch(()=>{});
})().catch(e=>{process.stderr.write(e.stack+'\n');process.exitCode=1}).finally(()=>{child.kill();});
