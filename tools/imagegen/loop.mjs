// Idea -> Qwen3 prompt -> SDXL image -> Gemma3 critique -> Qwen3 refine -> repeat until the
// quality target is met (or max rounds). Models run one at a time on the 8 GB GPU.
// Usage: node D:/imagegen/loop.mjs "your idea" [maxRounds=5] [minScore=7]
// OpenMuse sets IMAGEGEN_OUT. The last stdout line is `RESULT {json}`.
import { spawn } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OLLAMA = "http://localhost:11434";
const TEXT_MODEL = "qwen3-uncensored";
const VISION_MODEL = "gemma3:4b";
const SD_CLI = "D:\\sdcpp\\sd-cli.exe";
const SD_MODEL = "D:\\models\\sdxl\\RealVisXL_V5.0_fp16.safetensors";
const SD_VAE = "D:\\models\\sdxl\\sdxl_vae_fp16fix.safetensors";
const BASE_NEGATIVE =
  "lowres, blurry, out of focus, jpeg artifacts, noise, oversaturated, deformed, disfigured, bad anatomy, extra limbs, extra fingers, missing fingers, fused fingers, mutated hands, bad hands, malformed face, asymmetrical eyes, cross-eyed, duplicate, cropped, text, watermark, signature, logo, cartoon, 3d render, plastic skin";

const idea = process.argv[2];
const maxRounds = Math.min(Math.max(Number(process.argv[3] || 5), 1), 8);
const minScore = Number(process.argv[4] || process.env.IMAGEGEN_MIN_SCORE || 7);
if (!idea) {
  console.error('Usage: node loop.mjs "your idea" [maxRounds] [minScore]');
  process.exit(1);
}
const runDir =
  process.env.IMAGEGEN_OUT ||
  join("D:\\imagegen\\out", new Date().toISOString().replace(/[:.]/g, "-"));
mkdirSync(runDir, { recursive: true });
const log = (...a) => console.log(`[${new Date().toLocaleTimeString()}]`, ...a);

async function chat(model, messages, { images, ctx = 4096, temperature } = {}) {
  if (images) messages = messages.map((m, i) => (i === messages.length - 1 ? { ...m, images } : m));
  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: "POST",
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      format: "json",
      keep_alive: 0,
      options: { num_ctx: ctx, ...(temperature === undefined ? {} : { temperature }) },
    }),
  });
  if (!res.ok) throw new Error(`${model}: ${res.status} ${await res.text()}`);
  const text = (await res.json()).message.content;
  try {
    return JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error(`${model} did not return JSON: ${text.slice(0, 200)}`);
  }
}

async function unloadAll() {
  const ps = await (await fetch(`${OLLAMA}/api/ps`)).json();
  for (const m of ps.models || [])
    await fetch(`${OLLAMA}/api/generate`, {
      method: "POST",
      body: JSON.stringify({ model: m.name, keep_alive: 0 }),
    });
  for (let i = 0; i < 20; i++) {
    if (!((await (await fetch(`${OLLAMA}/api/ps`)).json()).models || []).length) return;
    await new Promise((r) => setTimeout(r, 500));
  }
}

