@echo off
cd /d "%~dp0"
title HTML Requirement Review Assistant
echo HTML requirement review assistant is starting...
echo.
echo Local console:
echo   http://localhost:5177
echo.
echo Keep this window open while teammates are reviewing.
echo Close this window to stop the local review service.
echo.
start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 1; Start-Process 'http://localhost:5177'"
node server.js
pause
