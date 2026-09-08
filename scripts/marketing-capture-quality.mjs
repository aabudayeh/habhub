import { spawnSync } from "node:child_process";
import process from "node:process";
import imageSizePackage from "image-size";

const imageSize = imageSizePackage.imageSize ?? imageSizePackage;
let ffmpegPath;

function findFfmpeg() {
  if (ffmpegPath) return ffmpegPath;
  for (const candidate of [
    process.env.HABHUB_FFMPEG,
    "ffmpeg",
    "C:\\Program Files\\Lenovo\\LegionSpace\\1.9.11.6\\gamingai\\services\\editor\\ffmpeg.exe",
  ].filter(Boolean)) {
    const probe = spawnSync(candidate, ["-version"], {
      windowsHide: true,
      timeout: 10_000,
      encoding: "utf8",
    });
    if (!probe.error && probe.status === 0) {
      ffmpegPath = candidate;
      return candidate;
    }
  }
  throw new Error("Set HABHUB_FFMPEG to validate screenshot pixels.");
}

/** Reject the valid-JPEG but blank compositor frames Edge can occasionally emit. */
export function assertMarketingCapture(bytes, label) {
  const dimensions = imageSize(bytes);
  if (dimensions.type !== "jpg" || dimensions.width !== 840 || dimensions.height !== 1822)
    throw new Error(`${label}: expected an 840x1822 JPEG capture.`);
  if (bytes.length <= 20_000)
    throw new Error(`${label}: screenshot is suspiciously small (${bytes.length} bytes).`);

  // Downsampling makes this a cheap content guard, not a screenshot comparison.
  // A white surface with a black rectangle has variance but very few color bins;
  // real app pages have text, antialiasing, neutral cards and accent colors.
  const decoded = spawnSync(findFfmpeg(), [
    "-v", "error", "-i", "pipe:0", "-frames:v", "1",
    "-vf", "scale=80:174:flags=area", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1",
  ], { input: bytes, windowsHide: true, timeout: 15_000, maxBuffer: 256 * 1024 });
  if (decoded.error || decoded.status !== 0 || decoded.stdout?.length !== 80 * 174 * 3)
    throw new Error(`${label}: screenshot pixels could not be decoded.`);
  const bins = new Map();
  for (let index = 0; index < decoded.stdout.length; index += 3) {
    const key = ((decoded.stdout[index] >> 5) << 6) |
      ((decoded.stdout[index + 1] >> 5) << 3) | (decoded.stdout[index + 2] >> 5);
    bins.set(key, (bins.get(key) ?? 0) + 1);
  }
  const dominantFraction = Math.max(...bins.values()) / (80 * 174);
  if (bins.size < 16 || dominantFraction > 0.94)
    throw new Error(`${label}: likely blank screenshot (${bins.size} color bins, ${(dominantFraction * 100).toFixed(1)}% dominant color).`);
  return { colorBins: bins.size, dominantFraction };
}
