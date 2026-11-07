@echo off
REM Detiene todo lo que arranco iniciar.bat.
cd /d "%~dp0..\.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop.ps1"
pause
