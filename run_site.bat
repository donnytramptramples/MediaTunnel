@echo off
:: This ensures the script knows where it is located
cd /d "%~dp0"

:loop
cls
echo ==================================================
echo   WEBSITE AUTO-UPDATE & RUNNER (server.js)
echo ==================================================
echo.

echo [1/3] Pulling latest code from GitHub...
:: This force-syncs your local files to match your GitHub repo exactly
git pull origin main

echo.
echo [2/3] Checking for new NPM packages...
:: This installs any new libraries you added to your package.json
call npm install

echo.
echo [3/3] Launching your website...
:: This starts your server
node server.js

echo.
echo ==================================================
echo   WARNING: Server stopped or crashed! 
echo   Restarting in 10 seconds...
echo ==================================================
timeout /t 10
goto loop
 