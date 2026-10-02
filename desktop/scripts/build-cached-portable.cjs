const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const version = require('../package.json').version;
const payload = path.join(root,'release','win-unpacked');
const hash = crypto.createHash('sha256');
function digest(directory) {
  for (const entry of fs.readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) {
    const file = path.join(directory,entry.name);
    if(entry.isDirectory()) digest(file);
    else { hash.update(path.relative(payload,file)); hash.update(fs.readFileSync(file)); }
  }
}
digest(payload);
const key = `${version}-${hash.digest('hex').slice(0,20)}`;
const cache = path.join(process.env.LOCALAPPDATA,'electron-builder','Cache');
function locate(directory) {
  for(const e of fs.readdirSync(directory,{withFileTypes:true})) {
    const p=path.join(directory,e.name);
    if(e.isFile() && e.name==='makensis.exe') return p;
    if(e.isDirectory()){const found=locate(p);if(found)return found;}
  }
}
const nsis = process.env.MEDIALAB_MAKENSIS || fs.readdirSync(cache).filter(n=>n.startsWith('nsis')).map(n=>locate(path.join(cache,n))).find(Boolean);
if(!nsis) throw Error('NSIS not found; build the electron-builder portable target once first.');
const output=path.join(root,'release',`MediaLab-Portable-${version}.exe`);
const result=spawnSync(nsis,['/V2',`/DVERSION=${version}`,`/DCACHE_KEY=${key}`,`/DPAYLOAD=${payload}`,`/DOUTPUT=${output}`,`/DICON=${path.join(root,'build','icon.ico')}`,path.join(root,'build','cached-portable.nsi')],{stdio:'inherit',windowsHide:true});
if(result.status!==0) process.exit(result.status || 1);
console.log(`Cached portable built: ${key}`);
