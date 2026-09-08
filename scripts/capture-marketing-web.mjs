import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";
import { assertMarketingCapture } from "./marketing-capture-quality.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const exportsRoot = path.join(repoRoot, "store", "exports");
const promote = process.argv.includes("--promote");
const promoteReviewed = process.argv.includes("--promote-reviewed");
const fromFile = process.argv.find((argument) => argument.startsWith("--from="))?.slice(7);
const onlyFiles = process.argv
  .find((argument) => argument.startsWith("--only="))
  ?.slice(7)
  .split(",")
  .filter(Boolean);
const outputDirectory = promote
  ? path.join(repoRoot, "store", "source-captures", "iphone-420x911")
  : path.join(exportsRoot, "capture-candidates", "web-420x911");
const profileDirectory = path.join(exportsRoot, ".marketing-capture-profile");
const baseUrl = (process.env.HABHUB_CAPTURE_URL ?? "http://127.0.0.1:8081").replace(/\/$/, "");
const edgePath = process.env.HABHUB_EDGE_PATH ??
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const port = Number(process.env.HABHUB_CAPTURE_DEBUG_PORT ?? 9328);

const pageIds = [
  "status", "leaderboard", "group-recap", "group-schedule", "group-notes",
  "log", "progress", "workout", "chat", "schedule", "journal", "performance",
  "metric-detail", "todo", "group-todo", "food", "timer", "menu", "customize",
  "metric-editor", "settings", "notifications", "display", "challenges", "badges",
  "groups", "create-group", "leaderboard-detail", "daily-detail", "comparison",
];

const scenes = [
  { file: "01-today.jpg", route: "/", ready: "Hi," },
  { file: "02-tracker-history.jpg", route: "/metric-detail?metric=steps&period=month", ready: "Steps" },
  {
    file: "03-progress-grid.jpg",
    route: "/insights",
    ready: "Progress",
    action: `(async () => { ${clickText("Grid map")}; await new Promise(resolve => setTimeout(resolve, 700)); ${clickLabel("Show grid controls")}; await new Promise(resolve => setTimeout(resolve, 250)); return ${clickLabel("Showing week. Tap to change range")}; })()`,
  },
  {
    file: "04-photo-timeline.jpg",
    route: "/metric-detail?metric=progress_photo",
    ready: "Photo timeline",
    action: scrollTextIntoView("Photo timeline"),
  },
  {
    file: "04-photo-collage.jpg",
    route: "/metric-detail?metric=progress_photo",
    ready: "Create photo collage",
    action: openPhotoCollage(),
    after: "Photos in collage",
  },
  { file: "05-workout.jpg", route: "/gym", ready: "Workout" },
  { file: "06-badges.jpg", route: "/badges", ready: "Badge" },
  { file: "07-schedule.jpg", route: "/calendar", ready: "Schedule" },
  { file: "07-journal.jpg", route: "/journal", ready: "Journal" },
  {
    file: "08-status-avatar.jpg",
    route: "/",
    ready: "Hi,",
    action: clickHref("/status"),
    after: "Yesterday",
  },
  { file: "09-chat.jpg", route: "/chat", ready: "Chat" },
  {
    file: "10-leaderboard.jpg",
    route: "/group",
    ready: "Leaderboard",
    action: clickText("Dismiss"),
    after: "Overall score",
    actionDelayMs: 1800,
    actionOptional: true,
  },
  {
    file: "11-challenges.jpg", route: "/challenges", ready: "Challenge",
    action: clickLabel("Open 7-day step showdown"), after: "Share to Chat",
  },
  { file: "12-quick-guide.jpg", route: "/quick-guide", ready: "Guided tutorials" },
  {
    file: "13-today-edit.jpg",
    route: "/",
    ready: "Your day",
    action: clickLabel("Customize Today"),
    after: "Done",
  },
  {
    file: "14-todo-batch.jpg",
    route: "/todo-editor",
    ready: "New to-do",
    action: fillTodoBatchOutline(false),
    after: "8/75 to-dos",
  },
  {
    file: "14-todo-staged.jpg",
    route: "/todo-editor",
    ready: "New to-do",
    action: fillTodoBatchOutline(true),
    after: "8 staged",
  },
  { file: "15-custom-tracker.jpg", route: "/metric-editor?id=water&duplicate=1", ready: "Duplicate Water", action: fillStudyTracker() },
  {
    file: "16-food-nutrition.jpg", route: "/metric-detail?metric=food", ready: "Nutrition",
    action: `(async () => { ${clickLabel("Nutrition")}; await new Promise(resolve => setTimeout(resolve, 450)); return ${scrollTextIntoView("Nutrition")}; })()`,
    after: "Macro calorie share",
  },
  { file: "17-workout-timer.jpg", route: "/timer?metric=workout_duration", ready: "Also save to Workout" },
  { file: "18-exercise-progress.jpg", route: "/gym-exercise?key=back_squat", ready: "Avg set load" },
  {
    file: "19-recap-social.jpg",
    route: "/recap?scope=group",
    ready: "Group recap",
    action: openStoryComments(),
  },
  { file: "20-group-schedule.jpg", route: "/group-schedule", ready: "Group Schedule" },
  { file: "21-group-notes.jpg", route: "/group-notes", ready: "Group Notes" },
  { file: "22-notifications.jpg", route: "/notifications", ready: "Notifications" },
  { file: "23-display-settings.jpg", route: "/display-settings", ready: "Display" },
  {
    file: "24-profile-behavior.jpg", route: "/profile", ready: "My profile",
    action: `(async () => { ${clickLabel("Expand Food & step calculations")}; await new Promise(resolve => setTimeout(resolve, 350)); return ${scrollTextIntoView("Food & step calculations")}; })()`,
    after: "Estimate unrecorded steps",
  },
  { file: "25-menu.jpg", route: "/menu", ready: "HabHub" },
  {
    file: "26-live-setup.jpg", route: "/onboarding", ready: "Build a Today page that works for you",
    liveSetup: true,
  },
];
const fromIndex = fromFile
  ? scenes.findIndex((scene) => scene.file === fromFile)
  : 0;
