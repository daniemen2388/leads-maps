# Reinicia Docker Desktop cuando se cuelga (Windows). Uso: powershell -ExecutionPolicy Bypass -File reiniciar-docker.ps1
Get-Process | Where-Object { $_.Name -match 'docker' } | Stop-Process -Force -ErrorAction SilentlyContinue
wsl --shutdown
Start-Sleep 4
$run = Join-Path $env:LOCALAPPDATA "Docker\run"
if (Test-Path $run) { Rename-Item $run ("run.old-" + (Get-Date -Format yyyyMMddHHmmss)) -ErrorAction SilentlyContinue }
(New-Object -ComObject Shell.Application).ShellExecute("C:\Program Files\Docker\Docker\Docker Desktop.exe")
$i = 0
while ($i -lt 60) {
  docker info --format '{{.ServerVersion}}' 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) { Start-Sleep 3; docker info --format '{{.ServerVersion}}' 2>$null | Out-Null; if ($LASTEXITCODE -eq 0) { "Docker listo"; exit 0 } }
  Start-Sleep 5; $i++
}
"Docker no ha arrancado en 5 minutos"; exit 1
