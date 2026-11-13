import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import type { Auth } from "./auth.ts";
import type { Config } from "./config.ts";
import type { Store } from "./db.ts";
import { AppError } from "./errors.ts";

const MEDIA_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TIMEOUT_MS = 30 * 60 * 1000;

/**
 * The useful part of a failed script's stderr. A Node crash ends with a stack trace and
 * "Node.js vX", so the first "Error:" line is preferred over the last lines.
 */
export function scriptError(stderr: string): string {
  const lines = stderr
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/^at\s|^Node\.js v|^[\^{}]+$/.test(line));
  const error = lines.find((line) => /\b\w*Error\b:/.test(line));
  return (
    (error ?? lines.slice(-3).join(" ")).slice(0, 600) || "the script stopped without a message"
  );
}
const FORMATS = {
  png: "image/png",
  webm: "video/webm",
  mp4: "video/mp4",
  avi: "video/x-msvideo",
} as const;
type Format = keyof typeof FORMATS;

export type GeneratedMedia = {
  id: string;
  kind: "image" | "video";
  format: Format;
  idea: string;
  prompt: string;
  /** Vision-model quality score for images (0 when not scored). */
  score: number;
  minScore?: number;
  /** False when no image reached minScore; such an image is kept but not shown. */
  passed: boolean;
  rounds: number;
  createdAt: string;
  /** Long videos run in the background: "running" until the file is ready. */
  status?: "running" | "done" | "failed";
  progress?: { done: number; total: number };
  seconds?: number;
  error?: string;
};

/** Scenes of about 5 seconds each; a long video gets this much time per scene. */
const SCENE_SECONDS = 5;
const MINUTES_PER_SCENE = 15;

type ScriptResult = {
  prompt?: unknown;
  score?: unknown;
  rounds?: unknown;
  minScore?: unknown;
  passed?: unknown;
  file?: unknown;
};

/**
 * Runs local generation scripts (IMAGEGEN_SCRIPT for pictures, VIDEOGEN_SCRIPT for clips).
 * A script receives the idea and its numeric options as arguments and IMAGEGEN_OUT as its
 * output directory, writes `best.png` (image) or the `file` it reports (video) there, and
 * prints one `RESULT {json}` line. One generation runs at a time: it uses the whole GPU.
 */
