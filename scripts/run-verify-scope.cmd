@echo off
cd /d "%~dp0.."
set "PATH=%PATH%;C:\Program Files\nodejs"
call node_modules\.bin\eslint.cmd "src/components" "src/app" > scripts\lint-scope.txt 2>&1
echo EXIT=%ERRORLEVEL% >> scripts\lint-scope.txt
call node_modules\.bin\tsc.cmd --noEmit > scripts\typecheck-full.txt 2>&1
echo EXIT=%ERRORLEVEL% >> scripts\typecheck-full.txt
