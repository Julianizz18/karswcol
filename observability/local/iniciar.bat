@echo off
REM Arranca el juego + Prometheus + Grafana + Loki + Promtail sin Docker.
cd /d "%~dp0..\.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
pause
