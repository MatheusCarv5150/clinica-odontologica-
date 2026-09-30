@echo off
cd /d "%~dp0.."
set "PATH=%PATH%;C:\Program Files\nodejs"
call node_modules\.bin\eslint.cmd src --format json > scripts\lint-json.txt 2> scripts\lint-json-err.txt
echo LINT_EXIT=%ERRORLEVEL% >> scripts\lint-json-err.txt
