@echo off
title Stop HTML Requirement Review Assistant
echo Stopping local review service on port 5177...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$c=Get-NetTCPConnection -LocalPort 5177 -ErrorAction SilentlyContinue | Select-Object -First 1; if($c){ Stop-Process -Id $c.OwningProcess -Force; Write-Host 'Stopped.' } else { Write-Host 'No service is running on port 5177.' }"
pause
