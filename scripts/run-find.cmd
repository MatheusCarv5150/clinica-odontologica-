@echo off
cd /d "%~dp0.."
findstr /N /C:"CATEGORIES" /C:"PRESET" src\lib\schemas.ts