if (fromFile && fromIndex < 0)
  throw new Error(`Unknown --from capture filename: ${fromFile}`);
if (onlyFiles) {
  const unknownFiles = onlyFiles.filter(
    (file) => !scenes.some((scene) => scene.file === file),
  );
  if (unknownFiles.length)
    throw new Error(`Unknown --only capture filename(s): ${unknownFiles.join(", ")}`);
}
const captureScenes = onlyFiles
  ? scenes.filter((scene) => onlyFiles.includes(scene.file))
  : scenes.slice(Math.max(0, fromIndex));

if (promoteReviewed) {
  const candidateDirectory = path.join(exportsRoot, "capture-candidates", "web-420x911");
  const promotedDirectory = path.join(repoRoot, "store", "source-captures", "iphone-420x911");
  assertInside(candidateDirectory, repoRoot, "reviewed-capture source");
  assertInside(promotedDirectory, repoRoot, "reviewed-capture promotion");
  fs.mkdirSync(promotedDirectory, { recursive: true });
  // Validate the entire requested set before replacing even one reviewed file.
  for (const scene of captureScenes) {
    const source = path.join(candidateDirectory, scene.file);
    if (!fs.existsSync(source))
      throw new Error(`Missing reviewed capture candidate: ${source}`);
    assertMarketingCapture(fs.readFileSync(source), scene.file);
  }
  for (const scene of captureScenes) {
    const source = path.join(candidateDirectory, scene.file);
    fs.copyFileSync(source, path.join(promotedDirectory, scene.file));
  }
  console.log(`${captureScenes.length} reviewed captures promoted to ${promotedDirectory}`);
  process.exit(0);
}

function clickText(text) {
  return `(() => {
    const wanted = ${JSON.stringify(text)};
    const node = [...document.querySelectorAll('[role="button"],button,div,span')]
      .filter((candidate) =>
        (candidate.getAttribute('aria-label') || '').includes(wanted) ||
        (candidate.textContent || '').trim().includes(wanted)
      )
      .sort((left, right) => (left.textContent || '').length - (right.textContent || '').length)[0];
    if (!node) return false;
    node.click();
    return true;
  })()`;
}

function clickLabel(label) {
  return `(() => {
    const node = document.querySelector(${JSON.stringify(`[aria-label="${label}"]`)});
    if (!node) return false;
    node.click();
    return true;
  })()`;
}

