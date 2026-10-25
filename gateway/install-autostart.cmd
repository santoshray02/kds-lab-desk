@echo off
rem Makes Windows start the gateway by itself at every log-in, hidden, and start it again if it stops.
cd /d "%~dp0"
set TASK=KDS WhatsApp Gateway
schtasks /Delete /TN "%TASK%" /F >nul 2>&1
schtasks /Create /TN "%TASK%" /SC ONLOGON /RL LIMITED /TR "cmd /c start \"\" /min \"%~dp0start-gateway.cmd\"" /F
if errorlevel 1 (echo Could not create the task. & pause & exit /b 1)
echo Done. The gateway will start at every log-in. Starting it now...
start "" /min "%~dp0start-gateway.cmd"
pause
