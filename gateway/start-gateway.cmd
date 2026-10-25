@echo off
rem Starts the KDS WhatsApp gateway and keeps it running (restarts it if it ever stops).
cd /d "%~dp0"
if not exist node_modules (
  echo Installing, one time only...
  call npm install --omit=dev
)
if not exist .env (
  echo No .env file. Copy .env.example to .env and set API_KEY first.
  pause
  exit /b 1
)
node run-forever.mjs
