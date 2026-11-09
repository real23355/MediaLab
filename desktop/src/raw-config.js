let pendingRawConfig = null;

function cancelRawConfig() {
  pendingRawConfig?.();
}

function requestRawConfig(file, seed, message = "") {
  cancelRawConfig();
  return new Promise(resolve => {
    const dialog = document.createElement("dialog");
    dialog.className = "raw-config-dialog";
    dialog.setAttribute("aria-label", "补充 RAW 图像参数");
    dialog.innerHTML = `<form>
      <h2>补充 RAW 图像参数</h2>
      <p>暂时没能自动确定这张图的尺寸。输入宽度和高度后，就可以继续尝试解析，无需修改文件名。</p>
      <p class="raw-file-name"></p>
      <div class="raw-field-row">
        <label>宽度（像素）<input name="width" type="number" min="1" max="65535" step="1" required autofocus /></label>
        <label>高度（像素）<input name="height" type="number" min="1" max="65535" step="1" required /></label>
      </div>
      <div class="raw-field-row">
        <label>位深<select name="bitDepth">${[8,10,12,14,16].map(n=>`<option value="${n}">${n}-bit</option>`).join("")}</select></label>
        <label>存储方式<select name="packing">${R.RAW_PACKINGS.map(p=>`<option value="${p.value}">${p.label}</option>`).join("")}</select></label>
      </div>
      <label>Bayer 排列<select name="bayer">${R.BAYER_PATTERNS.map(b=>`<option>${b}</option>`).join("")}</select></label>
      <p class="raw-config-hint">12-bit Unpacked 通常选择“RAW Unpacked16 LE”。颜色不对时，可在解析后调整 Bayer 排列或切换灰度显示。</p>
      <p class="raw-size-hint" aria-live="polite"></p>
      <p class="raw-config-error" role="alert"></p>
      <div class="raw-config-actions"><button type="button" data-cancel>取消</button><button type="submit" class="primary">按这些参数解析</button></div>
    </form>`;
    const form = dialog.querySelector("form"), fields = form.elements;
    dialog.querySelector(".raw-file-name").textContent = `${file.name} · ${file.size.toLocaleString("zh-CN")} 字节`;
    fields.width.value = seed.needsManual ? "" : seed.width;
    fields.height.value = seed.needsManual ? "" : seed.height;
    fields.bitDepth.value = seed.bitDepth;
    fields.packing.value = seed.packing;
    fields.bayer.value = seed.bayer;
    dialog.querySelector(".raw-config-error").textContent = message;
    const sizeHint = () => {
      const w=Number(fields.width.value),h=Number(fields.height.value),depth=Number(fields.bitDepth.value);
      const expected=R.frameBytes(w,h,depth,fields.packing.value);
      dialog.querySelector(".raw-size-hint").textContent = !w||!h ? "请输入图像的实际宽度和高度。" : !expected ? "MIPI RAW10 Packed 需要选择 10-bit 位深。" : expected===file.size ? "尺寸与文件大小匹配，可以尝试解析。" : `按当前参数需要 ${expected.toLocaleString("zh-CN")} 字节，文件实际为 ${file.size.toLocaleString("zh-CN")} 字节。请再确认宽高和存储方式。`;
      return expected;
    };
    form.addEventListener("input",sizeHint);
    form.addEventListener("change",sizeHint);
    const finish = config => { if(pendingRawConfig===cancel)pendingRawConfig=null;dialog.close();dialog.remove();resolve(config); };
    const cancel = () => finish(null);
    pendingRawConfig=cancel;
    dialog.querySelector("[data-cancel]").onclick=cancel;
    dialog.oncancel=e=>{e.preventDefault();cancel();};
    form.onsubmit=e=>{
      e.preventDefault();const expected=sizeHint();
      if(!expected || expected!==file.size){dialog.querySelector(".raw-config-error").textContent="这些参数暂时还对不上文件大小。请检查后再试；如果文件含有额外文件头或每行填充，当前方式还不能直接读取。";return;}
      finish({width:Number(fields.width.value),height:Number(fields.height.value),bitDepth:Number(fields.bitDepth.value),packing:fields.packing.value,bayer:fields.bayer.value,frameBytes:expected,needsManual:false,reason:"手动输入 RAW 参数"});
    };
    document.body.append(dialog);sizeHint();dialog.showModal();
  });
}
