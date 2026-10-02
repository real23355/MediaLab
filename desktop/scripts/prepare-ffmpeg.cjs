const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const pin = require('../ffmpeg/build.json');
const cache = path.join(root, 'ffmpeg', 'cache');
const output = path.join(root, 'ffmpeg', 'bin');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(Error(`${command} exited ${code}`)));
  });
}
async function main() {
  fs.mkdirSync(cache, { recursive: true });
  fs.mkdirSync(output, { recursive: true });
  const archive = path.join(cache, pin.archive);
  if (!fs.existsSync(archive) || hash(archive) !== pin.sha256) {
    // Bounded, resumable range requests. Verify the publisher checksum before extraction.
    const partSize = 1024 * 1024;
    const total = Math.ceil(pin.size / partSize);
    let next = 0;
    await Promise.all(Array.from({ length: 8 }, async () => {
      while (next < total) {
        const index = next++;
        const start = index * partSize, end = Math.min(pin.size - 1, start + partSize - 1);
        const part = `${archive}.part${index}`;
        if (!fs.existsSync(part) || fs.statSync(part).size !== end - start + 1) {
          await run('curl.exe', ['-fsSL', '--connect-timeout', '20', '--max-time', '180', '--retry', '2', '--range', `${start}-${end}`, '-o', part, pin.url]);
        }
        if (fs.statSync(part).size !== end - start + 1) throw Error(`Bad range response ${index}`);
        console.log(`FFmpeg download: ${index + 1}/${total} parts`);
      }
    }));
    fs.writeFileSync(archive, Buffer.concat(Array.from({ length: total }, (_, i) => fs.readFileSync(`${archive}.part${i}`))));
    if (hash(archive) !== pin.sha256) throw Error('FFmpeg SHA-256 mismatch; refusing to extract. Remove the download cache and retry.');
  }
  await run('tar.exe', ['-xf', archive, '-C', cache]);
  const build = path.join(cache, pin.directory);
  fs.copyFileSync(path.join(build, 'bin', 'ffmpeg.exe'), path.join(output, 'ffmpeg.exe'));
  fs.copyFileSync(path.join(build, 'LICENSE'), path.join(root, 'ffmpeg', 'GPL-3.0.txt'));
  // Keep FFprobe pinned separately: frame size/offset fields are the existing data contract.
  const probe = path.dirname(require.resolve('@ffprobe-installer/win32-x64/package.json', { paths: [root] }));
  fs.copyFileSync(path.join(probe, 'ffprobe.exe'), path.join(output, 'ffprobe.exe'));
  console.log(`Prepared FFmpeg ${pin.version} and FFprobe 5.1.0 (verified archive ${pin.sha256}).`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
