import { Buffer } from "node:buffer";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const exportsRoot = path.join(repoRoot, "store", "exports");
const outputDirectory = path.join(
  exportsRoot,
  "video",
  "interactive-guide",
  "en-US",
);
const outputPath = path.join(
  outputDirectory,
  "habhub-full-interactive-guide-1080x1920.mp4",
);
const profileDirectory = path.join(
  os.tmpdir(),
  "habhub-interactive-guide-edge-profile",
);
const baseUrl = (
  process.env.HABHUB_CAPTURE_URL ?? "http://127.0.0.1:8081"
).replace(/\/$/, "");
const edgePath =
  process.env.HABHUB_EDGE_PATH ??
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const debugPort = Number(process.env.HABHUB_INTERACTIVE_CAPTURE_PORT ?? 9331);
const maximumCaptureMs = Number(
  process.env.HABHUB_INTERACTIVE_CAPTURE_TIMEOUT_MS ?? 15 * 60_000,
);
const captureFramesPerSecond = 12;
const captureWidth = 720;
const captureHeight = 1280;
const outputWidth = 1080;
const outputHeight = 1920;
const guideButtonLabel = "Watch Complete HabHub guide";
const finalGuideStepMarker = "Save into the tutorial preview";
const continuityProbe = process.argv.includes("--probe-today");

const tutorialPageIds = [
  "today",
  "status",
  "leaderboard",
  "group-recap",
  "group-schedule",
  "group-notes",
  "log",
  "progress",
  "workout",
  "chat",
  "schedule",
  "journal",
  "performance",
  "metric-detail",
  "todo",
  "group-todo",
  "food",
  "timer",
  "menu",
  "customize",
  "metric-editor",
  "settings",
  "notifications",
  "display",
  "challenges",
  "badges",
  "groups",
  "create-group",
  "leaderboard-detail",
  "daily-detail",
  "comparison",
  "quick-guide",
  "profile",
  "group-settings",
  "gym-exercise",
  "timers",
  "recap-feed",
  "alerts",
  "note-editor",
  "reminder-editor",
  "view-filters",
  "vacation",
  "safety",
  "legal-support",
];

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function assertInside(child, parent, label) {
  const normalizedChild = path.resolve(child).toLowerCase();
  const normalizedParent = `${path.resolve(parent).toLowerCase()}${path.sep}`;
  if (!normalizedChild.startsWith(normalizedParent))
    throw new Error(`Refusing ${label} outside ${parent}: ${child}`);
}

function executableWorks(candidate) {
  if (!candidate) return false;
  const result = spawnSync(candidate, ["-version"], {
    encoding: "utf8",
    windowsHide: true,
  });
  return !result.error && result.status === 0;
}

function resolveFfmpeg() {
  const candidates = [
    process.env.HABHUB_FFMPEG,
    "ffmpeg",
    "C:\\Program Files\\Lenovo\\LegionSpace\\1.9.11.6\\gamingai\\services\\editor\\ffmpeg.exe",
  ].filter(Boolean);
  const ffmpeg = candidates.find(executableWorks);
  if (!ffmpeg)
    throw new Error(
      "ffmpeg was not found. Set HABHUB_FFMPEG to an FFmpeg 6+ executable.",
    );
  return ffmpeg;
}

async function waitForJson(url, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch (error) {
      lastError = error;
    }
    await delay(150);
  }
  throw new Error(
    `Edge debugging endpoint did not open: ${lastError ?? url}`,
  );
}

class CdpClient {
  constructor(url) {
    this.url = url;
    this.sequence = 0;
    this.pending = new Map();
    this.listeners = new Map();
  }

  async connect() {
    this.socket = new WebSocket(this.url);
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
        return;
      }
      for (const listener of this.listeners.get(message.method) ?? [])
        listener(message.params);
    });
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
  }

  send(method, params = {}) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, listener) {
    const current = this.listeners.get(method) ?? new Set();
    current.add(listener);
    this.listeners.set(method, current);
    return () => current.delete(listener);
  }

  close() {
    this.socket?.close();
  }
}

async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails)
    throw new Error(
      result.exceptionDetails.exception?.description ??
        "Browser evaluation failed",
    );
  return result.result?.value;
}

