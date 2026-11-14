// Change a photo. Usage: node D:/imagegen/edit.mjs photo.jpg "instruction" [edit|restyle]
//   edit    - FLUX.1 Kontext dev follows a written change ("make the shirt red") and keeps the
//             rest of the photo.
//   restyle - SDXL (RealVisXL) img2img redraws the whole photo from a description, keeping its
//             layout; good for a new style, weaker at small exact changes.
// OpenMuse sets IMAGEGEN_OUT. Writes best.png there; the last stdout line is `RESULT {json}`.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fitPhoto, sizeFor, uprightSize } from "./photo.mjs";

const OLLAMA = "http://localhost:11434";
const SD_CLI = "D:\\sdcpp\\sd-cli.exe";
const FLUX = "D:\\models\\flux";
const KONTEXT = {
  model: join(FLUX, "flux1-kontext-dev-Q4_K_M.gguf"),
  vae: join(FLUX, "ae.safetensors"),
  clip: join(FLUX, "clip_l.safetensors"),
  t5: join(FLUX, "t5-v1_1-xxl-encoder-Q5_K_M.gguf"),
};
const SDXL = {
  model: "D:\\models\\sdxl\\RealVisXL_V5.0_fp16.safetensors",
  vae: "D:\\models\\sdxl\\sdxl_vae_fp16fix.safetensors",
};
const NEGATIVE =
  "blurry, lowres, deformed, disfigured, bad anatomy, extra fingers, watermark, text, jpeg artifacts";

const [photo, instruction, modeArg] = process.argv.slice(2);
const mode = modeArg === "restyle" ? "restyle" : "edit";
if (!photo || !instruction || !existsSync(photo)) {
  console.error('Usage: node edit.mjs photo.jpg "instruction" [edit|restyle]');
  process.exit(1);
}
const runDir =
  process.env.IMAGEGEN_OUT ||
  join("D:\\imagegen\\out", `edit-${new Date().toISOString().replace(/[:.]/g, "-")}`);
mkdirSync(runDir, { recursive: true });
const log = (...a) => console.log(`[${new Date().toLocaleTimeString()}]`, ...a);

async function unloadOllama() {
  try {
    const ps = await (await fetch(`${OLLAMA}/api/ps`)).json();
    for (const m of ps.models || [])
      await fetch(`${OLLAMA}/api/generate`, {
        method: "POST",
        body: JSON.stringify({ model: m.name, keep_alive: 0 }),
      });
    await new Promise((r) => setTimeout(r, 2000));
  } catch {}
}

function sd(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(SD_CLI, args, { cwd: "D:\\sdcpp", windowsHide: true });
    let err = "";
    p.stdout.on("data", () => {});
    p.stderr.on("data", (d) => {
      err = (err + d).slice(-8000);
    });
    p.on("error", reject);
    p.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`sd-cli exited ${code}: ${err.slice(-1200)}`)),
    );
  });
}

const t0 = Date.now();
const upright = await uprightSize(photo);
// About one megapixel, the size both models were trained at.
const size = sizeFor(upright, 1024 * 1024, 64);
const input = await fitPhoto(photo, join(runDir, "input.png"), size.width, size.height);
log(`${mode}: ${upright.width}x${upright.height} photo -> ${size.width}x${size.height}: ${instruction}`);
await unloadOllama();
const out = join(runDir, "best.png");
const seed = Math.floor(Math.random() * 2 ** 31);
const common = ["-W", String(size.width), "-H", String(size.height), "--vae-tiling", "--clip-on-cpu", "--mmap"];
if (mode === "edit") {
  const missing = Object.values(KONTEXT).filter((f) => !existsSync(f));
  if (missing.length) throw new Error(`Kontext model files are missing: ${missing.join(", ")}`);
  await sd([
    "--diffusion-model", KONTEXT.model, "--vae", KONTEXT.vae,
    "--clip_l", KONTEXT.clip, "--t5xxl", KONTEXT.t5,
    "-r", input, "-p", instruction,
    "--cfg-scale", "1.0", "--guidance", "2.5", "--sampling-method", "euler", "--steps", "24",
    "--offload-to-cpu", ...common, "-s", String(seed), "-o", out,
  ]);
} else {
  await sd([
    "-m", SDXL.model, "--vae", SDXL.vae,
    "-i", input, "--strength", process.env.RESTYLE_STRENGTH || "0.6",
    "-p", instruction, "-n", NEGATIVE,
    "--steps", "32", "--cfg-scale", "5", "--sampling-method", "dpm++2m", "--scheduler", "karras",
    ...common, "-s", String(seed), "-o", out,
  ]);
}
if (!existsSync(out)) throw new Error("sd-cli did not write the picture");
const seconds = Math.round((Date.now() - t0) / 1000);
log(`saved ${out} (${seconds}s)`);
writeFileSync(join(runDir, "history.json"), JSON.stringify({ photo, instruction, mode, size, seed, seconds }, null, 2));
console.log(`RESULT ${JSON.stringify({ prompt: instruction, mode, file: "best.png", seconds })}`);
