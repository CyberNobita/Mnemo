@echo off
REM OpenMuse + uncensored Qwen3-8B (Ollama, GPU). Opens http://localhost:8081
REM Ollama must be running (Start menu -> Ollama). Model: qwen3-uncensored
REM Private search: SearXNG runs in Docker Desktop (container "searxng"); Docker Desktop must be running.
cd /d D:\openmuse
docker start searxng >nul 2>&1
start "OpenMuse API" cmd /k pnpm dev
start "OpenMuse Browser" cmd /k pnpm dev:browser
start "OpenMuse Web" cmd /k pnpm dev:web
timeout /t 25 >nul
start http://localhost:8081