async function waitForText(client, text, timeout = 25_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const found = await evaluate(
      client,
      `Boolean(document.body?.innerText?.toLocaleLowerCase().includes(${JSON.stringify(
        text.toLocaleLowerCase(),
      )}))`,
    );
    if (found) return;
    await delay(250);
  }
  const visible = await evaluate(
    client,
    "document.body?.innerText?.slice(0, 1200) ?? ''",
  );
  throw new Error(
    `Timed out waiting for ${JSON.stringify(text)}. Visible text: ${visible}`,
  );
}

async function navigate(client, route) {
  await client.send("Page.navigate", { url: `${baseUrl}${route}` });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const ready = await evaluate(
      client,
      "document.readyState === 'complete' && Boolean(document.body?.innerText?.trim())",
    ).catch(() => false);
    if (ready) return;
    await delay(250);
  }
  throw new Error(`Timed out loading ${route}`);
}

async function activateFullGuide(client) {
  const center = await evaluate(
    client,
    `(async () => {
      const label = ${JSON.stringify(guideButtonLabel)};
      const button = document.querySelector('[aria-label="' + CSS.escape(label) + '"]');
      if (!button) return undefined;
      button.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
      await new Promise((resolve) => setTimeout(resolve, 900));
      const rect = button.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`,
  );
  if (!center)
    throw new Error(`Could not find the ${guideButtonLabel} control.`);
  await client.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: center.x,
    y: center.y,
  });
  await delay(180);
  await client.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: center.x,
    y: center.y,
    button: "left",
    clickCount: 1,
  });
  await delay(140);
  await client.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: center.x,
    y: center.y,
    button: "left",
    clickCount: 1,
  });
}

function writeConcatFile(frames, stoppedAtSeconds, destination) {
  const minimumFrameDuration = 1 / 30;
  const lines = ["ffconcat version 1.0"];
  for (let index = 0; index < frames.length; index += 1) {
    const current = frames[index];
    const nextTime = frames[index + 1]?.capturedAtSeconds ?? stoppedAtSeconds;
    const duration = Math.max(minimumFrameDuration, nextTime - current.capturedAtSeconds);
    const normalizedPath = current.path.replaceAll("\\", "/").replaceAll("'", "'\\''");
    lines.push(`file '${normalizedPath}'`);
    lines.push(`duration ${duration.toFixed(6)}`);
  }
  const finalPath = frames.at(-1).path.replaceAll("\\", "/").replaceAll("'", "'\\''");
  lines.push(`file '${finalPath}'`);
  fs.writeFileSync(destination, `${lines.join("\n")}\n`);
}

function availableH264Encoders(ffmpeg) {
  const result = spawnSync(ffmpeg, ["-hide_banner", "-encoders"], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  return ["h264_nvenc", "h264_qsv", "h264_amf", "libx264", "h264_mf"].filter(
    (encoder) => new RegExp(`\\b${encoder}\\b`).test(output),
  );
}

function encodeGuide(ffmpeg, concatPath, durationSeconds) {
  const encoders = availableH264Encoders(ffmpeg);
  if (!encoders.length)
    throw new Error(`No supported H.264 encoder was found in ${ffmpeg}.`);
  const durationText = durationSeconds.toFixed(3);
  let lastError = "";
  for (const encoder of encoders) {
    console.log(`Encoding with ${encoder}...`);
    const result = spawnSync(
      ffmpeg,
      [
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        concatPath,
        "-f",
        "lavfi",
        "-t",
        durationText,
        "-i",
        "anullsrc=r=48000:cl=stereo",
        "-filter_complex",
        `[0:v]fps=30,scale=${outputWidth}:${outputHeight}:flags=lanczos,setsar=1,format=yuv420p[vout]`,
        "-map",
        "[vout]",
        "-map",
        "1:a",
        "-t",
        durationText,
        "-c:v",
        encoder,
        "-b:v",
        "5M",
        "-maxrate",
        "8M",
        "-bufsize",
        "10M",
        "-profile:v",
        "high",
        "-pix_fmt",
        "yuv420p",
        "-r",
        "30",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-ar",
        "48000",
        "-movflags",
        "+faststart",
        outputPath,
      ],
      {
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true,
      },
    );
    if (result.status === 0) return encoder;
    lastError = `${result.stdout ?? ""}\n${result.stderr ?? ""}`
      .trim()
      .split(/\r?\n/)
      .slice(-12)
      .join("\n");
  }
  throw new Error(`All available H.264 encoders failed.\n${lastError}`);
}

if (!Number.isFinite(debugPort) || debugPort < 1 || debugPort > 65_535)
  throw new Error(`Invalid HABHUB_INTERACTIVE_CAPTURE_PORT: ${debugPort}`);
if (!Number.isFinite(maximumCaptureMs) || maximumCaptureMs < 60_000)
  throw new Error(
    `Invalid HABHUB_INTERACTIVE_CAPTURE_TIMEOUT_MS: ${maximumCaptureMs}`,
  );
if (!fs.existsSync(edgePath))
  throw new Error(`Microsoft Edge was not found: ${edgePath}`);
await fetch(baseUrl).catch((error) => {
  throw new Error(`HabHub web must already be running at ${baseUrl}: ${error.message}`);
});

assertInside(profileDirectory, os.tmpdir(), "capture-profile cleanup");
assertInside(outputDirectory, exportsRoot, "interactive-guide output");
fs.rmSync(profileDirectory, {
  recursive: true,
  force: true,
  maxRetries: 8,
  retryDelay: 250,
});
fs.mkdirSync(profileDirectory, { recursive: true });
fs.mkdirSync(outputDirectory, { recursive: true });

const temporaryRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "habhub-interactive-guide-"),
);
const framesDirectory = path.join(temporaryRoot, "frames");
const concatPath = path.join(temporaryRoot, "frames.ffconcat");
fs.mkdirSync(framesDirectory, { recursive: true });

