@echo off
cd /d "%~dp0.."
set "PATH=%PATH%;C:\Program Files\nodejs"
echo === LINT === > scripts\final-report.txt
call node_modules\.bin\eslint.cmd "src" >> scripts\final-report.txt 2>&1
echo LINT_EXIT=%ERRORLEVEL% >> scripts\final-report.txt
echo. >> scripts\final-report.txt
echo === TYPECHECK === >> scripts\final-report.txt
call node_modules\.bin\tsc.cmd --noEmit >> scripts\final-report.txt 2>&1
echo TSC_EXIT=%ERRORLEVEL% >> scripts\final-report.txt
echo. >> scripts\final-report.txt
echo === TESTS === >> scripts\final-report.txt
call node scripts\domain-check.mjs >> scripts\final-report.txt 2>&1
echo DOMAIN_EXIT=%ERRORLEVEL% >> scripts\final-report.txt
call node scripts\test-anamnesis.mjs >> scripts\final-report.txt 2>&1
echo ANAMNESIS_EXIT=%ERRORLEVEL% >> scripts\final-report.txt
call node scripts\test-odontogram.mjs >> scripts\final-report.txt 2>&1
echo ODONTOGRAM_EXIT=%ERRORLEVEL% >> scripts\final-report.txt
call node scripts\test-procedures.mjs >> scripts\final-report.txt 2>&1
echo PROCEDURES_EXIT=%ERRORLEVEL% >> scripts\final-report.txt
