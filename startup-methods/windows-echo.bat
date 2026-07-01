@echo off
setlocal

cd /d "%~dp0.."
title Echo Launcher

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Please install Node.js first.
  echo Download: https://nodejs.org/
  pause
  exit /b 1
)

echo Starting Echo...
echo The browser should open automatically. If not, visit http://localhost:5177
echo.
node server.js

echo.
echo Echo has stopped.
pause
