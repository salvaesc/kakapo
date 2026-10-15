@echo off
rem ============================================================
rem  KAKAPO - builds the Android APK (double-click this file)
rem  Needs: Node.js and Android Studio (opened once, so it has
rem  downloaded the Android SDK). Result: KAKAPO.apk in this folder.
rem ============================================================
setlocal
cd /d "%~dp0"

rem --- Java: use the one that ships with Android Studio if none is set
if not defined JAVA_HOME (
  if exist "%ProgramFiles%\Android\Android Studio\jbr\bin\java.exe" set "JAVA_HOME=%ProgramFiles%\Android\Android Studio\jbr"
)
if not defined JAVA_HOME (
  echo [!] Java not found. Install Android Studio, or set JAVA_HOME.
  goto :fail
)

rem --- Android SDK location (Android Studio's default)
if not exist "android\local.properties" (
  if not exist "%LOCALAPPDATA%\Android\Sdk" (
    echo [!] Android SDK not found in %LOCALAPPDATA%\Android\Sdk
    echo     Open Android Studio once so it downloads the SDK, then run this again.
    goto :fail
  )
  > "android\local.properties" echo sdk.dir=%LOCALAPPDATA:\=\\%\\Android\\Sdk
)

rem --- 1. libraries the Android project needs (first time only)
if not exist "node_modules\@capacitor\android" (
  echo == Installing Capacitor ==
  call npm install --no-audit --no-fund || goto :fail
)

rem --- 2. latest game code into the app (needs Python; otherwise the bundled copy is used)
where python >nul 2>nul && (
  python tools\build-single.py www\index.html
)
call npx cap sync android || goto :fail

rem --- 3. build
echo == Building the APK (the first time takes a few minutes) ==
pushd android
call gradlew.bat assembleDebug || (popd & goto :fail)
popd

copy /y "android\app\build\outputs\apk\debug\app-debug.apk" "KAKAPO.apk" >nul
echo.
echo ==================================================
echo  Done:  %CD%\KAKAPO.apk
echo  Copy it to the phone and open it to install
echo  (allow "install unknown apps" when asked).
echo ==================================================
pause
exit /b 0

:fail
echo.
echo The build did not finish. Read the messages above.
pause
exit /b 1
