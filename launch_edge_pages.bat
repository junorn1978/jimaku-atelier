@echo off
setlocal

rem Launches the published GitHub Pages build in an app window.
rem No local server needed here - GitHub serves the files.
rem For the local working copy, use launch_edge.bat instead.

set "APP_URL=https://junorn1978.github.io/jimaku-atelier/"

rem Same profile as the local launcher on purpose. On-device models
rem (Gemini Nano, Translator API) are downloaded per profile, so a
rem separate --user-data-dir would mean downloading them all over again.
set "translate_DIR=%USERPROFILE%\junorn_1978_translate_edge"

start msedge.exe --app="%APP_URL%" --window-size=1280,720 ^
--disable-features=CalculateNativeWinOcclusion ^
--user-data-dir="%translate_DIR%" ^
--disable-extensions ^
--disable-default-apps

exit /b
