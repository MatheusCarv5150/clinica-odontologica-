@echo off
set "PATH=%PATH%;C:\Program Files\nodejs"
node "%~dp0test-procedures.mjs" > "%~dp0procedures-test-output.txt" 2>&1
echo EXIT_CODE=%ERRORLEVEL% >> "%~dp0procedures-test-output.txt"
