@echo off
chcp 65001 >nul
where pnpm >nul 2>nul
if errorlevel 1 (
  echo 未找到 pnpm。请先安装 Node.js 22.13+ 和 pnpm。
  pause
  exit /b 1
)
echo 正在启动 VideoProbe V0.0.2 本地网页...
pnpm run dev
pause
