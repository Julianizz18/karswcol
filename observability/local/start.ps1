# KARSWCOL - observabilidad SIN Docker.
#
# Descarga (solo la primera vez) versiones portables de Prometheus, Grafana,
# Loki, Promtail y k6 en la carpeta tools/ del repo. No instala nada ni pide
# permisos de administrador: son .zip que se descomprimen y se ejecutan.
# Luego arranca todo junto con el servidor del juego.
#
# Uso (desde la raiz del repo):
#   powershell -ExecutionPolicy Bypass -File observability\local\start.ps1
#   powershell -ExecutionPolicy Bypass -File observability\local\start.ps1 -Token otroSecreto
#
# Para detener todo: observability\local\stop.ps1

param(
  [string]$Token = 'secreto123'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # Invoke-WebRequest es lentisimo con la barra de progreso
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$Local = $PSScriptRoot
$Tools = Join-Path $Root 'tools'
$Data = Join-Path $Tools 'data'
$Logs = Join-Path $Tools 'logs'
$dirs = @($Tools, $Data, $Logs, (Join-Path $Data 'grafana'), (Join-Path $Data 'grafana-plugins'), (Join-Path $Data 'prometheus'), (Join-Path $Data 'loki'), (Join-Path $Logs 'grafana'))
foreach ($d in $dirs) { New-Item -ItemType Directory -Force -Path $d | Out-Null }

function Fwd([string]$p) { return $p -replace '\\', '/' }

$Downloads = @(
  @{ Name = 'prometheus'; Exe = 'prometheus.exe'; Url = 'https://github.com/prometheus/prometheus/releases/download/v2.55.1/prometheus-2.55.1.windows-amd64.zip' },
  @{ Name = 'grafana';    Exe = 'grafana.exe';    Url = 'https://dl.grafana.com/oss/release/grafana-11.3.0.windows-amd64.zip' },
  @{ Name = 'loki';       Exe = 'loki-windows-amd64.exe';     Url = 'https://github.com/grafana/loki/releases/download/v3.2.1/loki-windows-amd64.exe.zip' },
  @{ Name = 'promtail';   Exe = 'promtail-windows-amd64.exe'; Url = 'https://github.com/grafana/loki/releases/download/v3.2.1/promtail-windows-amd64.exe.zip' },
  @{ Name = 'k6';         Exe = 'k6.exe';         Url = 'https://github.com/grafana/k6/releases/download/v0.54.0/k6-v0.54.0-windows-amd64.zip' }
)

function Find-Exe([string]$dir, [string]$exe) {
  $f = Get-ChildItem -Path $dir -Recurse -Filter $exe -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($f) { return $f.FullName }
  return $null
}

$Exe = @{}
foreach ($d in $Downloads) {
  $dir = Join-Path $Tools $d.Name
  $path = $null
  if (Test-Path $dir) { $path = Find-Exe $dir $d.Exe }
  if (-not $path) {
    Write-Host "Descargando $($d.Name) (solo la primera vez)..." -ForegroundColor Cyan
    $zip = Join-Path $Tools "$($d.Name).zip"   # si quedo uno a medias, curl lo retoma
    # curl.exe viene con Windows 10/11 y es mucho mas rapido que Invoke-WebRequest con archivos grandes.
    $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
    if ($curl) {
      # -C - retoma una descarga a medias; --speed-limit/--speed-time cortan si la
      # conexion se congela (menos de 1 KB/s por 30 s) y el bucle reintenta desde ahi.
      $ok = $false
      # curl escribe el progreso en stderr; con 'Stop' PowerShell 5.1 lo tomaria como error.
      $prevEap = $ErrorActionPreference
      $ErrorActionPreference = 'Continue'
      for ($try = 1; $try -le 10; $try++) {
        & $curl.Source -L --fail -C - --speed-limit 1024 --speed-time 30 -o $zip $d.Url
        if ($LASTEXITCODE -eq 0) { $ok = $true; break }
        Write-Host "  la descarga se interrumpio, reintentando ($try/10)..." -ForegroundColor Yellow
        Start-Sleep -Seconds 3
      }
      $ErrorActionPreference = $prevEap
      if (-not $ok) { throw "Fallo la descarga de $($d.Url)" }
    } else {
      Invoke-WebRequest -Uri $d.Url -OutFile $zip -UseBasicParsing
    }
    if (Test-Path $dir) { Remove-Item -Recurse -Force $dir }
    Expand-Archive -Path $zip -DestinationPath $dir -Force
    Remove-Item $zip
    $path = Find-Exe $dir $d.Exe
    if (-not $path) { throw "No se encontro $($d.Exe) dentro de $($d.Url)" }
  }
  $Exe[$d.Name] = $path
}

# Puertos libres?
$ports = @{ 3000 = 'servidor del juego'; 9090 = 'Prometheus'; 3001 = 'Grafana'; 3100 = 'Loki'; 9080 = 'Promtail' }
foreach ($p in $ports.Keys) {
  $busy = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue
  if ($busy) {
    throw "El puerto $p ($($ports[$p])) ya esta en uso. Cierra lo que lo use o ejecuta observability\local\stop.ps1"
  }
}

$LogFile = Join-Path $Logs 'karswcol.log'
Set-Content -Path (Join-Path $Tools 'token.txt') -Value $Token -Encoding ascii

# Variables que leen los archivos de configuracion (expand-env / provisioning de Grafana).
$env:LOKI_DATA = Fwd (Join-Path $Data 'loki')
$env:PROMTAIL_POSITIONS = Fwd (Join-Path $Data 'promtail-positions.yaml')
$env:KARSWCOL_LOG_FILE = Fwd $LogFile
$env:KARSWCOL_DASHBOARDS_DIR = Fwd (Join-Path $Root 'observability\grafana\dashboards')

$pids = @{}
function Start-Bg([string]$name, [string]$exe, [string[]]$argList, [string]$workDir) {
  $out = Join-Path $Logs "$name.out.log"
  $err = Join-Path $Logs "$name.err.log"
  $p = Start-Process -FilePath $exe -ArgumentList $argList -WorkingDirectory $workDir `
    -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err -PassThru
  $script:pids[$name] = $p.Id
  Write-Host ("  {0,-11} PID {1}" -f $name, $p.Id)
}

Write-Host "Arrancando..." -ForegroundColor Cyan

# 1. Servidor del juego (con metricas y logs a archivo)
$env:LOAD_TEST_TOKEN = $Token
$env:LOG_FILE = $LogFile
$node = (Get-Command node).Source
Start-Bg 'servidor' $node @('--env-file-if-exists=.env', 'src/index.js') (Join-Path $Root 'server')
Remove-Item Env:LOAD_TEST_TOKEN, Env:LOG_FILE

# 2. Prometheus
Start-Bg 'prometheus' $Exe['prometheus'] @(
  "--config.file=`"$(Join-Path $Local 'prometheus.yml')`"",
  "--storage.tsdb.path=`"$(Join-Path $Data 'prometheus')`"",
  '--storage.tsdb.retention.time=7d',
  '--web.enable-remote-write-receiver',
  '--web.listen-address=:9090'
) $Local

# 3. Loki y Promtail
Start-Bg 'loki' $Exe['loki'] @("-config.file=`"$(Join-Path $Local 'loki.yml')`"", '-config.expand-env=true') $Local
Start-Bg 'promtail' $Exe['promtail'] @("-config.file=`"$(Join-Path $Local 'promtail.yml')`"", '-config.expand-env=true') $Local

# 4. Grafana
$grafanaHome = Split-Path (Split-Path $Exe['grafana'])
$env:GF_SERVER_HTTP_PORT = '3001'
# SQLite interpreta "%20" como un espacio, y la carpeta del repo puede tenerlo:
# la base de datos de Grafana va en LOCALAPPDATA, una ruta sin caracteres raros.
$grafanaData = Join-Path $env:LOCALAPPDATA 'karswcol-grafana'
New-Item -ItemType Directory -Force -Path $grafanaData | Out-Null
$env:GF_PATHS_DATA = $grafanaData
$env:GF_PATHS_LOGS = Join-Path $Logs 'grafana'
$env:GF_PATHS_PLUGINS = Join-Path $Data 'grafana-plugins'
$env:GF_PATHS_PROVISIONING = Join-Path $Local 'grafana-provisioning'
$env:GF_SECURITY_ADMIN_USER = 'admin'
$env:GF_SECURITY_ADMIN_PASSWORD = 'admin'
$env:GF_AUTH_ANONYMOUS_ENABLED = 'true'
$env:GF_AUTH_ANONYMOUS_ORG_ROLE = 'Viewer'
$env:GF_DASHBOARDS_DEFAULT_HOME_DASHBOARD_PATH = Join-Path $Root 'observability\grafana\dashboards\karswcol-servidor.json'
$env:GF_ANALYTICS_REPORTING_ENABLED = 'false'
$env:GF_ANALYTICS_CHECK_FOR_UPDATES = 'false'
Start-Bg 'grafana' $Exe['grafana'] @('server', "--homepath=`"$grafanaHome`"") $grafanaHome

$pids | ConvertTo-Json | Set-Content -Path (Join-Path $Tools 'pids.json') -Encoding ascii

# Esperar a que todo responda
$checks = @(
  @{ Name = 'Servidor';   Url = 'http://localhost:3000/health' },
  @{ Name = 'Prometheus'; Url = 'http://localhost:9090/-/ready' },
  @{ Name = 'Loki';       Url = 'http://localhost:3100/ready' },
  @{ Name = 'Grafana';    Url = 'http://localhost:3001/api/health' }
)
Write-Host "Esperando a que todo responda (Grafana puede tardar 1-2 minutos)..." -ForegroundColor Cyan
$allOk = $true
foreach ($c in $checks) {
  $ok = $false
  for ($i = 0; $i -lt 180; $i++) {   # Grafana puede tardar 1-2 min en arrancar
    try {
      $r = Invoke-WebRequest -Uri $c.Url -UseBasicParsing -TimeoutSec 2
      if ($r.StatusCode -eq 200) { $ok = $true; break }
    } catch { }
    Start-Sleep -Seconds 1
  }
  if ($ok) { Write-Host ("  [OK]    {0}" -f $c.Name) -ForegroundColor Green }
  else { Write-Host ("  [FALLO] {0} - revisa tools\logs\" -f $c.Name) -ForegroundColor Red; $allOk = $false }
}

Write-Host ""
Write-Host "Listo:" -ForegroundColor Green
Write-Host "  Juego       http://localhost:3000"
Write-Host "  Metricas    http://localhost:3000/metrics"
Write-Host "  Grafana     http://localhost:3001   (admin / admin)"
Write-Host "  Prometheus  http://localhost:9090   (alertas: /alerts)"
Write-Host ""
Write-Host "Prueba de carga:  powershell -ExecutionPolicy Bypass -File observability\local\k6.ps1 load.js"
Write-Host "Detener todo:     powershell -ExecutionPolicy Bypass -File observability\local\stop.ps1"
if (-not $allOk) { exit 1 }
