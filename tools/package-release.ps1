param([switch]$SkipBuild)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$releaseRoot = Join-Path $projectRoot 'release'
$version = (Get-Content -Raw -LiteralPath (Join-Path $projectRoot 'desktop/package.json') | ConvertFrom-Json).version
if (-not $SkipBuild) {
  Push-Location (Join-Path $projectRoot 'web')
  try { & pnpm run build:local; if ($LASTEXITCODE -ne 0) { throw 'Web build failed' } } finally { Pop-Location }
  Push-Location (Join-Path $projectRoot 'desktop')
  try { & pnpm run dist; if ($LASTEXITCODE -ne 0) { throw 'Windows build failed' } } finally { Pop-Location }
}
$webSource = Join-Path $projectRoot 'web/dist/client'
$windowsSource = Join-Path $projectRoot 'desktop/release/win-unpacked'
foreach ($inputFile in @((Join-Path $webSource 'index.html'), (Join-Path $windowsSource 'MediaLab.exe'))) {
  if (-not (Test-Path -LiteralPath $inputFile)) { throw "Build output missing: $inputFile" }
}
New-Item -ItemType Directory -Force -Path $releaseRoot | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
foreach ($name in @('MediaLab-Web','MediaLab-Windows')) {
  $target = [IO.Path]::GetFullPath((Join-Path $releaseRoot $name))
  $backup = [IO.Path]::GetFullPath((Join-Path $releaseRoot "$name-backup-$stamp"))
  foreach ($resolved in @($target,$backup)) {
    if (-not $resolved.StartsWith($releaseRoot + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Output outside release directory' }
  }
  if (Test-Path -LiteralPath $target) { Move-Item -LiteralPath $target -Destination $backup }
  New-Item -ItemType Directory -Path $target | Out-Null
  $source = if ($name -eq 'MediaLab-Web') { $webSource } else { $windowsSource }
  Get-ChildItem -LiteralPath $source -Force | Copy-Item -Destination $target -Recurse
}
$webTarget = Join-Path $releaseRoot 'MediaLab-Web'
foreach ($name in @('serve-static.ps1','启动本地网页版.cmd')) {
  Copy-Item -LiteralPath (Join-Path $projectRoot "web/build/$name") -Destination $webTarget
}
Copy-Item -LiteralPath (Join-Path $projectRoot 'web/build/LOCAL_README.md') -Destination (Join-Path $webTarget 'README.md')
Copy-Item -LiteralPath (Join-Path $projectRoot "desktop/release/MediaLab-Portable-$version.exe") -Destination $releaseRoot
Compress-Archive -Path (Join-Path $webTarget '*') -DestinationPath (Join-Path $releaseRoot "MediaLab-Web-V$version.zip") -Force
Compress-Archive -Path (Join-Path $releaseRoot 'MediaLab-Windows') -DestinationPath (Join-Path $releaseRoot "MediaLab-Windows-V$version.zip") -Force
Write-Host "Packaged MediaLab $version. Previous output directories retained as -backup-$stamp."
