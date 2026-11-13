// Long video: idea -> Qwen3 storyboard (one scene per ~5 s) -> Wan clips (Wan 2.2 TI2V 5B, or
// Wan 2.1 1.3B with a 4-step LoRA) -> clips joined into one video.webm.
// Usage: node D:/imagegen/longvideo.mjs "your idea" [seconds=30]
// OpenMuse sets IMAGEGEN_OUT. Progress lines: `PROGRESS {"done":n,"total":m}`.
// The last stdout line is `RESULT {json}`.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const OLLAMA = "http://localhost:11434";
const TEXT_MODEL = "qwen3-uncensored";
const SD_CLI = "D:\\sdcpp\\sd-cli.exe";
const MODELS = "D:\\models\\wan";
const T5 = join(MODELS, "umt5-xxl-encoder-Q6_K.gguf");
const NEGATIVE =
  "oversaturated, overexposed, static, blurry details, subtitles, text, watermark, low quality, " +
  "jpeg artifacts, ugly, deformed, disfigured, extra limbs, morphing, flickering, plastic, cartoon";

// VIDEO_MODEL picks the model. "wan22-5b" (default when its files exist) is Wan 2.2 TI2V 5B:
// 1280x704 at 24 fps, slower but much better. "wan21-fast" is Wan 2.1 1.3B with a 4-step LoRA.
const PROFILES = {
  "wan22-5b": {
    fps: 24,
    frames: 121, // about 5 seconds, the model's native clip length
    files: [join(MODELS, "Wan2.2-TI2V-5B-Q8_0.gguf"), join(MODELS, "wan2.2_vae.safetensors")],
    args: () => [
      "--diffusion-model", join(MODELS, "Wan2.2-TI2V-5B-Q8_0.gguf"),
      "--vae", join(MODELS, "wan2.2_vae.safetensors"),
      "--cfg-scale", "5.0", "--sampling-method", "euler", "--steps", process.env.VIDEO_STEPS || "30",
      "--flow-shift", "5.0", "-W", "1280", "-H", "704", "-n", NEGATIVE, "--offload-to-cpu",
    ],
    prompt: (p) => p,
  },
  "wan21-fast": {
    fps: 16,
    frames: 81,
    files: [join(MODELS, "wan2.1_t2v_1.3B_fp16.safetensors")],
    args: () => [
      "--diffusion-model", join(MODELS, "wan2.1_t2v_1.3B_fp16.safetensors"),
      "--vae", join(MODELS, "wan_2.1_vae.safetensors"),
      "--lora-model-dir", join(MODELS, "loras"),
      "--cfg-scale", "1.0", "--sampling-method", "euler", "--steps", "4",
      "--flow-shift", "5.0", "-W", "832", "-H", "480",
    ],
    prompt: (p) => `${p}<lora:Wan2_1_self_forcing_dmd_1_3B_lora_rank_32_fp16:1>`,
  },
};
const modelName =
  process.env.VIDEO_MODEL ||
  (PROFILES["wan22-5b"].files.every((f) => existsSync(f)) ? "wan22-5b" : "wan21-fast");
const MODEL = PROFILES[modelName];
if (!MODEL) throw new Error(`unknown VIDEO_MODEL ${modelName}`);
const FPS = MODEL.fps;
const FRAMES = MODEL.frames;
const SCENE_SECONDS = FRAMES / FPS;

const idea = process.argv[2];
const seconds = Math.min(Math.max(Number(process.argv[3]) || 30, 5), 180);
if (!idea) {
  console.error('Usage: node longvideo.mjs "your idea" [seconds]');
  process.exit(1);
}
const scenes = Math.max(1, Math.round(seconds / SCENE_SECONDS));
const runDir =
  process.env.IMAGEGEN_OUT ||
  join("D:\\imagegen\\out", `longvideo-${new Date().toISOString().replace(/[:.]/g, "-")}`);
mkdirSync(runDir, { recursive: true });
const log = (...a) => console.log(`[${new Date().toLocaleTimeString()}]`, ...a);
const progress = (done) => console.log(`PROGRESS ${JSON.stringify({ done, total: scenes })}`);

