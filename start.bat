@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start.ps1"
if errorlevel 1 (
  pause
  exit /b 1
)
timeout /t 3 /nobreak >nul
exit /b 0
