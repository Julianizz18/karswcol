@echo off
REM Prueba de carga con k6. Ejemplo: prueba-carga.bat load.js
cd /d "%~dp0..\.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0k6.ps1" %*
pause
