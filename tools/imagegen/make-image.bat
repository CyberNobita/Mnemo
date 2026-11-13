@echo off
REM Usage: make-image.bat "a tiger walking through a neon Mumbai street at night" 3
REM Needs Ollama running. Results go to D:\imagegen\out\<time>\ (best.png = best one)
cd /d D:\imagegen
if "%~1"=="" (
  set /p IDEA=Kya banana hai? :
) else (
  set IDEA=%~1
)
set ROUNDS=%~2
if "%ROUNDS%"=="" set ROUNDS=3
node loop.mjs "%IDEA%" %ROUNDS%
pause
