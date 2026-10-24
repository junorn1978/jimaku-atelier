@echo off
setlocal

set "APP_URL=https://junorn1978.github.io/jimaku-atelier/"

rem Which Chrome to run: stable or dev. See launch_chrome.bat for why the path
rem is explicit and why each channel has its own profile.
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

rem --app is Chrome app mode. If it gets in the way, swap --app= for --new-window.
rem Note: in normal window mode the first run shows the setup wizard, which you have to skip,
rem and it may force the default user settings to be written.
start "" "%CHROME%" --app="%APP_URL%" --window-size=1280,720 ^
--disable-features=CalculateNativeWinOcclusion ^
--user-data-dir="%translate_DIR%" ^
--disable-extensions ^
--disable-default-apps

exit /b
