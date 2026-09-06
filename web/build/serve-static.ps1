param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$siteRoot = [IO.Path]::GetFullPath((Split-Path -Parent $MyInvocation.MyCommand.Path))
$port = 17861
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $port)
$listener.Start()
$url = "http://127.0.0.1:$port/"
if (-not $NoBrowser) { Start-Process $url }
Write-Host "MediaLab Web started: $url"
Write-Host 'Close this window to stop the local server.'
$mime = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8';
  '.css' = 'text/css; charset=utf-8'; '.json' = 'application/json; charset=utf-8';
  '.png' = 'image/png'; '.svg' = 'image/svg+xml'; '.ico' = 'image/x-icon';
  '.wasm' = 'application/wasm'
}
try {
  while ($true) {
    $client = $listener.AcceptTcpClient()
    try {
      $stream = $client.GetStream()
      $stream.ReadTimeout = 5000
      $reader = [IO.StreamReader]::new($stream, [Text.Encoding]::ASCII, $false, 4096, $true)
      $requestLine = $reader.ReadLine()
      while (($line = $reader.ReadLine()) -ne '') { if ($null -eq $line) { break } }
      if ($requestLine -notmatch '^GET\s+([^\s]+)') { continue }
      $relative = [Uri]::UnescapeDataString(($Matches[1] -split '\?')[0]).TrimStart('/').Replace('/', [IO.Path]::DirectorySeparatorChar)
      if ([string]::IsNullOrWhiteSpace($relative)) { $relative = 'index.html' }
      $candidate = [IO.Path]::GetFullPath((Join-Path $siteRoot $relative))
      if (-not $candidate.StartsWith($siteRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { continue }
      if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { $candidate = Join-Path $siteRoot 'index.html' }
      $body = [IO.File]::ReadAllBytes($candidate)
      $contentType = $mime[[IO.Path]::GetExtension($candidate).ToLowerInvariant()]
      if (-not $contentType) { $contentType = 'application/octet-stream' }
      $header = "HTTP/1.1 200 OK`r`nContent-Type: $contentType`r`nContent-Length: $($body.Length)`r`nConnection: close`r`n`r`n"
      $headerBytes = [Text.Encoding]::ASCII.GetBytes($header)
      $stream.Write($headerBytes, 0, $headerBytes.Length)
      $stream.Write($body, 0, $body.Length)
    } catch {
      # A malformed request must not terminate the local server.
    } finally { $client.Close() }
  }
} finally { $listener.Stop() }
