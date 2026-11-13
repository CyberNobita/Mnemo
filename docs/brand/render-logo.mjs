// Renders the Mnemo logo (Devanagari "म" on an indigo-violet tile) to the PNGs the app uses.
// It needs a Devanagari font: "Nirmala UI" ships with Windows. Run from the repo root:
//   node docs/brand/render-logo.mjs <output-folder>
// Then copy icon.png, favicon.png and logo.png (as mnemo-logo.png) into apps/mobile/assets,
// and logo-512.png into docs/brand/mnemo-logo.png.
import { chromium } from "playwright";

const out = process.argv[2] ?? ".";
const svg = (size) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 256 256">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#4F46E5"/><stop offset="1" stop-color="#9333EA"/></linearGradient></defs>
  <rect width="256" height="256" rx="60" fill="url(#g)"/>
  <text x="128" y="186" text-anchor="middle" font-family="Nirmala UI" font-weight="700" font-size="190" fill="#fff">म</text>
  <circle cx="214" cy="40" r="10" fill="#FFD36B"/>
</svg>`;

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, size] of [
  ["icon.png", 1024],
  ["logo-512.png", 512],
  ["logo.png", 256],
  ["favicon.png", 48],
]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<html><body style="margin:0;background:transparent">${svg(size)}</body></html>`,
  );
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: `${out}/${name}`,
    omitBackground: true,
    clip: { x: 0, y: 0, width: size, height: size },
  });
  console.log("wrote", name);
}
await browser.close();
