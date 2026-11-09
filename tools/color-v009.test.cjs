const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const ts=require('../web/node_modules/typescript');
const exportsWeb={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../web/lib/media.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:exportsWeb,Uint8Array,Math,TextDecoder,Map});
const context={window:{},ImageData:class{constructor(w,h){this.width=w;this.height=h;this.data=new Uint8ClampedArray(w*h*4);}},Uint8Array,Math,TextDecoder};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../desktop/src/media.js'),'utf8'),context);
test('Web and desktop color matrices/ranges match without changing samples',()=>{
 for(const colorMatrix of ['bt601','bt709','bt2020'])for(const colorRange of ['limited','full'])for(const [y,u,v] of [[16,128,128],[235,128,128],[81,90,240],[145,54,34],[0,255,0]]){
  const buffer=Uint8Array.from([y,y,y,y,u,v]),before=Uint8Array.from(buffer);
  const actual=context.window.MediaTools.renderYuv(buffer,2,2,'I420','rgb',{colorMatrix,colorRange}).data.slice(0,3);
  assert.deepEqual(Array.from(actual),Array.from(exportsWeb.yuvToRgb(y,u,v,colorMatrix,colorRange)));assert.deepEqual(buffer,before);
 }
});
test('Full/limited neutral endpoints and BT.2020 full vector',()=>{
 assert.deepEqual(Array.from(exportsWeb.yuvToRgb(16,128,128,'bt709','limited')),[0,0,0]);
 assert.deepEqual(Array.from(exportsWeb.yuvToRgb(235,128,128,'bt709','limited')),[255,255,255]);
 assert.deepEqual(Array.from(exportsWeb.yuvToRgb(0,128,128,'bt2020','full')),[0,0,0]);
 assert.deepEqual(Array.from(exportsWeb.yuvToRgb(255,128,128,'bt2020','full')),[255,255,255]);
 assert.deepEqual(Array.from(exportsWeb.yuvToRgb(81,90,240,'bt2020','full')),[246,23,10]);
});