function generate(prompt, negative, seed, file) {
  const args = [
    "-m",
    SD_MODEL,
    "--vae",
    SD_VAE,
    "-p",
    prompt,
    "-n",
    negative,
    "-W",
    "1024",
    "-H",
    "1024",
    "--steps",
    "32",
    "--cfg-scale",
    "5",
    "--sampling-method",
    "dpm++2m",
    "--scheduler",
    "karras",
    "--vae-tiling",
    "--clip-on-cpu",
    "--mmap",
    "-s",
    String(seed),
    "-o",
    file,
  ];
  return new Promise((resolve, reject) => {
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
}

// Downscale to 512px JPEG for the vision model.
function shrink(file) {
  const out = file.replace(/\.png$/, "_small.jpg");
  const ps = `Add-Type -AssemblyName System.Drawing; $i=[System.Drawing.Image]::FromFile('${file}'); $b=New-Object System.Drawing.Bitmap 512,512; $g=[System.Drawing.Graphics]::FromImage($b); $g.InterpolationMode='HighQualityBicubic'; $g.DrawImage($i,0,0,512,512); $b.Save('${out}',[System.Drawing.Imaging.ImageFormat]::Jpeg); $g.Dispose(); $b.Dispose(); $i.Dispose()`;
  return new Promise((resolve, reject) => {
    const p = spawn("powershell.exe", ["-NoProfile", "-Command", ps], { windowsHide: true });
    p.on("close", (code) =>
      code === 0
        ? resolve(readFileSync(out).toString("base64"))
        : reject(new Error(`resize failed (${code})`)),
    );
  });
}

const PROMPT_SYS = `You are a world-class prompt engineer for Stable Diffusion XL (RealVisXL, a photorealistic model).
Turn the user's idea into ONE excellent prompt. Return ONLY JSON: {"prompt": "...", "negative": "..."}.

Rules for "prompt":
- Keep EVERY subject, detail, count, colour and setting the user asked for. Never drop or change them.
- Order: main subject with concrete details (age, clothing, pose, expression, materials) -> action -> environment/background -> composition and framing (close-up / medium shot / wide shot, angle) -> camera and lens (e.g. "shot on Sony A7 IV, 85mm f/1.8, shallow depth of field") -> lighting (e.g. "golden hour rim light", "soft window light", "neon reflections") -> mood and colour palette -> quality tags ("highly detailed, sharp focus, 8k, professional photography").
- Use vivid, specific, visual words; comma-separated phrases; 45-75 words. No sentences about feelings that cannot be seen.
- Text in images renders badly, so never ask for readable words or signs.
"negative": extra things to avoid for THIS image (a short comma-separated list); generic defects are added automatically.

Example idea: "old fisherman in Kerala"
Example output: {"prompt": "weathered old Indian fisherman with white beard and deep wrinkles, wearing faded checked lungi, holding a wet fishing net, standing on a wooden Chinese fishing net platform in Kochi backwaters, medium shot, eye level, shot on Canon R5 85mm f/1.4, shallow depth of field, warm golden hour side light, mist over water, teal and orange palette, highly detailed skin texture, sharp focus, 8k, award-winning documentary photography", "negative": "modern boats, crowds, sunglasses"}`;

const CRITIC_PROMPT = (
  goal,
) => `You are a very strict professional photo editor. The requested image was: "${goal}".
Judge the image honestly. Use this scale for every score: 1-3 broken or wrong subject, 4-5 clearly flawed, 6 acceptable but mediocre, 7 good professional photo with minor issues, 8 excellent, 9-10 flawless magazine-cover quality. Do not lower scores for subjective taste (e.g. "feels staged") when the request is fulfilled. Score each 1-10:
- "match": does it show everything that was requested, correctly?
- "anatomy": are faces, hands, bodies and animals correct (no extra/missing limbs, distorted faces)? Use 10 if there are none.
- "composition": framing, subject placement, background.
- "technical": sharpness, lighting, colour, realism, no artifacts.
Return ONLY JSON: {"match":n,"anatomy":n,"composition":n,"technical":n,"problems":["specific visible problems"],"fixes":["concrete prompt changes"]}`;

function scoreOf(c) {
  const parts = ["match", "anatomy", "composition", "technical"].map((k) => Number(c[k]));
  if (parts.some((n) => !Number.isFinite(n))) return Number(c.score) || 0;
  const avg = parts.reduce((a, b) => a + b, 0) / parts.length;
  // Broken anatomy or a wrong subject caps the score, so nice lighting cannot hide them.
  const cap = Math.min(parts[0], parts[1]) <= 5 ? Math.min(parts[0], parts[1]) + 1 : 10;
  return Math.round(Math.min(avg, cap) * 10) / 10;
}

const history = [];
log(`Goal: score >= ${minScore}, up to ${maxRounds} rounds`);
let { prompt, negative } = await chat(
  TEXT_MODEL,
  [
    { role: "system", content: PROMPT_SYS },
    { role: "user", content: `Idea: ${idea}` },
  ],
  { temperature: 0.7 },
);
let best = null;

for (let r = 1; r <= maxRounds; r++) {
  log(`Round ${r}/${maxRounds} prompt: ${prompt}`);
  await unloadAll();
  const file = join(runDir, `round${r}.png`);
  const seed = Math.floor(Math.random() * 2 ** 31);
  const t0 = Date.now();
  await generate(prompt, `${negative ? `${negative}, ` : ""}${BASE_NEGATIVE}`, seed, file);
  log(`  image saved ${file} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);

  await new Promise((r) => setTimeout(r, 2000));
  let critique;
  try {
    const small = await shrink(file);
    critique = await chat(VISION_MODEL, [{ role: "user", content: CRITIC_PROMPT(idea) }], {
      images: [small],
      ctx: 2048,
      temperature: 0.2,
    });
  } catch (e) {
    log(`  vision critique failed (${String(e.message).slice(0, 120)})`);
    critique = { problems: ["no critique available"], fixes: ["more detail and sharper focus"] };
  }
  const score = scoreOf(critique);
  log(`  score ${score}/10; problems: ${(critique.problems || []).join("; ")}`);
  history.push({ round: r, seed, prompt, negative, file, score, critique });
  if (!best || score >= best.score) best = { round: r, score, file, prompt };
  if (score >= minScore || r === maxRounds) break;

  ({ prompt, negative } = await chat(
    TEXT_MODEL,
    [
      { role: "system", content: PROMPT_SYS },
      {
        role: "user",
        content: `Idea: ${idea}\nPrevious prompt: ${prompt}\nPrevious negative: ${negative}\nPhoto editor review (score ${score}/10): ${JSON.stringify(critique)}\nWrite an improved prompt that fixes every listed problem while keeping the whole idea. Put the most important fixes early in the prompt.`,
      },
    ],
    { temperature: 0.7 },
  ));
}

copyFileSync(best.file, join(runDir, "best.png"));
const passed = best.score >= minScore;
writeFileSync(
  join(runDir, "history.json"),
  JSON.stringify({ idea, minScore, best, history }, null, 2),
);
log(
  `Done. Best: round ${best.round} (score ${best.score}, target ${minScore}${passed ? " met" : " NOT met"})`,
);
console.log(
  `RESULT ${JSON.stringify({ prompt: best.prompt, score: best.score, round: best.round, rounds: history.length, minScore, passed })}`,
);
