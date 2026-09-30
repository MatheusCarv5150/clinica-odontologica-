@echo off
cd /d "%~dp0.."
set "PATH=%PATH%;C:\Program Files\nodejs"
echo === TYPECHECK === > scripts\typecheck-part7.txt
call node_modules\.bin\tsc.cmd --noEmit >> scripts\typecheck-part7.txt 2>&1
echo TSC_EXIT=%ERRORLEVEL% >> scripts\typecheck-part7.txt
echo === BUILD === > scripts\build-part7.txt
call node_modules\.bin\next.cmd build >> scripts\build-part7.txt 2>&1
echo BUILD_EXIT=%ERRORLEVEL% >> scripts\build-part7.txt