function clickHref(href) {
  return `(() => {
    const node = document.querySelector(${JSON.stringify(`a[href="${href}"]`)});
    if (!node) return false;
    node.click();
    return true;
  })()`;
}

function scrollTextIntoView(text) {
  return `(() => {
    const wanted = ${JSON.stringify(text)};
    const node = [...document.querySelectorAll('div,span')]
      .filter((candidate) => (candidate.textContent || '').trim() === wanted)
      .sort((left, right) => left.children.length - right.children.length)[0];
    if (!node) return false;
    node.scrollIntoView({ block: 'start', inline: 'nearest' });
    return true;
  })()`;
}

function openPhotoCollage() {
  return `(async () => {
    const wanted = 'Create photo collage';
    const node = [...document.querySelectorAll('[role="button"],button,div,span')]
      .filter((candidate) => (candidate.textContent || '').trim().includes(wanted))
      .sort((left, right) => (left.textContent || '').length - (right.textContent || '').length)[0];
    if (!node) return false;
    node.click();
    await new Promise((resolve) => setTimeout(resolve, 450));
    const destination = [...document.querySelectorAll('div,span')]
      .find((candidate) => (candidate.textContent || '').trim() === 'Photos in collage');
    destination?.scrollIntoView({ block: 'start', inline: 'nearest' });
    return Boolean(destination);
  })()`;
}

function fillTodoBatchOutline(stage) {
  const outline = [
    "- Plan launch #planning",
    "  - Review store copy #release",
    "  - Capture core features",
    "    - Today edit mode",
    "    - Photo collage",
    "- Train this week #fitness",
    "  - Full-body workout",
    "    - Back squat",
  ].join("\n");
  return `(async () => {
    const toggle = document.querySelector('[aria-label="Open batch to-do import"]');
    if (!toggle) return false;
    toggle.click();
    await new Promise((resolve) => setTimeout(resolve, 250));
    const input = document.querySelector('textarea[aria-label="Batch to-do outline"]');
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    if (!setter) return false;
    setter.call(input, ${JSON.stringify(outline)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 550));
    if (${stage ? "true" : "false"}) {
      const stageButton = [...document.querySelectorAll('[role="button"],button')]
        .find((candidate) => (candidate.textContent || '').includes('Stage outline'));
      if (!stageButton) return false;
      stageButton.click();
      await new Promise((resolve) => setTimeout(resolve, 550));
      const expandSubTodos = document.querySelector('[aria-label="Expand Sub-To-Dos"]');
      expandSubTodos?.click();
      await new Promise((resolve) => setTimeout(resolve, 350));
      const subTodos = [...document.querySelectorAll('div,span')]
        .find((candidate) => (candidate.textContent || '').trim() === 'Sub-To-Dos');
      subTodos?.scrollIntoView({ block: 'start', inline: 'nearest' });
    } else {
      const preview = [...document.querySelectorAll('div,span')]
        .find((candidate) => (candidate.textContent || '').trim() === 'Preview');
      preview?.scrollIntoView({ block: 'center', inline: 'nearest' });
    }
    return true;
  })()`;
}

function fillStudyTracker() {
  return `(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (!setter) return false;
    for (const [label, value] of [
      ['What do you want to track?', 'Study time'], ['Target', '60'], ['Unit', 'min'],
    ]) {
      const input = document.querySelector('input[aria-label="' + label + '"]');
      if (!input) return false;
      setter.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    ${clickText("Advanced settings")};
    await new Promise(resolve => setTimeout(resolve, 300));
    for (const [label, value] of [
      ['Amount per tap (min)', '30'], ['Step name', 'focus block'], ['Minimum', '0'], ['Maximum (optional)', ''],
    ]) {
      const input = document.querySelector('input[aria-label="' + label + '"]');
      if (!input) return false;
      setter.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    ${scrollTextIntoView("Plus/minus quick entry")};
    return document.querySelector('input[aria-label="What do you want to track?"]')?.value === 'Study time' &&
      document.querySelector('input[aria-label="Amount per tap (min)"]')?.value === '30';
  })()`;
}

