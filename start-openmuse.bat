@echo off
REM Mnemo (OpenMuse fork) + uncensored Qwen3-8B (Ollama, GPU). Opens http://localhost:8081
REM Ollama must be running (Start menu -> Ollama). Model: qwen3-uncensored
REM Private search: SearXNG runs in Docker Desktop (container "searxng"); Docker Desktop must be running.
cd /d D:\openmuse
docker start searxng >nul 2>&1
start "Mnemo API" cmd /k pnpm dev
start "Mnemo Browser" cmd /k pnpm dev:browser
start "Mnemo Web" cmd /k pnpm dev:web
timeout /t 25 >nul
start http://localhost:8081
