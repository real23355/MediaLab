const { spawnSync } = require('node:child_process');
const path = require('node:path');
const assert = require('node:assert/strict');
const probe = path.resolve(__dirname, '../desktop/ffmpeg/bin/ffprobe.exe');
for (const name of ['rtos_ch0_before.h265','rtos_ch0.h265','left.h264','right.h265']) {
  const input = path.resolve(__dirname,'../artifacts/compare-fixtures',name);
  function analyze(fast) {
    const args = ['-v','error','-f',name.endsWith('.h264')?'h264':'hevc',...(fast?['-skip_loop_filter','all','-skip_idct','all']:[]),'-show_entries','stream=codec_name,profile,level,width,height,pix_fmt,r_frame_rate,avg_frame_rate,nb_read_frames:frame=key_frame,pict_type,pkt_size,pkt_pos,best_effort_timestamp_time,coded_picture_number,display_picture_number','-count_frames','-show_frames','-of','json',input];
    const result = spawnSync(probe,args,{windowsHide:true,maxBuffer:32*1024*1024});
    assert.equal(result.status,0,result.stderr?.toString());
    return JSON.parse(result.stdout.toString());
  }
  const before = analyze(false), after = analyze(true);
  assert.deepEqual(after,before,`${name}: metadata must remain exact`);
  console.log(`${name}: ${after.frames.length} frames, sizes/positions/types/stream metadata unchanged`);
}
