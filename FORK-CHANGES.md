# Mnemo: changes from OpenMuse

Mnemo is a fork of [CopilotKit/OpenMuse](https://github.com/CopilotKit/OpenMuse) that runs on one Windows
laptop with a local model, local chat storage, private web search and local image and video
generation. Everything below is optional: with none of the new settings, the app behaves like
upstream.

Test machine: Windows 11, RTX 5050 Laptop (8 GB VRAM), 24 GB RAM.

## Name

Mnemo is named after Mnemosyne, the goddess of memory and mother of the Muses: everything it
remembers stays on your computer. The app, the assistant's default name and the browser title
say Mnemo; package names and internal identifiers keep "openmuse" so upstream changes still merge.

## What runs where

| Part | Where it runs | Leaves the computer? |
|---|---|---|
| Chat model | Ollama, `qwen3-uncensored` (Qwen3 8B) | No |
| Chats (main and side chats) | PGlite in `DATA_DIR` (`LOCAL_CHATS=true`) | No |
| Tasks, reports, files, images, videos | PGlite and files in `DATA_DIR` | No |
| Web search | Local SearXNG in Docker (`SEARXNG_URL`) | Queries reach public engines through SearXNG, without cookies or tracking |
| Reading web pages | Local Playwright browser worker | Only the pages the agent opens |
| Image and video generation | stable-diffusion.cpp on the GPU | No |
| CopilotKit telemetry | Off (`COPILOTKIT_TELEMETRY_DISABLED=true`) | No |

## Changes

### 1. Local chats and local side chats (`LOCAL_CHATS=true`)

Upstream stores every conversation in CopilotKit Intelligence (cloud) and requires
`CPK_INTELLIGENCE_API_KEY`.

- `apps/server/src/config.ts`: new `localChats` setting. The Intelligence key is only required
  when `LOCAL_CHATS` is not `true`.
- `apps/server/src/agent.ts`: without Intelligence, the runtime uses CopilotKit's
  `InMemoryAgentRunner` (runs stream straight back; nothing is sent to the cloud).
- `apps/server/src/app.ts`: new local conversation API. The main chat is the conversation saved
  as `default`.
  - `GET /api/conversations`: side chats (name from the first message unless renamed)
  - `GET|PUT /api/conversations/:id`: load and save messages
  - `PATCH /api/conversations/:id`: rename, archive and restore
  - `DELETE /api/conversations/:id`: permanent delete (the main chat cannot be deleted)
- `apps/server/src/workspace.ts`, `packages/domain/src/index.ts`: `runtime.localThreads` flag.
- `apps/mobile/src/threads.tsx`: `useLocalThreads` gives the side-chat sheet the same actions
  as Rich Threads, plus **Delete** with a confirmation step.
- `apps/mobile/src/chat.tsx`: local threads load and save through `/api/conversations/:id`.
- `apps/mobile/src/screens.tsx`: settings show "Saved on this computer".

### 2. Delete tasks

Upstream can only cancel tasks.

- `DELETE /api/agent/tasks/:id` (`engine/routes.ts`, `engine/service.ts`, `db.ts`). It removes
  the task, its steps, reports, notifications, pending reviews and search session. Files saved
  to the library and actions already carried out are kept. A running task must be cancelled
  first, and monitor tasks are stopped from Monitors.
- Background maintenance removes notifications whose task no longer exists.
- `apps/mobile/src/agent-ui.tsx`: **Delete** button on the task screen, with a confirmation.

### 3. Small models finish their tasks (`engine/model.ts`)

Small local models often write their answer and stop without calling `finish_task`, so tasks
ended with "The agent reached the end of this run without confirming completion".

- The task asks the model once to finish (or to ask for missing information).
- If it still does not, an answer of 200+ characters is saved as the final report.
- If its `finish_task` summary is much shorter than the answer it wrote, the full answer is kept.

### 4. Private web search (`apps/server/src/search.ts`)

The provider is chosen in this order:

1. `SEARXNG_URL`: a self-hosted [SearXNG](https://docs.searxng.org/) metasearch instance (free,
   no key). See [tools/searxng/README.md](tools/searxng/README.md).
2. `BRAVE_SEARCH_API_KEY`: [Brave Search API](https://api-dashboard.search.brave.com), with
   1.1 s between queries to respect the free-plan limit.
3. Otherwise, upstream's Parallel Search MCP.

All providers return the same bounded result shape (10 sources, 30,000 excerpt characters).

### 5. Image and video generation tools

- `apps/server/src/image-gen.ts` (new): runs `IMAGEGEN_SCRIPT` and `VIDEOGEN_SCRIPT`, one job
  at a time with a 30-minute limit. It stores results in `DATA_DIR/images` and serves them
  through signed URLs: `GET /api/images/:id` and `GET /api/images/:id/content`.
- `engine/conversation.ts`: chat tools `generate_image` (`idea`, `minScore`, `maxRounds`) and
  `generate_video` (`idea`, optional `seconds`).
- Long videos (`LONGVIDEO_SCRIPT`, `seconds` 6-180): a storyboard of ~5-second scenes rendered
  with a 4-step distilled LoRA and joined into one video. They run in the background, so the
  tool returns at once; the record stays `running` with scene progress, and a server restart
  marks an unfinished video as failed.
- `apps/mobile/src/image-tool-card.tsx` (new), `chat.tsx`: inline image and video cards. An
  image that misses its quality target is not shown. A long video's card checks progress every
  15 seconds, shows "scene x of y" with a progress bar, and plays the video when it is ready.
- `tools/imagegen/`: the generation scripts. See [tools/imagegen/README.md](tools/imagegen/README.md).

### 6. Local model and launcher

- `tools/ollama/qwen3-uncensored.Modelfile`: Qwen3 8B (abliterated) with thinking turned off by
  an empty think block and a 12k context. It does not append `/no_think` to user messages,
  because the small model sometimes answered about that text instead of the question.
- `start-openmuse.bat`: starts SearXNG, the API, the browser worker and the web app, then opens
  http://localhost:8081.
- `.gitignore`: `.copilotkit/` (CLI project binding with account identifiers).
- `.env.example`: documents every new setting.

## Setup on a new Windows machine

1. Install Node 24, pnpm, [Ollama](https://ollama.com) and Docker Desktop, then run `pnpm install`.
2. Create the model:
   ```
   ollama pull huihui_ai/qwen3-abliterated:8b
   ollama create qwen3-uncensored -f tools/ollama/qwen3-uncensored.Modelfile
   ollama pull gemma3:4b
   ```
   `gemma3:4b` is only needed for image scoring.
3. Start SearXNG ([tools/searxng/README.md](tools/searxng/README.md)).
4. For page reading, install the browser: `pnpm --dir apps/worker exec playwright install chromium`.
5. Copy `.env.example` to `.env` and set at least:
   ```
   AGENT_BACKEND=model
   MODEL=openai/qwen3-uncensored
   OPENAI_API_KEY=ollama
   OPENAI_BASE_URL=http://localhost:11434/v1
   OPENAI_CHAT_COMPLETIONS=true
   LOCAL_CHATS=true
   COPILOTKIT_TELEMETRY_DISABLED=true
   SEARXNG_URL=http://127.0.0.1:8888
   BROWSER_WORKER_URL=http://127.0.0.1:8790
   WORKER_TOKEN=<random, at least 32 characters>
   ```
6. Optional: set up image and video generation ([tools/imagegen/README.md](tools/imagegen/README.md))
   and set `IMAGEGEN_SCRIPT` and `VIDEOGEN_SCRIPT`.
7. Start Ollama, then run `start-openmuse.bat`.

## Notes

- `qwen3-uncensored` has its refusals removed. OpenMuse's own protections still apply: emails
  and calendar changes need your review, and web and email content is treated as untrusted data.
- An 8B model is fast on an 8 GB GPU but makes mistakes. Check important answers against their
  sources.
- Verification: `pnpm typecheck` and Biome are clean. Config, rich-threads, telemetry, search
  and conversation tests pass. Local chats, side chats, task delete, SearXNG search and page
  reading were also checked by hand in the running app.
