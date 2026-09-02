@echo off
setlocal

set "APP_URL=https://junorn1978.github.io/jimaku-atelier/"
set "translate_DIR=%USERPROFILE%\junorn_1978_translate"

rem --app is Chrome app mode. If it gets in the way, swap --app= for --new-window.
rem Note: in normal window mode the first run shows the setup wizard, which you have to skip,
rem and it may force the default user settings to be written.
start chrome.exe --app="%APP_URL%" --window-size=1280,720 ^
--disable-features=CalculateNativeWinOcclusion ^
--user-data-dir="%translate_DIR%" ^
--disable-extensions ^
--disable-default-apps

exit /b
