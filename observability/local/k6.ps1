# Ejecuta una prueba de k6 SIN Docker, enviando las metricas a Prometheus
# (dashboard "KARSWCOL - Pruebas de carga (k6)" en Grafana) y guardando un
# reporte HTML en load-tests\results\.
#
# Requiere haber ejecutado antes observability\local\start.ps1.
#
# Uso:
#   powershell -ExecutionPolicy Bypass -File observability\local\k6.ps1               (smoke.js)
#   powershell -ExecutionPolicy Bypass -File observability\local\k6.ps1 load.js
#   powershell -ExecutionPolicy Bypass -File observability\local\k6.ps1 load.js -e VUS=60 -e HOLD=2m

$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$Tools = Join-Path $Root 'tools'

$Script = 'smoke.js'
$Extra = @()
if ($args.Count -gt 0) {
  $Script = $args[0]
  if ($args.Count -gt 1) { $Extra = $args[1..($args.Count - 1)] }
}

$k6 = Get-ChildItem -Path (Join-Path $Tools 'k6') -Recurse -Filter 'k6.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $k6) {
  $cmd = Get-Command k6 -ErrorAction SilentlyContinue
  if (-not $cmd) { Write-Host "No se encontro k6. Ejecuta primero observability\local\start.ps1" -ForegroundColor Red; exit 1 }
  $k6Path = $cmd.Source
} else {
  $k6Path = $k6.FullName
}

$tokenFile = Join-Path $Tools 'token.txt'
$token = 'secreto123'
if (Test-Path $tokenFile) { $token = (Get-Content $tokenFile -Raw).Trim() }

$name = [IO.Path]::GetFileNameWithoutExtension($Script)
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$testId = "$name-$stamp"
$report = Join-Path $Root "load-tests\results\reporte-$testId.html"

$env:K6_PROMETHEUS_RW_SERVER_URL = 'http://localhost:9090/api/v1/write'
$env:K6_PROMETHEUS_RW_TREND_STATS = 'p(95),p(99),avg,min,max'
$env:K6_PROMETHEUS_RW_PUSH_INTERVAL = '5s'
$env:K6_WEB_DASHBOARD = 'true'
$env:K6_WEB_DASHBOARD_EXPORT = $report

Write-Host "Prueba: $Script  (testid=$testId)" -ForegroundColor Cyan
Write-Host "Panel en vivo de k6: http://localhost:5665   Grafana: http://localhost:3001/d/karswcol-k6" -ForegroundColor Cyan

Push-Location (Join-Path $Root 'load-tests')
try {
  # p(99) también en el resumen (--summary-export), no solo en Prometheus.
  & $k6Path run -o experimental-prometheus-rw --tag "testid=$testId" `
    --summary-trend-stats "avg,min,med,max,p(90),p(95),p(99)" `
    -e BASE_URL=http://localhost:3000 -e "LOAD_TEST_TOKEN=$token" @Extra $Script
  $code = $LASTEXITCODE
} finally {
  Pop-Location
}

Write-Host ""
Write-Host "Reporte HTML: $report" -ForegroundColor Green
if ($code -ne 0) { Write-Host "Algun umbral (threshold) no se cumplio: codigo $code" -ForegroundColor Yellow }
exit $code