export class ImageGen {
  private running = false;
  constructor(
    private readonly db: Store,
    private readonly config: Config,
    private readonly auth: Auth,
  ) {}
  get enabled() {
    return !!this.config.imageGenScript;
  }
  get videoEnabled() {
    return !!this.config.videoGenScript;
  }
  get longVideoEnabled() {
    return !!this.config.longVideoScript;
  }
  private directory() {
    return resolve(this.config.dataDir, "images");
  }
  private pathFor(id: string, format: Format) {
    if (!MEDIA_ID.test(id) || !(format in FORMATS)) throw new AppError("Image not found", 404);
    const directory = this.directory();
    const path = resolve(directory, `${id}.${format}`);
    if (!path.startsWith(`${directory}${sep}`)) throw new AppError("Image not found", 404);
    return path;
  }
  private async run(
    script: string,
    args: string[],
    runDir: string,
    signal?: AbortSignal,
    options: { timeoutMs?: number; onLine?: (line: string) => void } = {},
  ) {
    const output = await new Promise<string>((done, fail) => {
      const child = spawn(process.execPath, [script, ...args], {
        env: { ...process.env, IMAGEGEN_OUT: runDir },
        windowsHide: true,
      });
      let stdout = "";
      let stderr = "";
      let partial = "";
      const stop = () => child.kill();
      const timer = setTimeout(stop, options.timeoutMs ?? TIMEOUT_MS);
      signal?.addEventListener("abort", stop, { once: true });
      child.stdout.on("data", (chunk) => {
        stdout = (stdout + chunk).slice(-20000);
        if (!options.onLine) return;
        const lines = (partial + chunk).split("\n");
        partial = lines.pop() ?? "";
        for (const line of lines) options.onLine(line.trim());
      });
      child.stderr.on("data", (chunk) => {
        stderr = (stderr + chunk).slice(-4000);
      });
      child.on("error", fail);
      child.on("close", (code) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", stop);
        if (signal?.aborted) return fail(new Error("Generation was cancelled"));
        if (code !== 0) return fail(new Error(`Generation failed: ${scriptError(stderr)}`));
        done(stdout);
      });
    });
    const line = output
      .split("\n")
      .reverse()
      .find((l) => l.startsWith("RESULT "));
    if (!line) throw new Error("Generation did not report a result");
    return JSON.parse(line.slice(7)) as ScriptResult;
  }
  private async exclusive<T>(work: () => Promise<T>) {
    if (this.running)
      throw new AppError("Another picture or video is being made; try again when it finishes", 409);
    this.running = true;
    try {
      return await work();
    } finally {
      this.running = false;
    }
  }
  generate(
    owner: string,
    idea: string,
    options: { maxRounds: number; minScore: number },
    signal?: AbortSignal,
  ): Promise<GeneratedMedia> {
    const script = this.config.imageGenScript;
    if (!script) throw new AppError("Image generation is not configured", 503);
    return this.exclusive(async () => {
      const id = randomUUID();
      const runDir = join(this.directory(), "runs", id);
      await mkdir(runDir, { recursive: true });
      const result = await this.run(
        script,
        [idea, String(options.maxRounds), String(options.minScore)],
        runDir,
        signal,
      );
      await copyFile(join(runDir, "best.png"), this.pathFor(id, "png"));
      const score = Number(result.score) || 0;
      const media: GeneratedMedia = {
        id,
        kind: "image",
        format: "png",
        idea,
        prompt: String(result.prompt ?? ""),
        score,
        minScore: options.minScore,
        passed: typeof result.passed === "boolean" ? result.passed : score >= options.minScore,
        rounds: Number(result.rounds) || options.maxRounds,
        createdAt: new Date().toISOString(),
      };
      await this.db.put(owner, "images", media);
      return media;
    });
  }
  generateVideo(owner: string, idea: string, signal?: AbortSignal): Promise<GeneratedMedia> {
    const script = this.config.videoGenScript;
    if (!script) throw new AppError("Video generation is not configured", 503);
    return this.exclusive(async () => {
      const id = randomUUID();
      const runDir = join(this.directory(), "runs", id);
      await mkdir(runDir, { recursive: true });
      const result = await this.run(script, [idea], runDir, signal);
      const file = String(result.file ?? "video.webm");
      const format = file.split(".").at(-1)?.toLowerCase() as Format;
      if (!(format in FORMATS) || format === "png" || /[\\/]/.test(file))
        throw new Error(`Unexpected video file: ${file}`);
      await copyFile(join(runDir, file), this.pathFor(id, format));
      const media: GeneratedMedia = {
        id,
        kind: "video",
        format,
        idea,
        prompt: String(result.prompt ?? ""),
        score: 0,
        passed: true,
        rounds: 1,
        createdAt: new Date().toISOString(),
      };
      await this.db.put(owner, "images", media);
      return media;
    });
  }
  /**
   * Starts a long video (several ~5 s scenes joined together) in the background and returns
   * at once. The record stays "running" with scene progress until the file is ready.
   */
  async startLongVideo(owner: string, idea: string, seconds: number) {
    const script = this.config.longVideoScript;
    if (!script) throw new AppError("Long video generation is not configured", 503);
    if (this.running)
      throw new AppError("Another picture or video is being made; try again when it finishes", 409);
    this.running = true;
    const id = randomUUID();
    const total = Math.max(1, Math.round(seconds / SCENE_SECONDS));
    const media: GeneratedMedia = {
      id,
      kind: "video",
      format: "webm",
      idea,
      prompt: "",
      score: 0,
      passed: true,
      rounds: 1,
      createdAt: new Date().toISOString(),
      status: "running",
      progress: { done: 0, total },
      seconds,
    };
    try {
      await this.db.put(owner, "images", media);
    } catch (error) {
      this.running = false;
      throw error;
    }
    void (async () => {
      const save = (update: Partial<GeneratedMedia>) =>
        this.db.put(owner, "images", Object.assign(media, update)).catch(() => {});
      try {
        const runDir = join(this.directory(), "runs", id);
        await mkdir(runDir, { recursive: true });
        const result = await this.run(script, [idea, String(seconds)], runDir, undefined, {
          timeoutMs: (total * MINUTES_PER_SCENE + 20) * 60 * 1000,
          onLine: (line) => {
            if (!line.startsWith("PROGRESS ")) return;
            try {
              const value = JSON.parse(line.slice(9)) as { done?: unknown; total?: unknown };
              void save({
                progress: { done: Number(value.done) || 0, total: Number(value.total) || total },
              });
            } catch {}
          },
        });
        const file = String(result.file ?? "video.webm");
        const format = file.split(".").at(-1)?.toLowerCase() as Format;
        if (!(format in FORMATS) || format === "png" || /[\\/]/.test(file))
          throw new Error(`Unexpected video file: ${file}`);
        await copyFile(join(runDir, file), this.pathFor(id, format));
        await save({
          status: "done",
          format,
          prompt: String(result.prompt ?? ""),
          seconds: Number((result as { seconds?: unknown }).seconds) || seconds,
          progress: { done: total, total },
        });
      } catch (error) {
        await save({
          status: "failed",
          error: error instanceof Error ? error.message.slice(0, 500) : "Video failed",
        });
      } finally {
        this.running = false;
      }
    })();
    return media;
  }
  async get(owner: string, id: string) {
    if (!MEDIA_ID.test(id)) throw new AppError("Image not found", 404);
    const media = await this.db.get<GeneratedMedia>(owner, "images", id);
    if (!media) throw new AppError("Image not found", 404);
    // A server restart ends the background job; its record must not stay "running".
    if (media.status === "running" && !this.running) {
      media.status = "failed";
      media.error = "The video was interrupted when the server stopped. Ask again to retry.";
      await this.db.put(owner, "images", media);
    }
    const format: Format = media.format ?? "png";
    const ready = !media.status || media.status === "done";
    return {
      ...media,
      kind: media.kind ?? "image",
      format,
      mimeType: FORMATS[format],
      url: ready ? this.auth.sign(owner, `/api/images/${id}/content`) : "",
    };
  }
  async content(owner: string, id: string) {
    const media = await this.get(owner, id);
    if (media.status && media.status !== "done")
      throw new AppError("This video is not ready yet", 404);
    return { mimeType: media.mimeType, bytes: await readFile(this.pathFor(id, media.format)) };
  }
}
