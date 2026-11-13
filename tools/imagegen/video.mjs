// Idea -> Qwen3 video prompt -> Wan 2.1 T2V 1.3B (stable-diffusion.cpp) -> video.webm
// Usage: node D:/imagegen/video.mjs "your idea" [frames=33]
// OpenMuse sets IMAGEGEN_OUT. The last stdout line is `RESULT {json}`.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OLLAMA = "http://localhost:11434";
const TEXT_MODEL = "qwen3-uncensored";
const SD_CLI = "D:\\sdcpp\\sd-cli.exe";
const WAN = "D:\\models\\wan\\wan2.1_t2v_1.3B_fp16.safetensors";
const WAN_VAE = "D:\\models\\wan\\wan_2.1_vae.safetensors";
const T5 = "D:\\models\\wan\\umt5-xxl-encoder-Q6_K.gguf";
const NEGATIVE =
  "overexposed, static, frozen frame, blurry details, subtitles, text, watermark, worst quality, low quality, jpeg artifacts, ugly, deformed, extra fingers, bad hands, bad face, disfigured, malformed limbs, fused fingers, cluttered background, three legs, walking backwards, flickering";

const idea = process.argv[2];
const frames = [17, 33, 49, 65, 81].includes(Number(process.argv[3]))
  ? Number(process.argv[3])
  : 33;
if (!idea) {
  console.error('Usage: node video.mjs "your idea" [frames]');
  process.exit(1);
}
const runDir =
  process.env.IMAGEGEN_OUT ||
  join("D:\\imagegen\\out", `video-${new Date().toISOString().replace(/[:.]/g, "-")}`);
mkdirSync(runDir, { recursive: true });
const log = (...a) => console.log(`[${new Date().toLocaleTimeString()}]`, ...a);

const SYS = `You write prompts for Wan 2.1, a text-to-video model. Return ONLY JSON {"prompt": "..."}.
Keep every subject and detail the user asked for. Describe ONE continuous shot of about 2 seconds:
subject with concrete visual details, the clear MOTION happening (what moves and how), environment,
camera movement (e.g. slow dolly-in, tracking shot, static tripod, aerial pan), lighting and mood,
then "cinematic, highly detailed, smooth motion, realistic". 40-70 words, comma-separated. No text or signs.`;

const res = await fetch(`${OLLAMA}/api/chat`, {
  method: "POST",
  body: JSON.stringify({
    model: TEXT_MODEL,
    stream: false,
    format: "json",
    keep_alive: 0,
    options: { num_ctx: 4096, temperature: 0.7 },
    messages: [
      { role: "system", content: SYS },
      { role: "user", content: `Idea: ${idea}` },
    ],
  }),
});
if (!res.ok) throw new Error(`${TEXT_MODEL}: ${res.status} ${await res.text()}`);
const { prompt } = JSON.parse((await res.json()).message.content);
log(`Prompt: ${prompt}`);

// Free the GPU before Wan loads.
const ps = await (await fetch(`${OLLAMA}/api/ps`)).json();
for (const m of ps.models || [])
  await fetch(`${OLLAMA}/api/generate`, {
    method: "POST",
    body: JSON.stringify({ model: m.name, keep_alive: 0 }),
  });
await new Promise((r) => setTimeout(r, 2000));

const out = join(runDir, "video.webm");
const args = [
  "-M",
  "vid_gen",
  "--diffusion-model",
  WAN,
  "--vae",
  WAN_VAE,
  "--t5xxl",
  T5,
  "-p",
  prompt,
  "-n",
  NEGATIVE,
  "--cfg-scale",
  "6.0",
  "--sampling-method",
  "euler",
  "--steps",
  "30",
  "-W",
  "832",
  "-H",
  "480",
  "--video-frames",
  String(frames),
  "--flow-shift",
  "3.0",
  "--clip-on-cpu",
  "--vae-tiling",
  "--mmap",
  "-s",
  String(Math.floor(Math.random() * 2 ** 31)),
  "-o",
  out,
];
const t0 = Date.now();
await new Promise((resolve, reject) => {
  const p = spawn(SD_CLI, args, { cwd: "D:\\sdcpp", windowsHide: true });
  let err = "";
  p.stdout.on("data", () => {});
  p.stderr.on("data", (d) => {
    err = (err + d).slice(-8000);
  });
  p.on("close", (code) =>
    code === 0 ? resolve() : reject(new Error(`sd-cli exited ${code}: ${err.slice(-1500)}`)),
  );
});
const file = existsSync(out)
  ? "video.webm"
  : readdirSync(runDir).find((f) => /\.(webm|mp4|avi)$/i.test(f));
if (!file) throw new Error(`no video file was written in ${runDir}`);
log(`Video saved ${join(runDir, file)} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
writeFileSync(
  join(runDir, "history.json"),
  JSON.stringify({ idea, prompt, frames, file }, null, 2),
);
console.log(`RESULT ${JSON.stringify({ prompt, file, frames })}`);
