@echo off
setlocal

echo Stopping Echo...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5177" ^| findstr "LISTENING"') do (
  taskkill /pid %%a /f >nul 2>nul
)

echo Done. Any Echo service listening on port 5177 has been stopped.
pause
