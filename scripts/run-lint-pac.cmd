@echo off
cd /d "%~dp0.."
set "PATH=%PATH%;C:\Program Files\nodejs"
call node_modules\.bin\eslint.cmd "src/app/(dashboard)/pacientes/page.tsx" > scripts\lint-pac.txt 2>&1
echo EXIT=%ERRORLEVEL% >> scripts\lint-pac.txt
