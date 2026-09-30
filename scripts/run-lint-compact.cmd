@echo off
cd /d "%~dp0.."
set "PATH=%PATH%;C:\Program Files\nodejs"
call node_modules\.bin\eslint.cmd "src" --format unix > scripts\lint-compact.txt 2>&1
echo EXIT=%ERRORLEVEL% >> scripts\lint-compact.txt
