@echo off
setlocal enabledelayedexpansion

rem Which Chrome to run: stable or dev. Named explicitly rather than "chrome.exe",
rem which resolves through the registry to whatever stable happens to be.
rem Each channel gets its own profile: a profile opened by a newer Chrome and
rem then an older one is not supported, and on-device components such as the
rem translation packs can break.
set "CHANNEL=stable"

if /i "%CHANNEL%"=="dev" (
  set "CHROME=%ProgramFiles%\Google\Chrome Dev\Application\chrome.exe"
  set "translate_DIR=%USERPROFILE%\junorn_1978_translate_dev"
) else (
  set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
  set "translate_DIR=%USERPROFILE%\junorn_1978_translate"
)

if not exist "%CHROME%" (
  echo [ERROR] Chrome not found: "%CHROME%"
  pause
  exit /b 1
)

set "PORT=8082"
set "PID="

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


start "" "%CHROME%" --app="http://localhost:%PORT%/index.html" --window-size=1280,720 ^
--disable-features=CalculateNativeWinOcclusion ^
--user-data-dir="%translate_DIR%" ^
--disable-extensions ^
--disable-default-apps

exit /b
