// Helpers for a photo the user uploaded (JPEG or PNG), using Windows' System.Drawing.
import { spawn } from "node:child_process";

function powershell(script) {
  return new Promise((resolve, reject) => {
    const p = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      windowsHide: true,
    });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) =>
      code === 0 ? resolve(out.trim()) : reject(new Error(`photo step failed: ${err.slice(-400)}`)),
    );
  });
}

const quote = (path) => `'${String(path).replace(/'/g, "''")}'`;

/** Width and height of an image file. */
export async function photoSize(file) {
  const out = await powershell(
    `Add-Type -AssemblyName System.Drawing; $i=[System.Drawing.Image]::FromFile(${quote(file)}); "$($i.Width) $($i.Height)"; $i.Dispose()`,
  );
  const [width, height] = out.split(/\s+/).map(Number);
  if (!width || !height) throw new Error("could not read the photo");
  return { width, height };
}

/** Size near `area` pixels with the photo's shape, both sides multiples of `step`. */
export function sizeFor({ width, height }, area, step = 64) {
  const scale = Math.sqrt(area / (width * height));
  const round = (n) => Math.max(step * 4, Math.round((n * scale) / step) * step);
  return { width: round(width), height: round(height) };
}

/** Crops the photo's centre to the target shape and resizes it to exactly width x height. */
export async function fitPhoto(file, out, width, height) {
  const format = /\.png$/i.test(out) ? "Png" : "Jpeg";
  await powershell(
    `Add-Type -AssemblyName System.Drawing; $i=[System.Drawing.Image]::FromFile(${quote(file)});` +
      // Respect the camera's EXIF orientation so portrait photos stay upright.
      `if ($i.PropertyIdList -contains 274) { $o=$i.GetPropertyItem(274).Value[0];` +
      ` $r=@{3='Rotate180FlipNone';6='Rotate90FlipNone';8='Rotate270FlipNone'}[[int]$o]; if ($r) { $i.RotateFlip($r) } }` +
      `$tw=${width}; $th=${height}; $s=[Math]::Max($tw/$i.Width, $th/$i.Height);` +
      `$cw=$tw/$s; $ch=$th/$s; $cx=($i.Width-$cw)/2; $cy=($i.Height-$ch)/2;` +
      `$b=New-Object System.Drawing.Bitmap $tw,$th; $g=[System.Drawing.Graphics]::FromImage($b);` +
      `$g.InterpolationMode='HighQualityBicubic'; $g.PixelOffsetMode='HighQuality';` +
      `$g.DrawImage($i,(New-Object System.Drawing.RectangleF 0,0,$tw,$th),(New-Object System.Drawing.RectangleF $cx,$cy,$cw,$ch),[System.Drawing.GraphicsUnit]::Pixel);` +
      `$b.Save(${quote(out)},[System.Drawing.Imaging.ImageFormat]::${format}); $g.Dispose(); $b.Dispose(); $i.Dispose()`,
  );
  return out;
}

/** The photo's size after EXIF rotation. */
export async function uprightSize(file) {
  const { width, height } = await photoSize(file);
  const out = await powershell(
    `Add-Type -AssemblyName System.Drawing; $i=[System.Drawing.Image]::FromFile(${quote(file)});` +
      `if ($i.PropertyIdList -contains 274) { $i.GetPropertyItem(274).Value[0] } else { 1 }; $i.Dispose()`,
  );
  return [5, 6, 7, 8].includes(Number(out)) ? { width: height, height: width } : { width, height };
}