function openStoryComments() {
  return `(async () => {
    const share = document.querySelector('[aria-label="Share"]');
    if (!share) return false;
    const buttons = [...share.parentElement.querySelectorAll('[role="button"],button')];
    const commentButton = buttons[buttons.length - 2];
    if (!commentButton) return false;
    commentButton.click();
    await new Promise((resolve) => setTimeout(resolve, 350));
    const input = document.querySelector('textarea[placeholder="Add a comment"],input[placeholder="Add a comment"]');
    input?.scrollIntoView({ block: 'center', inline: 'nearest' });
    return Boolean(input);
  })()`;
}

function assertInside(child, parent, label) {
  const normalizedChild = path.resolve(child).toLowerCase();
  const normalizedParent = `${path.resolve(parent).toLowerCase()}${path.sep}`;
  if (!normalizedChild.startsWith(normalizedParent))
    throw new Error(`Refusing ${label} outside ${parent}: ${child}`);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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
  throw new Error(`Edge debugging endpoint did not open: ${lastError ?? url}`);
}

class CdpClient {
  constructor(url) {
    this.url = url;
    this.sequence = 0;
    this.pending = new Map();
  }

  async connect() {
    this.socket = new WebSocket(this.url);
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timeout);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
    this.socket.addEventListener("close", () => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timeout);
        pending.reject(new Error("Capture browser disconnected"));
      }
      this.pending.clear();
    });
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
  }

  send(method, params = {}) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Capture browser timed out: ${method}`));
      }, method === "Page.captureScreenshot" ? 10_000 : method === "Browser.close" ? 5_000 : 30_000);
      this.pending.set(id, { resolve, reject, timeout });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
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
    throw new Error(result.exceptionDetails.exception?.description ?? "Browser evaluation failed");
  return result.result?.value;
}

async function waitForText(client, text, timeout = 18_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const found = await evaluate(
      client,
      `Boolean(document.body && document.body.innerText.toLocaleLowerCase().includes(${JSON.stringify(text.toLocaleLowerCase())}))`,
    );
    if (found) return;
    await delay(250);
  }
  const visible = await evaluate(client, "document.body?.innerText?.slice(0, 900) ?? ''");
  throw new Error(`Timed out waiting for ${JSON.stringify(text)}. Visible text: ${visible}`);
}

async function navigate(client, route) {
  await client.send("Page.navigate", { url: `${baseUrl}${route}` });
  await delay(650);
  const deadline = Date.now() + 18_000;
  while (Date.now() < deadline) {
    const ready = await evaluate(
      client,
      "document.readyState === 'complete' && Boolean(document.body?.innerText?.trim())",
    );
    if (ready) return;
    await delay(250);
  }
  throw new Error(`Timed out loading ${route}`);
}

async function captureSurface(client, label) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await client.send("Page.bringToFront");
      await evaluate(client, `Promise.race([
        new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))),
        new Promise(resolve => setTimeout(resolve, 500)),
      ])`);
      const screenshot = await client.send("Page.captureScreenshot", {
        format: "jpeg",
        quality: 94,
        fromSurface: true,
        captureBeyondViewport: false,
        clip: { x: 0, y: 0, width: 420, height: 911, scale: 1 },
      });
      const bytes = Buffer.from(screenshot.data, "base64");
      const quality = assertMarketingCapture(bytes, label);
      console.log(`${label}: ${bytes.length} bytes, ${quality.colorBins} color bins`);
      return bytes;
    } catch (error) {
      lastError = error;
      console.warn(`${label}: surface capture attempt ${attempt}/3 failed: ${error.message}`);
      // Repaint without navigation or losing the real scene's edited form state.
      await client.send("Emulation.setDeviceMetricsOverride", {
        width: 420, height: 911, deviceScaleFactor: 2, mobile: false,
        screenWidth: 420, screenHeight: 911,
      });
      await delay(500 * attempt);
    }
  }
  throw new Error(`${label}: refusing to save an unverified capture. ${lastError?.message}`);
}

async function capture(client, scene) {
  console.log(`Capturing ${scene.file} (${scene.route})`);
  if (scene.tutorialStep) {
    const now = new Date().toISOString();
    await evaluate(
      client,
      `localStorage.setItem('metric-rally-active-tutorial-v1:ahmad', ${JSON.stringify(
        JSON.stringify({
          ...scene.tutorialStep,
          runId: Date.now(),
          experienceMode: "practice",
          demoAnchorDate: "2026-09-08",
          completedStepIds: [],
          practiceActionIds: [],
          startedAt: now,
          updatedAt: now,
        }),
      )})`,
    );
  }
  await navigate(client, scene.route);
  await waitForText(client, scene.ready);
  if (scene.liveSetup) {
    if (!await evaluate(client, clickText("Guided setup"))) throw new Error("Guided setup control missing.");
    await waitForText(client, "What matters to you?");
    await evaluate(client, `document.querySelector('input[aria-label="What should we call you?"]').focus()`);
    await client.send("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2 });
    await client.send("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2 });
    await client.send("Input.insertText", { text: "Ahmad" });
    await client.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    await client.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    await evaluate(client, clickLabel("Move more"));
    await evaluate(client, clickLabel("Do it with friends"));
    await delay(350);
    if (!await evaluate(client, clickLabel("Make Today mine"))) throw new Error("Live setup entry control missing.");
    await waitForText(client, "Make Today yours");
    if (await evaluate(client, `document.body.innerText.includes('AhmadAhmad')`)) throw new Error("Live setup capture duplicated the demo name.");
  }
  if (scene.tutorialReady) await waitForText(client, scene.tutorialReady);
  if (scene.action) {
    if (scene.actionDelayMs) await delay(scene.actionDelayMs);
    const acted = await evaluate(client, scene.action);
    if (!acted && !scene.actionOptional)
      throw new Error(`${scene.file}: capture action could not find its control.`);
    if (acted && scene.after) await waitForText(client, scene.after);
  }
  if (scene.hideTutorialOverlay) {
    await evaluate(
      client,
      `(() => {
        const overlay = document.querySelector('[aria-modal="true"]');
        if (!overlay) return false;
        overlay.style.display = 'none';
        return true;
      })()`,
    );
  }
  await evaluate(
    client,
    `Promise.race([
      Promise.resolve(document.fonts?.ready).then(() => Promise.all([...document.images].map((image) =>
        image.complete ? undefined : new Promise((resolve) => {
          image.addEventListener('load', resolve, { once: true });
          image.addEventListener('error', resolve, { once: true });
        })
      ))),
      new Promise((resolve) => setTimeout(resolve, 2500)),
    ])`,
  );
  const horizontalLayout = await evaluate(
    client,
    `(() => {
      const viewportWidth = document.documentElement.clientWidth;
      const visible = [...document.querySelectorAll('body *')].filter((node) => {
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      });
      const overflow = visible
        .map((node) => {
          const rect = node.getBoundingClientRect();
          return {
            tag: node.tagName,
            label: (node.getAttribute('aria-label') || node.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 80),
            left: Math.round(rect.left * 10) / 10,
            right: Math.round(rect.right * 10) / 10,
            width: Math.round(rect.width * 10) / 10,
          };
        })
        .filter((item) => item.left < -0.5 || item.right > viewportWidth + 0.5)
        .slice(0, 12);
      return {
        clientWidth: viewportWidth,
        scrollWidth: document.documentElement.scrollWidth,
        scrollX: window.scrollX,
        overflow,
      };
    })()`,
  );
  if (horizontalLayout.scrollWidth > horizontalLayout.clientWidth) {
    throw new Error(
      `${scene.file}: page overflows horizontally (${horizontalLayout.scrollWidth}px > ${horizontalLayout.clientWidth}px): ${JSON.stringify(horizontalLayout.overflow)}`,
    );
  }
  if (horizontalLayout.scrollX !== 0 || horizontalLayout.overflow.length) {
    console.warn(`${scene.file}: normalized horizontal layout ${JSON.stringify(horizontalLayout)}`);
  }
  // React Native Web can preserve a nested ScrollView's horizontal offset
  // across route transitions. Marketing frames must always start at the
  // physical left edge while preserving any deliberate vertical reveal.
  await evaluate(
    client,
    `(() => {
      window.scrollTo({ left: 0, top: window.scrollY, behavior: 'instant' });
      for (const node of document.querySelectorAll('*')) {
        if (node.scrollLeft) node.scrollLeft = 0;
      }
      return window.scrollX === 0;
    })()`,
  );
  await delay(850);
  const screenshot = await captureSurface(client, scene.file);
  const destination = path.join(outputDirectory, scene.file);
  fs.writeFileSync(destination, screenshot);
  if (scene.tutorialStep)
    await evaluate(
      client,
      "localStorage.removeItem('metric-rally-active-tutorial-v1:ahmad')",
    );
  console.log(`${scene.file} <- ${scene.route}`);
}

if (!fs.existsSync(edgePath)) throw new Error(`Microsoft Edge was not found: ${edgePath}`);
await fetch(baseUrl).catch((error) => {
  throw new Error(`HabHub web must already be running at ${baseUrl}: ${error.message}`);
});
assertInside(profileDirectory, exportsRoot, "capture-profile cleanup");
assertInside(outputDirectory, repoRoot, "capture output");
fs.rmSync(profileDirectory, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
fs.mkdirSync(profileDirectory, { recursive: true });
fs.mkdirSync(outputDirectory, { recursive: true });

const edge = spawn(edgePath, [
  "--headless=new",
  "--force-device-scale-factor=2",
  "--disable-gpu",
  "--disable-extensions",
  "--disable-background-timer-throttling",
  "--disable-renderer-backgrounding",
  "--disable-backgrounding-occluded-windows",
  "--hide-scrollbars",
  "--no-first-run",
  "--no-default-browser-check",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profileDirectory}`,
  "about:blank",
], { stdio: "ignore", windowsHide: true });

