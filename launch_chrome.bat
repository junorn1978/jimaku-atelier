@echo off
setlocal enabledelayedexpansion

set "PORT=8082"
set "PID="
set "translate_DIR=%USERPROFILE%\junorn_1978_translate"

for /f "tokens=5" %%P in ('
  netstat -ano ^| findstr /R /C:":%PORT%" ^| findstr LISTENING
') do set "PID=%%P"

if defined PID (
  echo "[INFO] Port %PORT% already in use (PID=%PID%), reusing it."
) else (
  echo [INFO] Starting Python HTTP server on port %PORT%...
  start "" python -m http.server %PORT%
  timeout /t 1 /nobreak >nul
)


start chrome.exe --app="http://localhost:%PORT%/index.html" --window-size=1280,720 ^
--disable-features=CalculateNativeWinOcclusion ^
--user-data-dir="%translate_DIR%" ^
--disable-extensions ^
--disable-default-apps

exit /b
