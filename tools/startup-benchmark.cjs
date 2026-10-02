const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const delay = ms => new Promise(r => setTimeout(r, ms));
async function command(url, method, params = {}) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { ws.close(); reject(Error('CDP timeout')); }, 5000);
    ws.onmessage = event => { const data = JSON.parse(event.data); if (data.id === 1) { clearTimeout(timeout); ws.close(); data.error ? reject(Error(JSON.stringify(data.error))) : resolve(data.result); } };
    ws.send(JSON.stringify({ id: 1, method, params }));
  });
}
async function measure(label, relative, port) {
  const executable = path.join(root, relative);
  const started = performance.now();
  const child = spawn(executable, [`--remote-debugging-port=${port}`], { windowsHide:true, stdio:'ignore' });
  let page;
  try {
    while (performance.now() - started < 120000) {
      try {
        const pages = await (await fetch(`http://127.0.0.1:${port}/json`, { signal:AbortSignal.timeout(1000) })).json();
        page = pages.find(p => p.type === 'page');
        if (page) {
          const data = await command(page.webSocketDebuggerUrl, 'Runtime.evaluate', { expression:'document.readyState === "complete" && typeof window.desktop?.probeStream === "function" && document.querySelector(".brand b")?.textContent', returnByValue:true });
          if (data.result.value) {
            const result = { label, executable, readyMs:performance.now()-started, version:data.result.value };
            console.log(JSON.stringify(result)); return result;
          }
        }
      } catch {}
      await delay(100);
    }
    throw Error(`${label} timed out`);
  } finally {
    if (page) await command(page.webSocketDebuggerUrl,'Runtime.evaluate',{expression:'window.close()'}).catch(()=>{});
    await delay(700);
    child.kill();
  }
}
(async () => {
  const cases = [
    ['v007-first-process','release/MediaLab-Portable-0.0.7.exe'],
    ['v007-repeat','release/MediaLab-Portable-0.0.7.exe'],
    ['v008-first-extraction','desktop/release/MediaLab-Portable-0.0.8.exe'],
    ['v008-repeat','desktop/release/MediaLab-Portable-0.0.8.exe'],
    ['v008-directory','desktop/release/win-unpacked/MediaLab.exe'],
  ];
  const results = [];
  for (const [i, [label, file]] of cases.entries()) results.push(await measure(label,file,19320+i));
  assert.ok(results.filter(r=>r.label.startsWith('v008')).every(r=>r.version==='V0.0.8'));
  fs.writeFileSync(path.join(root,'artifacts/startup-v008.json'),JSON.stringify({ note:'Local wall-clock process-start to ready DOM; OS file cache not purged; 100 ms polling resolution.',results },null,2));
})().catch(error => { console.error(error); process.exitCode=1; });
