# Local image and video generation

OpenMuse calls these scripts through `IMAGEGEN_SCRIPT` and `VIDEOGEN_SCRIPT`. It passes the
output folder in `IMAGEGEN_OUT`, and each script prints one `RESULT {json}` line at the end.
Ollama must be running. The paths at the top of each script are for the original machine;
change them to match yours.

## `loop.mjs`: image with a quality loop

```
node loop.mjs "idea" [maxRounds=5] [minScore=7]
```

1. `qwen3-uncensored` turns the idea into a detailed SDXL prompt.
2. [stable-diffusion.cpp](https://github.com/leejet/stable-diffusion.cpp) (`sd-cli.exe`,
   CUDA 12 build) renders it at 1024x1024 with RealVisXL V5 and the SDXL fp16-fix VAE.
   The flags `--clip-on-cpu --mmap --vae-tiling` fit an 8 GB GPU.
3. `gemma3:4b` scores a 512 px copy for match, anatomy, composition and technical quality.
   Broken anatomy or a wrong subject caps the score.
4. Qwen rewrites the prompt from the critique until the score reaches `minScore` or the rounds
   run out.

Output: `round<N>.png`, `best.png` and `history.json`. Ollama models are unloaded before each
render so the GPU is free.

## `video.mjs`: short clip

```
node video.mjs "idea"
```

Qwen writes a motion-focused prompt. Wan 2.1 T2V 1.3B (fp16, UMT5-XXL Q6_K text encoder) then
renders 33 frames at 832x480 with `sd-cli -M vid_gen`. That is about 2 seconds of video and
takes about 5 minutes on an RTX 5050 Laptop.

## `longvideo.mjs`: videos of 5 seconds to 3 minutes

```
node longvideo.mjs "idea" [seconds=30]
```

A video model makes about 5 seconds in one pass, so a video is a short film of 5-second scenes.
`VIDEO_MODEL` chooses the model:

| `VIDEO_MODEL` | Model | Output | Files in `D:\models\wan` |
|---|---|---|---|
| `wan22-5b` (default when its files exist) | [Wan 2.2 TI2V 5B](https://huggingface.co/QuantStack/Wan2.2-TI2V-5B-GGUF), Q8_0 GGUF, 30 steps (`VIDEO_STEPS`) | 1280x704, 24 fps, 121 frames per scene | `Wan2.2-TI2V-5B-Q8_0.gguf` (5.4 GB), `wan2.2_vae.safetensors` (1.4 GB) |
| `wan21-fast` | Wan 2.1 T2V 1.3B with a 4-step LoRA (below) | 832x480, 16 fps, 81 frames per scene | see below |

Wan 2.2 5B looks close to real footage and keeps shapes steady. On an RTX 5050 Laptop with
24 GB RAM, one 5-second scene took about 40 minutes at the default 1280x704 and about 13 minutes
at 832x480 (`VIDEO_SIZE=832x480`, still realistic, a little less detail). It needs about 11 GB of
RAM; close other large apps first. The 4-step Wan 2.1 setup takes about 3 minutes per scene but looks
oversaturated and plastic, and objects change shape between frames.

Steps:

1. `qwen3-uncensored` writes a storyboard: a shared `style` (characters, place, palette) used in
   every shot so the scenes look consistent, plus one shot description per scene.
2. With `wan21-fast`, each scene renders as 81 frames at 832x480 with the
   [Self-Forcing DMD LoRA for Wan 2.1 1.3B](https://huggingface.co/Kijai/WanVideo_comfy/tree/main/LoRAs/Wan2_1_self_forcing_1_3B)
   (`Wan2_1_self_forcing_dmd_1_3B_lora_rank_32_fp16.safetensors`, 87 MB, in `D:\models\wan\loras`):
   4 steps and CFG 1 instead of 30 steps. A failed scene is retried once with another seed.
   Each scene takes about 3 minutes on an RTX 5050 Laptop, so a 10-second video takes about
   6 minutes and a 1-minute video about 40 minutes.
3. The JPEG frames of the scene AVIs (MJPEG) are joined into `video.webm` (VP8) at the model's frame rate. The
   joining uses the small ffmpeg that Playwright installs, which only reads files, so the frames
   are first written to one temporary file. Set `FFMPEG` to use another ffmpeg.

It prints `PROGRESS {"done":n,"total":m}` after each scene. In OpenMuse, `generate_video` runs it
for every video in the background (`LONGVIDEO_SCRIPT`), and the chat card shows the
scene progress and plays the video when it is ready.

Limits: each scene is generated on its own, so people and objects can change a little between
scenes; there is no sound; the GPU is busy for the whole run.

## `make-image.bat`

A Windows shortcut for `loop.mjs`. It asks for an idea when you run it without one.

## Models used

| File | Purpose |
|---|---|
| `RealVisXL_V5.0_fp16.safetensors` | SDXL photorealistic checkpoint |
| `sdxl_vae_fp16fix.safetensors` | SDXL VAE |
| `wan2.1_t2v_1.3B_fp16.safetensors`, `wan_2.1_vae.safetensors` | Wan 2.1 text-to-video |
| `umt5-xxl-encoder-Q6_K.gguf` | Wan text encoder |
