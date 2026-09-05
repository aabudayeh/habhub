import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import pngjs from "pngjs";
import imageSizePackage from "image-size";

const { PNG } = pngjs;
const imageSize = imageSizePackage.imageSize ?? imageSizePackage;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const exportsRoot = path.join(repoRoot, "store", "exports");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function absolute(relativePath) {
  return path.join(repoRoot, relativePath);
}

function pngMetadata(relativePath, width, height) {
  const filePath = absolute(relativePath);
  assert(fs.existsSync(filePath), `Missing PNG: ${relativePath}`);
  const bytes = fs.readFileSync(filePath);
  const image = PNG.sync.read(bytes);
  assert(image.width === width && image.height === height, `${relativePath} must be ${width}x${height}; got ${image.width}x${image.height}.`);
  assert(image.colorType === 2 && image.data.length === width * height * 4, `${relativePath} must decode as a flattened RGB PNG without alpha.`);
  assert(bytes.length > 20_000, `${relativePath} appears unexpectedly small or blank.`);
  return {
    path: relativePath.replaceAll("\\", "/"),
    width: image.width,
    height: image.height,
    bytes: bytes.length,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
  };
}

function sourceImageMetadata(relativePath, width, height) {
  const filePath = absolute(relativePath);
  assert(fs.existsSync(filePath), `Missing source image: ${relativePath}`);
  const bytes = fs.readFileSync(filePath);
  const image = imageSize(bytes);
  assert(image.type === "jpg", `${relativePath} must be a JPEG capture; got ${image.type ?? "unknown"}.`);
  assert(image.width === width && image.height === height, `${relativePath} must be ${width}x${height}; got ${image.width}x${image.height}.`);
  assert(bytes.length > 20_000, `${relativePath} appears unexpectedly small or blank.`);
  return {
    path: relativePath.replaceAll("\\", "/"),
    type: "jpeg",
    width: image.width,
    height: image.height,
    bytes: bytes.length,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
  };
}

function findFfmpeg() {
  const candidates = [
    process.env.HABHUB_FFMPEG,
    "ffmpeg",
    "C:\\Program Files\\Lenovo\\LegionSpace\\1.9.11.6\\gamingai\\services\\editor\\ffmpeg.exe",
  ].filter(Boolean);
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ["-version"], { encoding: "utf8" });
    if (!result.error && result.status === 0) return candidate;
  }
  throw new Error("ffmpeg was not found. Set HABHUB_FFMPEG before validating videos.");
}

function parseDuration(metadata) {
  const match = metadata.match(/Duration:\s*(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/);
  assert(match, "ffmpeg did not report an MP4 duration.");
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

function videoMetadata(ffmpeg, relativePath, minimumDuration, maximumDuration) {
  const filePath = absolute(relativePath);
  assert(fs.existsSync(filePath), `Missing MP4: ${relativePath}`);
  const probe = spawnSync(ffmpeg, ["-hide_banner", "-i", filePath], {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  const metadata = `${probe.stdout ?? ""}\n${probe.stderr ?? ""}`;
  assert(/Video:\s*h264\b/i.test(metadata), `${relativePath} must contain H.264 video.`);
  assert(/1080x1920/.test(metadata), `${relativePath} must be 1080x1920.`);
  assert(/Audio:\s*aac\b/i.test(metadata), `${relativePath} must contain an AAC audio track.`);
  const duration = parseDuration(metadata);
  assert(duration >= minimumDuration && duration <= maximumDuration, `${relativePath} duration ${duration}s must be ${minimumDuration}-${maximumDuration}s.`);

  const decode = spawnSync(ffmpeg, ["-v", "error", "-i", filePath, "-f", "null", "-"], {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  assert(decode.status === 0, `${relativePath} did not decode cleanly: ${decode.stderr}`);
  const bytes = fs.readFileSync(filePath);
  return {
    path: relativePath.replaceAll("\\", "/"),
    codec: "h264",
    audioCodec: "aac",
    width: 1080,
    height: 1920,
    durationSeconds: duration,
    bytes: bytes.length,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
  };
}

const rawNames = [
  "01-today.jpg",
  "02-tracker-history.jpg",
  "03-progress-grid.jpg",
  "04-photo-collage.jpg",
  "04-photo-timeline.jpg",
  "05-workout.jpg",
  "06-badges.jpg",
  "07-schedule.jpg",
  "07-journal.jpg",
  "08-status-avatar.jpg",
  "09-chat.jpg",
  "10-leaderboard.jpg",
  "11-challenges.jpg",
];
const appleNames = [
  "01-today-personalized.png",
  "02-tracker-history.png",
  "03-progress-grid.png",
  "04-photo-collage.png",
  "05-workout.png",
  "06-leaderboard.png",
  "07-challenges.png",
  "08-schedule.png",
  "09-journal.png",
  "10-group-chat.png",
];
const googleNames = appleNames.slice(0, 8);

const sourceImages = rawNames.map((name) => sourceImageMetadata(`store/source-captures/iphone-420x911/${name}`, 420, 911));
const pngs = [
  ...appleNames.map((name) => pngMetadata(`store/exports/apple/iphone-6.9/en-US/${name}`, 1260, 2736)),
  ...googleNames.map((name) => pngMetadata(`store/exports/google/phone/en-US/${name}`, 1080, 1920)),
  pngMetadata("store/exports/google/feature-graphic/en-US/habhub-feature-graphic-1024x500.png", 1024, 500),
];

const ffmpeg = findFfmpeg();
const videos = [
  videoMetadata(ffmpeg, "store/exports/video/apple/en-US/habhub-apple-master-1080x1920.mp4", 20, 30),
  videoMetadata(ffmpeg, "store/exports/video/google/en-US/habhub-google-master-1080x1920.mp4", 30, 60),
];

const manifest = {
  generatedAt: new Date().toISOString(),
  provenance: "Compositions use real HabHub web UI captured from the deterministic synthetic demo. No feature UI was invented.",
  disclaimers: [
    "Progress photos and all names/data are synthetic demo content.",
    "Android-only widgets and native photo-video export are intentionally excluded pending signed-device verification.",
  ],
  sourceImages,
  pngs,
  videos,
};
fs.mkdirSync(exportsRoot, { recursive: true });
fs.writeFileSync(path.join(exportsRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Validated ${sourceImages.length} JPEG source captures, ${pngs.length} PNG deliverables, and ${videos.length} H.264 MP4 masters.`);
console.log(`Manifest: ${path.join(exportsRoot, "manifest.json")}`);
