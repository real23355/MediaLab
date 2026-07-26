const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const outputDir = path.join(projectRoot, "ffmpeg", "bin");

const binaries = [
  {
    packageName: "@ffmpeg-installer/win32-x64",
    fileName: "ffmpeg.exe",
  },
  {
    packageName: "@ffprobe-installer/win32-x64",
    fileName: "ffprobe.exe",
  },
];

fs.mkdirSync(outputDir, { recursive: true });

for (const binary of binaries) {
  const destination = path.join(outputDir, binary.fileName);
  let source = "";
  try {
    const packageJson = require.resolve(`${binary.packageName}/package.json`, {
      paths: [projectRoot],
    });
    source = path.join(path.dirname(packageJson), binary.fileName);
  } catch {
    if (fs.existsSync(destination)) {
      console.log(`Using existing ${binary.fileName}`);
      continue;
    }
    throw new Error(`Missing ${binary.packageName}. Run pnpm install and try again.`);
  }

  if (!fs.existsSync(source)) {
    if (fs.existsSync(destination)) {
      console.log(`Using existing ${binary.fileName}`);
      continue;
    }
    throw new Error(`Missing ${source}. Run pnpm install and try again.`);
  }

  fs.copyFileSync(source, destination);
  console.log(`Prepared ${binary.fileName}`);
}