let client;
try {
  const pages = await waitForJson(`http://127.0.0.1:${port}/json/list`);
  const page = pages.find((item) => item.type === "page");
  if (!page?.webSocketDebuggerUrl) throw new Error("Edge did not expose a page target.");
  client = new CdpClient(page.webSocketDebuggerUrl);
  await client.connect();
  await Promise.all([
    client.send("Page.enable"),
    client.send("Runtime.enable"),
    client.send("Network.enable"),
  ]);
  await client.send("Emulation.setDeviceMetricsOverride", {
    width: 420,
    height: 911,
    deviceScaleFactor: 2,
    mobile: false,
    screenWidth: 420,
    screenHeight: 911,
  });
  await client.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  await client.send("Emulation.setLocaleOverride", { locale: "en-US" });
  const bootstrap = `(() => {
    if (!location.origin.startsWith('http://127.0.0.1') && !location.origin.startsWith('http://localhost')) return;
    localStorage.setItem('paceboard-explicit-demo-mode-v1', 'true');
    localStorage.setItem('metric-rally-onboarding-complete-v1:demo:ahmad', JSON.stringify({ completed: true, version: 4, completedAt: '2026-09-08T09:00:00.000Z' }));
    localStorage.setItem('metric-rally-tutorial-first-visits-v1:demo%3Aahmad', JSON.stringify({ pageIds: ${JSON.stringify(pageIds)}, updatedAt: '2026-09-08T09:00:00.000Z' }));
    localStorage.setItem('metric-rally-tutorial-first-visits-v1:ahmad', JSON.stringify({ pageIds: ${JSON.stringify(pageIds)}, updatedAt: '2026-09-08T09:00:00.000Z' }));
  })();`;
  await client.send("Page.addScriptToEvaluateOnNewDocument", { source: bootstrap });
  await navigate(client, "/");
  await waitForText(client, "Hi,");

  // A fresh release fixture intentionally begins with the essential guide.
  // Dismiss it once so source captures contain only the real page UI.
  const skipDeadline = Date.now() + 10_000;
  while (Date.now() < skipDeadline) {
    const skipped = await evaluate(client, clickText("Skip"));
    if (skipped) break;
    await delay(250);
  }
  await delay(1_200);

  for (const scene of captureScenes) await capture(client, scene);
  console.log(`${captureScenes.length} real-app captures written to ${outputDirectory}`);
  if (!promote)
    console.log("Review the candidates, then rerun with --promote to replace tracked source captures.");
} finally {
  if (client) {
    await client.send("Browser.close").catch(() => undefined);
    await delay(350);
    client.close();
  }
  edge.kill();
}
