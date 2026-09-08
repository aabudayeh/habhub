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
const capturePlan = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "store", "capture-plan.json"), "utf8"),
);
const buildSource = fs.readFileSync(
  path.join(repoRoot, "scripts", "build-store-marketing-assets.ps1"),
  "utf8",
);
const captureSource = fs.readFileSync(
  path.join(repoRoot, "scripts", "capture-marketing-web.mjs"),
  "utf8",
);
const interactiveCaptureSource = fs.readFileSync(
  path.join(repoRoot, "scripts", "capture-interactive-guide-web.mjs"),
  "utf8",
);

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

function videoMetadata(ffmpeg, relativePath, width, height, minimumDuration, maximumDuration) {
  const filePath = absolute(relativePath);
  assert(fs.existsSync(filePath), `Missing MP4: ${relativePath}`);
  const probe = spawnSync(ffmpeg, ["-hide_banner", "-i", filePath], {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  const metadata = `${probe.stdout ?? ""}\n${probe.stderr ?? ""}`;
  assert(/Video:\s*h264\b/i.test(metadata), `${relativePath} must contain H.264 video.`);
  assert(new RegExp(`${width}x${height}`).test(metadata), `${relativePath} must be ${width}x${height}.`);
  assert(/Audio:\s*aac\b/i.test(metadata), `${relativePath} must contain an AAC audio track.`);
  const frameRate = Number(metadata.match(/(\d+(?:\.\d+)?)\s+fps\b/i)?.[1]);
  assert(Number.isFinite(frameRate) && frameRate <= 30, `${relativePath} frame rate ${frameRate || "unknown"} must be at most 30 fps.`);
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
    width,
    height,
    frameRate,
    durationSeconds: duration,
    bytes: bytes.length,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
  };
}

assert(capturePlan.version >= 6, "Marketing capture plan must include the live interactive-guide revision.");
assert(capturePlan.fixture?.captureScript === "scripts/capture-marketing-web.mjs", "Capture provenance must name the repeatable browser script.");
assert(capturePlan.fixture?.interactiveCaptureScript === "scripts/capture-interactive-guide-web.mjs", "Capture provenance must name the repeatable live guide script.");
assert(capturePlan.featureTourScenes?.length >= 30, "The feature tour must cover at least 30 real-screen beats.");
assert(capturePlan.deliverables?.applePreview?.size === "886x1920", "Apple preview must use the current 886x1920 portrait size.");
assert(capturePlan.deliverables?.applePreview?.maximumFrameRate <= 30, "Apple preview must be capped at 30 fps.");
assert(capturePlan.deliverables?.featureTour?.durationSeconds === 99, "Paired batch preview/staging makes the comprehensive tour 99 seconds.");
assert(capturePlan.deliverables?.featureTour?.presentation === "still-screen branded montage", "The existing feature tour must be labelled honestly as a still-screen montage.");
assert(capturePlan.deliverables?.interactiveGuide?.size === "1080x1920", "Interactive guide must be a 1080x1920 portrait master.");
assert(capturePlan.deliverables?.interactiveGuide?.format === "H.264/AAC MP4", "Interactive guide must declare H.264/AAC MP4 delivery.");
assert(capturePlan.deliverables?.interactiveGuide?.maximumFrameRate <= 30, "Interactive guide must be capped at 30 fps.");
assert(capturePlan.deliverables?.interactiveGuide?.minimumDurationSeconds >= 180, "Interactive guide must be long enough to contain the full Watch tutorial.");
assert(capturePlan.deliverables?.interactiveGuide?.maximumDurationSeconds <= 900, "Interactive guide must fail instead of recording indefinitely.");
const tourIds = capturePlan.featureTourScenes.map((scene) => scene.id);
assert(tourIds.indexOf("todo-staged") === tourIds.indexOf("todo-batch") + 1, "Batch preview and staged Sub-To-Dos must be consecutive tour beats.");
assert(buildSource.includes('Callout = "TAP STAGE"') && buildSource.includes('Callout = "REACT + COMMENT"'), "Interaction beats need branded tap callouts.");
assert(/New-FadeVideo \$tourFrames[\s\S]*-Motion/.test(buildSource), "Comprehensive tour must include subtle motion.");
assert(buildSource.includes("anullsrc"), "Captions-first masters must carry the documented silent AAC track.");
assert(captureSource.includes("HTMLTextAreaElement.prototype") && captureSource.includes("openStoryComments()"), "Marketing capture must drive real React input state and expose the recap comment composer.");
assert(interactiveCaptureSource.includes('guideButtonLabel = "Watch Complete HabHub guide"'), "Interactive capture must launch the real complete Watch guide.");
assert(interactiveCaptureSource.includes('finalGuideStepMarker = "Save into the tutorial preview"'), "Interactive capture must prove that Watch mode reaches the final full-guide step.");
assert(interactiveCaptureSource.includes('"Page.startScreencast"') && interactiveCaptureSource.includes('"Page.screencastFrameAck"'), "Interactive guide must be recorded as a live CDP screencast.");
assert(interactiveCaptureSource.includes('{ name: "prefers-reduced-motion", value: "no-preference" }'), "Interactive capture must retain real tutorial and pointer motion.");
assert(interactiveCaptureSource.includes('"Input.dispatchMouseEvent"'), "Interactive capture must use a real browser click to start Watch mode.");
assert(interactiveCaptureSource.includes('"--disable-extensions"') && interactiveCaptureSource.includes('os.tmpdir()'), "Interactive capture must isolate the clean Edge profile outside Metro's watched repository.");
assert(interactiveCaptureSource.includes('process.argv.includes("--probe-today")') && interactiveCaptureSource.includes('Today continuity probe passed'), "Interactive capture must provide a short route-continuity gate before the long recording.");
assert(interactiveCaptureSource.includes("Challenge editor remained visible after its tutorial lesson"), "Interactive capture must reject a guide obscured by the lingering Challenge editor.");
assert(
  captureSource.includes("horizontalLayout.scrollWidth > horizontalLayout.clientWidth") &&
    captureSource.includes("page overflows horizontally"),
  "Marketing capture must fail on real horizontal page overflow before normalizing capture state.",
);
assert(capturePlan.signedDeviceCaptureGates?.length >= 5, "Native-only claims need explicit signed-device capture gates.");
for (const gate of capturePlan.signedDeviceCaptureGates)
  assert(gate.status.includes("required"), `Native truth gate is not blocking unsupported promotion: ${gate.feature}`);
const coverage = new Set(capturePlan.featureTourScenes.flatMap((scene) => scene.covers));
for (const feature of [
  "Today",
  "batch to-dos",
  "staged outline",
  "tracker history",
  "line chart",
  "duplicate tracker style",
  "daily references",
  "live workout",
  "average set load",
  "grid map",
  "five synthetic progress photos",
  "custom avatar",
  "leaderboard",
  "challenges",
  "stories",
  "group schedule",
  "group notes",
  "message reactions",
  "badges",
  "notification controls",
  "display settings",
  "page tutorials",
]) assert(coverage.has(feature), `Feature-tour coverage is missing: ${feature}`);

const rawNames = [...new Set([
  ...capturePlan.storeScreenshots.map((scene) => scene.source),
  ...capturePlan.featureTourScenes.map((scene) => scene.source),
])].sort();
const appleNames = [
  "01-today-personalized.png",
  "02-tracker-history.png",
  "03-progress-grid.png",
  "04-photo-collage.png",
  "05-workout.png",
  "06-leaderboard.png",
  "07-challenges.png",
  "08-recap-social.png",
  "09-custom-tracker.png",
  "10-guided-learning.png",
];
const googleNames = appleNames.slice(0, 8);
const socialNames = [
  "01-today-1080x1350.png",
  "02-progress-1080x1350.png",
  "03-together-1080x1350.png",
  "04-custom-1080x1350.png",
];
const tourFrameNames = capturePlan.featureTourScenes.map(
  (scene, index) => `${String(index + 1).padStart(2, "0")}-${scene.id}.png`,
);

const sourceImages = rawNames.map((name) => sourceImageMetadata(`store/source-captures/iphone-420x911/${name}`, 420, 911));
const pngs = [
  ...appleNames.map((name) => pngMetadata(`store/exports/apple/iphone-6.9/en-US/${name}`, 1260, 2736)),
  ...googleNames.map((name) => pngMetadata(`store/exports/google/phone/en-US/${name}`, 1080, 1920)),
  ...socialNames.map((name) => pngMetadata(`store/exports/social/en-US/${name}`, 1080, 1350)),
  ...tourFrameNames.map((name) => pngMetadata(`store/exports/video/feature-tour/frames/en-US/${name}`, 1080, 1920)),
  pngMetadata("store/exports/google/feature-graphic/en-US/habhub-feature-graphic-1024x500.png", 1024, 500),
];

const ffmpeg = findFfmpeg();
const videos = [
  videoMetadata(ffmpeg, "store/exports/video/apple/en-US/habhub-apple-master-886x1920.mp4", 886, 1920, 20, 30),
  videoMetadata(ffmpeg, "store/exports/video/google/en-US/habhub-google-master-1080x1920.mp4", 1080, 1920, 30, 60),
  videoMetadata(ffmpeg, "store/exports/video/feature-tour/en-US/habhub-comprehensive-feature-tour-1080x1920.mp4", 1080, 1920, 98.9, 99.1),
  videoMetadata(
    ffmpeg,
    capturePlan.deliverables.interactiveGuide.path,
    1080,
    1920,
    capturePlan.deliverables.interactiveGuide.minimumDurationSeconds,
    capturePlan.deliverables.interactiveGuide.maximumDurationSeconds,
  ),
];

const manifest = {
  generatedAt: new Date().toISOString(),
  capturePlanVersion: capturePlan.version,
  provenance: "Still compositions and the continuous interactive guide use real release-candidate HabHub web UI captured from a fresh credential-free synthetic demo. No feature UI was invented.",
  presentation: {
    storePreviewAndAds: "still-screen branded compositions built from auditable real-app captures",
    featureTourMotion: "subtle centered zoom",
    interactionCallouts: true,
    interactiveGuide: "continuous live Edge/CDP capture of the real Watch tutorial, with real route transitions, animated pointer, and isolated practice actions",
    audio: "captions-first master with an intentionally silent AAC track; no music or voiceover license is implied",
    pairedDemonstrations: ["batch outline preview -> staged nested Sub-To-Dos"],
  },
  disclaimers: [
    "Progress photos and all names/data are synthetic demo content.",
    "Android-only widgets and native photo-video export are intentionally excluded pending signed-device verification.",
    "Background health import and operating-system notification delivery are excluded pending signed-device verification.",
  ],
  sourceImages,
  pngs,
  videos,
};
fs.mkdirSync(exportsRoot, { recursive: true });
fs.writeFileSync(path.join(exportsRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Validated ${sourceImages.length} JPEG source captures, ${pngs.length} PNG deliverables, and ${videos.length} H.264/AAC MP4 masters.`);
console.log(`Manifest: ${path.join(exportsRoot, "manifest.json")}`);