function findFfmpeg() {
  if (process.env.FFMPEG && existsSync(process.env.FFMPEG)) return process.env.FFMPEG;
  const base = join(process.env.LOCALAPPDATA || "", "ms-playwright");
  for (const dir of existsSync(base) ? readdirSync(base) : [])
    if (dir.startsWith("ffmpeg-")) {
      const exe = join(base, dir, "ffmpeg-win64.exe");
      if (existsSync(exe)) return exe;
    }
  throw new Error("ffmpeg not found; set FFMPEG to ffmpeg.exe");
}

const STORY_SYS = `You plan short films for Wan 2.1, a text-to-video model that makes 5-second shots.
Return ONLY JSON: {"title": "...", "style": "...", "scenes": ["...", "..."]} with exactly N scenes.
- "style": one shared description used in EVERY shot so the film looks consistent: the main
  characters or subject with fixed concrete details (age, clothing, colours), the place, era,
  lighting, colour palette and "cinematic, highly detailed, smooth motion, realistic". 25-45 words.
- Each scene: ONE continuous 5-second shot that moves the story forward. Say what MOVES and how,
  and the camera movement (slow dolly-in, tracking shot, aerial pan, static tripod). 20-40 words.
  Vary shot sizes (wide, medium, close-up). Do not repeat the style text. No text or signs.`;

async function storyboard() {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(`${OLLAMA}/api/chat`, {
      method: "POST",
      body: JSON.stringify({
        model: TEXT_MODEL,
        stream: false,
        format: "json",
        keep_alive: 0,
        options: { num_ctx: 8192, temperature: 0.7 },
        messages: [
          { role: "system", content: STORY_SYS.replace("exactly N", `exactly ${scenes}`) },
          { role: "user", content: `Idea: ${idea}\nNumber of scenes: ${scenes}` },
        ],
      }),
    });
    if (!res.ok) throw new Error(`${TEXT_MODEL}: ${res.status} ${await res.text()}`);
    try {
      const plan = JSON.parse((await res.json()).message.content);
      const list = (Array.isArray(plan.scenes) ? plan.scenes : [])
        .map((s) => (typeof s === "string" ? s : s?.prompt || s?.description || ""))
        .filter((s) => s.trim());
      if (typeof plan.style === "string" && list.length) {
        // Too few scenes: repeat the story's last beats; too many: trim.
        while (list.length < scenes) list.push(list[list.length - 1]);
        return { title: String(plan.title || idea), style: plan.style, scenes: list.slice(0, scenes) };
      }
    } catch {}
    log(`storyboard attempt ${attempt} was not valid JSON, retrying`);
  }
  throw new Error("Qwen did not return a usable storyboard");
}

async function unloadOllama() {
  const ps = await (await fetch(`${OLLAMA}/api/ps`)).json();
  for (const m of ps.models || [])
    await fetch(`${OLLAMA}/api/generate`, {
      method: "POST",
      body: JSON.stringify({ model: m.name, keep_alive: 0 }),
    });
  await new Promise((r) => setTimeout(r, 2000));
}

// The retry also decodes the video in time slices, which needs less GPU memory.
function renderScene(prompt, file, seed, retry = false) {
  const args = [
    "-M", "vid_gen",
    ...MODEL.args(), "--t5xxl", T5,
    "-p", MODEL.prompt(prompt),
    "--video-frames", String(FRAMES), "--fps", String(FPS),
    "--clip-on-cpu", "--vae-tiling", "--mmap",
    ...(retry
      ? ["--temporal-tiling", "--vae-tile-size", "256x256",
         "--extra-tiling-args", "temporal_tile_frames=4,temporal_decode_frames=2"]
      : []),
    "-s", String(seed), "-o", file,
  ];
  return new Promise((resolve, reject) => {
    const p = spawn(SD_CLI, args, { cwd: "D:\\sdcpp", windowsHide: true });
    let err = "";
    p.stdout.on("data", () => {});
    p.stderr.on("data", (d) => {
      err = (err + d).slice(-8000);
    });
    p.on("close", (code) =>
      code === 0 && existsSync(file)
        ? resolve()
        : reject(new Error(`sd-cli exited ${code}: ${err.slice(-1200)}`)),
    );
  });
}

