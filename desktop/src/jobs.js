// Worker progress stays responsive even during 4K image processing.
window.MLJobs = (() => {
  const tasks = new Map();
  const panel = document.createElement("section");
  panel.className = "parse-progress work-progress hidden";
  panel.setAttribute("aria-live","polite");
  document.body.append(panel);
  function draw() {
    panel.classList.toggle("hidden", !tasks.size);
    panel.replaceChildren();
    for (const t of tasks.values()) {
      const title = document.createElement("div"); title.textContent = `${t.name} · ${t.phase} · ${Math.floor(t.percent)}%`;
      const bar = document.createElement("progress"); bar.max = 100; bar.value = t.percent;
      panel.append(title,bar);
    }
  }
  function begin(name) {
    const id = Symbol(); tasks.set(id,{name,phase:"准备",percent:0}); draw();
    return {update(percent,phase){const t=tasks.get(id);if(t){t.percent=percent;t.phase=phase;draw();}},end(){tasks.delete(id);draw();}};
  }
  const workers = new Set();
  let generation=0;
  function run(task,name) {
    if(task.action==="render-raw")task={action:task.action,values:task.values,config:task.config,mode:task.mode,levels:task.levels,autoStretch:task.autoStretch,blackLevel:task.blackLevel,gain:task.gain};
    const status = begin(name);
    return new Promise((resolve,reject)=>{
      const worker = new Worker("./image-worker.js");
      const item = {cancel:()=>finish(new Error("解析已取消"))}; workers.add(item);
      function finish(error,result){worker.terminate();workers.delete(item);status.end();error?reject(error):resolve(result);}
      worker.onerror = e=>finish(new Error(e.message));
      worker.onmessage = ({data})=>{if(data.error)finish(new Error(data.error));else if("result" in data)finish(null,data.result);else status.update(data.percent,data.phase);};
      worker.postMessage(task);
    });
  }
  async function read(file,start,size) {
    const epoch=generation;
    const status = begin(file.name + " · 读取");
    try {
      const bytes = new Uint8Array(size);
      for(let pos=0;pos<size;pos+=4*1024*1024){
        const chunk = await window.desktop.readSlice(file.path,start+pos,Math.min(4*1024*1024,size-pos));
        if(epoch!==generation)throw Error("解析已取消");
        if(chunk.length !== Math.min(4*1024*1024,size-pos))throw Error("文件读取不完整");
        bytes.set(chunk,pos);status.update((pos+chunk.length)/size*100,"读取文件");
      }
      return bytes;
    } finally {status.end();}
  }
  return {run,read,begin,cancel(){generation++;for(const w of [...workers])w.cancel();tasks.clear();draw();}};
})();
