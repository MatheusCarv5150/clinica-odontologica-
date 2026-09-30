@echo off
cd /d "%~dp0.."
set "PATH=%PATH%;C:\Program Files\nodejs"
echo START > scripts\lint-output-check.txt

echo --- node version --- >> scripts\lint-output-check.txt
"C:\Program Files\nodejs\node.exe" --version >> scripts\lint-output-check.txt 2>&1

echo --- eslint src --- >> scripts\lint-output-check.txt
"C:\Program Files\nodejs\node.exe" "node_modules\eslint\bin\eslint.js" src >> scripts\lint-output-check.txt 2>&1
echo ESLINT_SRC_EXIT=%ERRORLEVEL% >> scripts\lint-output-check.txt

echo --- eslint scripts --- >> scripts\lint-output-check.txt
"C:\Program Files\nodejs\node.exe" "node_modules\eslint\bin\eslint.js" scripts >> scripts\lint-output-check.txt 2>&1
echo ESLINT_SCRIPTS_EXIT=%ERRORLEVEL% >> scripts\lint-output-check.txt

echo DONE >> scripts\lint-output-check.txt