// An MJPEG AVI stores each frame as a JPEG in a "00dc" chunk.
function aviFrames(file) {
  // Walk the chunks of the "movi" list only; the "idx1" index after it also contains "00dc".
  const buf = readFileSync(file);
  const frames = [];
  const movi = buf.indexOf("movi");
  if (movi < 8) return frames;
  const end = Math.min(buf.length, movi + buf.readUInt32LE(movi - 4));
  for (let i = movi + 4; i + 8 <= end; ) {
    const id = buf.toString("latin1", i, i + 4);
    const size = buf.readUInt32LE(i + 4);
    const data = buf.subarray(i + 8, i + 8 + size);
    if ((id === "00dc" || id === "00db") && data[0] === 0xff && data[1] === 0xd8) frames.push(data);
    i += 8 + size + (size & 1);
  }
  return frames;
}

// Playwright's ffmpeg has only the file protocol and the image2pipe demuxer, so all JPEG
// frames go into one file that ffmpeg reads as an image sequence.
async function joinClips(clips, out) {
  const ffmpeg = findFfmpeg();
  const frames = clips.flatMap((clip) => aviFrames(clip));
  if (!frames.length) throw new Error("the scene files contain no frames");
  const all = join(dirname(out), "frames.mjpeg");
  writeFileSync(all, Buffer.concat(frames));
  await new Promise((resolve, reject) => {
    const p = spawn(
      ffmpeg,
      [
        "-y", "-hide_banner", "-loglevel", "error",
        "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", all,
        "-c:v", "libvpx", "-b:v", "4M", "-crf", "8", "-pix_fmt", "yuv420p", "-auto-alt-ref", "0",
        out,
      ],
      { windowsHide: true },
    );
    let err = "";
    p.stderr.on("data", (d) => {
      err = (err + d).slice(-4000);
    });
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${err}`))));
  });
  rmSync(all, { force: true });
  return frames.length;
}

log(`Long video (${modelName}): ${seconds}s requested, ${scenes} scenes of ~${SCENE_SECONDS.toFixed(1)}s`);
const plan = await storyboard();
log(`Title: ${plan.title}`);
log(`Style: ${plan.style}`);
writeFileSync(join(runDir, "storyboard.json"), JSON.stringify(plan, null, 2));
progress(0);
await unloadOllama();

const baseSeed = Math.floor(Math.random() * 2 ** 30);
const clips = [];
const failed = [];
for (const [index, scene] of plan.scenes.entries()) {
  const file = join(runDir, `scene${String(index + 1).padStart(2, "0")}.avi`);
  const prompt = `${plan.style}. ${scene}`;
  const t0 = Date.now();
  let ok = false;
  for (let attempt = 0; attempt < 2 && !ok; attempt++) {
    try {
      await renderScene(prompt, file, baseSeed + index * 7919 + attempt, attempt > 0);
      ok = true;
    } catch (error) {
      log(`  scene ${index + 1} attempt ${attempt + 1} failed: ${String(error.message).slice(0, 300)}`);
    }
  }
  if (ok) {
    clips.push(file);
    log(`  scene ${index + 1}/${scenes} done (${((Date.now() - t0) / 1000).toFixed(0)}s): ${scene}`);
  } else failed.push(index + 1);
  progress(index + 1);
}
if (!clips.length) throw new Error("no scene could be rendered");

const out = join(runDir, "video.webm");
const frames = await joinClips(clips, out);
log(`Video saved ${out}: ${clips.length} scenes, ${frames} frames, ${(frames / FPS).toFixed(1)}s`);
writeFileSync(
  join(runDir, "history.json"),
  JSON.stringify({ idea, seconds, plan, clips, failed, frames }, null, 2),
);
console.log(
  `RESULT ${JSON.stringify({
    prompt: `${plan.title}: ${plan.style}`,
    file: "video.webm",
    frames,
    scenes: clips.length,
    failedScenes: failed,
    seconds: Math.round(frames / FPS),
  })}`,
);