const edge = spawn(
  edgePath,
  [
    "--headless=new",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-sync",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profileDirectory}`,
    "about:blank",
  ],
  { stdio: "ignore", windowsHide: true },
);

let client;
let removeFrameListener;
let captureStartedAtSeconds = 0;
let captureStoppedAtSeconds = 0;
let acceptingFrames = false;
let frameError;
const frames = [];
let lastStoredAtSeconds = Number.NEGATIVE_INFINITY;

try {
  const pages = await waitForJson(`http://127.0.0.1:${debugPort}/json/list`);
  const page = pages.find((item) => item.type === "page");
  if (!page?.webSocketDebuggerUrl)
    throw new Error("Edge did not expose a page target.");
  client = new CdpClient(page.webSocketDebuggerUrl);
  await client.connect();
  await Promise.all([
    client.send("Page.enable"),
    client.send("Runtime.enable"),
    client.send("Network.enable"),
  ]);
  await client.send("Page.bringToFront");
  await client.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await client.send("Emulation.setDeviceMetricsOverride", {
    width: 360,
    height: 640,
    deviceScaleFactor: 2,
    mobile: false,
    screenWidth: 360,
    screenHeight: 640,
  });
  await client.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "no-preference" }],
  });

  const bootstrap = `(() => {
    if (!location.origin.startsWith('http://127.0.0.1') && !location.origin.startsWith('http://localhost')) return;
    localStorage.setItem('paceboard-explicit-demo-mode-v1', 'true');
    localStorage.setItem('metric-rally-onboarding-complete-v1:demo:ahmad', JSON.stringify({ completed: true, version: 4, completedAt: '2026-09-08T09:00:00.000Z' }));
    localStorage.setItem('metric-rally-tutorial-first-visits-v1:demo%3Aahmad', JSON.stringify({ pageIds: ${JSON.stringify(tutorialPageIds)}, updatedAt: '2026-09-08T09:00:00.000Z' }));
    localStorage.setItem('metric-rally-tutorial-first-visits-v1:ahmad', JSON.stringify({ pageIds: ${JSON.stringify(tutorialPageIds)}, updatedAt: '2026-09-08T09:00:00.000Z' }));
  })();`;
  await client.send("Page.addScriptToEvaluateOnNewDocument", {
    source: bootstrap,
  });
  await navigate(client, "/quick-guide");
  await waitForText(client, "Complete HabHub guide");
  await evaluate(
    client,
    `Promise.race([
      Promise.resolve(document.fonts?.ready).then(() => Promise.all([...document.images].map((image) =>
        image.complete ? undefined : new Promise((resolve) => {
          image.addEventListener('load', resolve, { once: true });
          image.addEventListener('error', resolve, { once: true });
        })
      ))),
      new Promise((resolve) => setTimeout(resolve, 3500)),
    ])`,
  );

  if (!continuityProbe) {
    removeFrameListener = client.on("Page.screencastFrame", (frame) => {
      void client
        .send("Page.screencastFrameAck", { sessionId: frame.sessionId })
        .catch(() => undefined);
      if (!acceptingFrames || frameError) return;
      const capturedAtSeconds = performance.now() / 1000;
      if (
        frames.length &&
        capturedAtSeconds - lastStoredAtSeconds < 1 / captureFramesPerSecond
      )
        return;
      try {
        const framePath = path.join(
          framesDirectory,
          `frame-${String(frames.length + 1).padStart(6, "0")}.jpg`,
        );
        fs.writeFileSync(framePath, Buffer.from(frame.data, "base64"));
        frames.push({ path: framePath, capturedAtSeconds });
        lastStoredAtSeconds = capturedAtSeconds;
      } catch (error) {
        frameError = error;
      }
    });

    captureStartedAtSeconds = performance.now() / 1000;
    acceptingFrames = true;
    await client.send("Page.startScreencast", {
      format: "jpeg",
      quality: 88,
      maxWidth: captureWidth,
      maxHeight: captureHeight,
      everyNthFrame: 1,
    });
  }
  await delay(1_000);
  await activateFullGuide(client);
  await waitForText(client, "Auto-playing this tour", 30_000);
  console.log(
    continuityProbe
      ? "Full Watch guide started; probing the Today route boundary..."
      : "Full Watch guide started; recording real UI transitions...",
  );

  const deadline =
    Date.now() +
    (continuityProbe ? Math.min(maximumCaptureMs, 180_000) : maximumCaptureMs);
  const observedRoutes = [];
  let lastStepText = "";
  let lastStepChangedAt = Date.now();
  let calloutMissingSince;
  let lingeringChallengeEditorSince;
  let probeComplete = false;
  let finalStepObserved = false;
  let completionObservedAt;
  while (Date.now() < deadline) {
    await delay(500);
    if (frameError) throw frameError;
    const playback = await evaluate(
      client,
      `(() => {
        const callout = document.querySelector('[data-testid="tutorial-callout"]');
        const text = (callout?.innerText || '').trim().replace(/\\s+/g, ' ');
        const challengeClose = document.querySelector('[aria-label="Close challenge editor"]');
        const challengeRect = challengeClose?.getBoundingClientRect();
        const challengeStyle = challengeClose ? getComputedStyle(challengeClose) : undefined;
        const challengeEditorVisible = Boolean(
          challengeClose &&
          challengeRect &&
          challengeRect.width > 0 &&
          challengeRect.height > 0 &&
          challengeStyle?.display !== 'none' &&
          challengeStyle?.visibility !== 'hidden'
        );
        return { text, href: location.href, challengeEditorVisible };
      })()`,
    );
    const currentUrl = new URL(playback.href);
    const currentRoute = `${currentUrl.pathname}${currentUrl.search}`;
    if (observedRoutes.at(-1) !== currentRoute) {
      observedRoutes.push(currentRoute);
      console.log(`Route: ${currentRoute}`);
    }
    if (
      playback.challengeEditorVisible &&
      currentUrl.pathname !== "/group"
    ) {
      lingeringChallengeEditorSince ??= Date.now();
      if (Date.now() - lingeringChallengeEditorSince >= 5_000)
        throw new Error(
          `Challenge editor remained visible after its tutorial lesson at ${currentRoute}.`,
        );
    } else lingeringChallengeEditorSince = undefined;
    if (playback.text) {
      calloutMissingSince = undefined;
      if (playback.text.includes(finalGuideStepMarker))
        finalStepObserved = true;
      if (playback.text !== lastStepText) {
        lastStepText = playback.text;
        lastStepChangedAt = Date.now();
        console.log(
          `${currentUrl.pathname} · ${playback.text.slice(0, 150)}`,
        );
      } else if (Date.now() - lastStepChangedAt > 60_000) {
        throw new Error(
          `Watch guide stalled for more than 60 seconds: ${playback.text.slice(0, 300)}`,
        );
      }
      if (
        continuityProbe &&
        currentUrl.pathname === "/status" &&
        playback.text.includes("Status") &&
        playback.text.includes("Step 1 of")
      ) {
        probeComplete = true;
        break;
      }
    } else {
      calloutMissingSince ??= Date.now();
      if (
        finalStepObserved &&
        Date.now() - calloutMissingSince >= 2_000
      ) {
        completionObservedAt = Date.now();
        break;
      }
      if (
        !finalStepObserved &&
        Date.now() - calloutMissingSince >= 45_000
      ) {
        const diagnostics = await evaluate(
          client,
          `(() => {
            const activeKey = Object.keys(localStorage).find((key) =>
              key.startsWith('metric-rally-active-tutorial-v1:')
            );
            return {
              href: location.href,
              activeTutorial: activeKey ? localStorage.getItem(activeKey) : null,
              visibleText: (document.body?.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 1200),
            };
          })()`,
        );
        throw new Error(
          `Watch guide disappeared for 45 seconds before the final step was observed. ${JSON.stringify(diagnostics)}`,
        );
      }
    }
  }
  if (continuityProbe) {
    const viewFilterIndex = observedRoutes.findIndex((route) =>
      route.startsWith("/view-filters"),
    );
    const todayReturnIndex = observedRoutes.findIndex(
      (route, index) => index > viewFilterIndex && route === "/",
    );
    const statusIndex = observedRoutes.findIndex(
      (route, index) => index > todayReturnIndex && route === "/status",
    );
    if (
      !probeComplete ||
      viewFilterIndex < 0 ||
      todayReturnIndex < 0 ||
      statusIndex < 0
    )
      throw new Error(
        `Today continuity probe failed. Observed routes: ${observedRoutes.join(" -> ")}`,
      );
    console.log(
      `Today continuity probe passed: ${observedRoutes.join(" -> ")}`,
    );
  } else if (!finalStepObserved || !completionObservedAt)
    throw new Error(
      `Full Watch guide did not finish within ${Math.round(maximumCaptureMs / 1000)} seconds.`,
    );

  if (!continuityProbe) {
    await delay(1_000);
    const finalScreenshot = await client.send("Page.captureScreenshot", {
      format: "jpeg",
      quality: 88,
      fromSurface: true,
      captureBeyondViewport: false,
    });
    const finalFramePath = path.join(
      framesDirectory,
      `frame-${String(frames.length + 1).padStart(6, "0")}.jpg`,
    );
    fs.writeFileSync(
      finalFramePath,
      Buffer.from(finalScreenshot.data, "base64"),
    );
    frames.push({
      path: finalFramePath,
      capturedAtSeconds: performance.now() / 1000,
    });
    acceptingFrames = false;
    captureStoppedAtSeconds = performance.now() / 1000;
    await client.send("Page.stopScreencast");

    if (frames.length < 300)
      throw new Error(
        `Interactive capture produced only ${frames.length} frames; expected a sustained real-time screencast.`,
      );
    const durationSeconds =
      captureStoppedAtSeconds - captureStartedAtSeconds;
    if (durationSeconds < 180)
      throw new Error(
        `Interactive capture was only ${durationSeconds.toFixed(1)} seconds; the complete guide did not run.`,
      );

    writeConcatFile(frames, captureStoppedAtSeconds, concatPath);
    const ffmpeg = resolveFfmpeg();
    const encoder = encodeGuide(ffmpeg, concatPath, durationSeconds);
    console.log(
      `Created ${outputPath} from ${frames.length} live CDP screencast frames (${durationSeconds.toFixed(1)}s, ${encoder}).`,
    );
  }
} finally {
  acceptingFrames = false;
  removeFrameListener?.();
  if (client) {
    await client.send("Page.stopScreencast").catch(() => undefined);
    await client.send("Browser.close").catch(() => undefined);
    await delay(350);
    client.close();
  }
  edge.kill();
  if (!process.argv.includes("--keep-frames"))
    fs.rmSync(temporaryRoot, {
      recursive: true,
      force: true,
      maxRetries: 8,
      retryDelay: 250,
    });
  else console.log(`Kept capture frames at ${temporaryRoot}`);
}
