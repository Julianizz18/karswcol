# Detiene todo lo que arranco observability\local\start.ps1 (solo esos procesos).
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$PidFile = Join-Path $Root 'tools\pids.json'
if (-not (Test-Path $PidFile)) {
  Write-Host "No hay nada corriendo (no existe tools\pids.json)."
  exit 0
}
$pids = Get-Content $PidFile -Raw | ConvertFrom-Json
foreach ($prop in $pids.PSObject.Properties) {
  $p = Get-Process -Id $prop.Value -ErrorAction SilentlyContinue
  if ($p) {
    Stop-Process -Id $prop.Value -Force -ErrorAction SilentlyContinue
    Write-Host ("  detenido {0,-11} PID {1}" -f $prop.Name, $prop.Value)
  }
}
Remove-Item $PidFile
Write-Host "Listo."
