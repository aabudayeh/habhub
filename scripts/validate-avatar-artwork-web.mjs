import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";

const root = path.resolve(import.meta.dirname, "..");
const baseUrl = process.env.HABHUB_USABILITY_URL ?? "http://127.0.0.1:8091";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(baseUrl).hostname), "This mutable demo-only UI test must never run against a live account origin");
const port = Number(process.env.HABHUB_AVATAR_PORT ?? 9346);
const outputSuffix = process.env.HABHUB_AVATAR_OUTPUT_SUFFIX ?? "";
assert.match(outputSuffix, /^[a-z0-9-]*$/, "The optional report suffix must stay inside the dedicated QA output folder");
const output = path.join(root, "store", "exports", `avatar-artwork-web${outputSuffix ? `-${outputSuffix}` : ""}`);
const profiles = path.join(output, "profiles");
fs.mkdirSync(profiles, { recursive: true });
const profile = fs.mkdtempSync(path.join(profiles, "edge-"));
const edgePath = process.env.HABHUB_EDGE_PATH ?? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const widths = process.env.HABHUB_AVATAR_WIDTHS?.split(",").map(Number) ?? [390, 320, 1440];
const results = [];
const runtimeErrors = [];
const sourceProofs = new Map();
const spriteRequests = [];
const spriteRequestsById = new Map();
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hash = (value) => createHash("sha256").update(value).digest("hex");

class Browser {
  constructor(url) { this.url = url; this.sequence = 0; this.pending = new Map(); }
  async connect() {
    this.socket = new WebSocket(this.url);
    this.socket.addEventListener("message", ({ data }) => {
      const event = JSON.parse(String(data));
      if (event.method === "Network.requestWillBeSent" && /status-avatar-v2\/.*\.png(?:\?|$)/.test(event.params.request.url)) {
        const request = { requestId: event.params.requestId, url: event.params.request.url, startedAt: Date.now(), servedFromCache: false };
        spriteRequests.push(request); spriteRequestsById.set(request.requestId, request);
      }
      const spriteRequest = spriteRequestsById.get(event.params?.requestId);
      if (spriteRequest && event.method === "Network.responseReceived") {
        Object.assign(spriteRequest, { responseStatus: event.params.response.status, mimeType: event.params.response.mimeType,
          fromDiskCache: Boolean(event.params.response.fromDiskCache), fromServiceWorker: Boolean(event.params.response.fromServiceWorker) });
      }
      if (spriteRequest && event.method === "Network.requestServedFromCache") spriteRequest.servedFromCache = true;
      if (spriteRequest && event.method === "Network.loadingFinished") Object.assign(spriteRequest, { encodedBytes: event.params.encodedDataLength, finishedAt: Date.now() });
      if (spriteRequest && event.method === "Network.loadingFailed") spriteRequest.failure = event.params.errorText;
      if (event.method === "Runtime.exceptionThrown") runtimeErrors.push(event.params.exceptionDetails.exception?.description ?? event.params.exceptionDetails.text);
      if (event.method === "Runtime.consoleAPICalled" && event.params.type === "error") runtimeErrors.push(event.params.args.map((arg) => arg.value ?? arg.description ?? "").join(" "));
      const pending = this.pending.get(event.id);
      if (!pending) return;
      clearTimeout(pending.timer); this.pending.delete(event.id);
      if (event.error) pending.reject(new Error(event.error.message)); else pending.resolve(event.result);
    });
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Browser timeout: ${method}`)); }, 20000);
      this.pending.set(id, { resolve, reject, timer }); this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  }
  close() { for (const item of this.pending.values()) clearTimeout(item.timer); this.pending.clear(); this.socket.close(); }
}

let browser;
let edge;
let mobile = true;
let activeWidth = 390;
const textPresent = (text) => `document.body?.innerText?.includes(${JSON.stringify(text)})`;
const byLabel = (label, role) => `document.querySelector(${JSON.stringify(`${role ? `[role="${role}"]` : ""}[aria-label="${label}"]`)})`;
const byText = (text) => `Array.from(document.querySelectorAll('div,span,button,a')).find(node => node.textContent === ${JSON.stringify(text)} && !Array.from(node.children).some(child => child.textContent === ${JSON.stringify(text)}))?.closest('[role="button"],[tabindex="0"],button,a')`;
const slider = (label) => `document.querySelector('[role="slider"][aria-label^="${label}."]')`;
const artwork = `Array.from(document.querySelectorAll('[data-testid="status-avatar-artwork"]')).at(-1)`;

async function until(expression, label) {
  const end = Date.now() + 20000;
  while (Date.now() < end) {
    if (await browser.evaluate(expression).catch(() => false)) return;
    await delay(100);
  }
  throw new Error(`Timed out: ${label}. Visible: ${await browser.evaluate("document.body?.innerText?.slice(0,1600)")}`);
}

async function tap(expression, label) {
  const rect = await browser.evaluate(`(() => {
    const node = ${expression}; if (!node) return null;
    node.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
    const rect=node.getBoundingClientRect(), x=rect.left+rect.width/2, y=rect.top+rect.height/2, hit=document.elementFromPoint(x,y);
    return {x,y,width:rect.width,height:rect.height,reachable:Boolean(hit && (node.contains(hit)||hit.contains(node)))};
  })()`);
  assert.ok(rect && rect.width > 0 && rect.height > 0, `Missing visible target: ${label}`);
  assert.ok(rect.reachable, `Another surface intercepts ${label}`);
  if (mobile) {
    await browser.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: rect.x, y: rect.y }] });
    await browser.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } else {
    await browser.send("Input.dispatchMouseEvent", { type: "mousePressed", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
    await browser.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
  }
  await delay(250);
}

async function navigate(route, ready) {
  await browser.send("Page.navigate", { url: `${baseUrl}${route}` });
  await until(textPresent(ready), ready); await delay(300);
}

async function snapshot() {
  return browser.evaluate(`new Promise((resolve,reject)=>{
    const request=indexedDB.open('habhub-durable-state-v1'); request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{const db=request.result;
      if(!db.objectStoreNames.contains('large-state')) {db.close();resolve(JSON.parse(localStorage.getItem('paceboard-state-v1')||'null'));return;}
      const read=db.transaction('large-state','readonly').objectStore('large-state').get('paceboard-state-v1');
      read.onerror=()=>{db.close();reject(read.error);};
      read.onsuccess=()=>{db.close();resolve(JSON.parse(read.result||localStorage.getItem('paceboard-state-v1')||'null'));};
    };
  })`);
}

async function saved(predicate, label) {
  const end = Date.now() + 12000;
  while (Date.now() < end) { const value = await snapshot(); if (predicate(value)) return value; await delay(150); }
  throw new Error(`Durable preference did not settle: ${label}`);
}

async function screenshot(name) {
  await browser.send("Page.bringToFront");
  await delay(100);
  const layout = await browser.evaluate(`({width:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth})`);
  assert.ok(layout.scrollWidth <= layout.width + 1, `Horizontal overflow: ${name}: ${JSON.stringify(layout)}`);
  const image = await browser.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  const file = `${activeWidth}-${name}.png`;
  fs.writeFileSync(path.join(output, file), Buffer.from(image.data, "base64"));
  return file;
}

async function inspectArtwork(expectedSex) {
  await until(`Boolean(${artwork}?.querySelector('img')?.complete && ${artwork}?.querySelector('img')?.naturalWidth)`, "Original sprite decoded");
  const proof = await browser.evaluate(`(() => {
    const base=${artwork}, image=base.querySelector('img'), cell=image.parentElement, rect=cell.getBoundingClientRect(), viewport=base.parentElement;
    return {src:image.currentSrc||image.src,naturalWidth:image.naturalWidth,naturalHeight:image.naturalHeight,
      width:rect.width,height:rect.height,baseImageCount:base.querySelectorAll('img').length,
      vectorPathCount:viewport.querySelectorAll('svg path').length,
      viewportSources:[...new Set([...viewport.querySelectorAll('img')].map(item=>item.currentSrc||item.src))],
      viewportWidth:viewport.getBoundingClientRect().width,viewportHeight:viewport.getBoundingClientRect().height};
  })()`);
  assert.equal(proof.baseImageCount, 1, "Exactly one original figure must define the base contour");
  assert.equal(proof.vectorPathCount, 0, "No reconstructed vector anatomy may render over the established artwork");
  assert.equal(proof.viewportSources.length, 1, "Progress and theme layers must use the same single sprite without ghost silhouettes");
  assert.equal(proof.naturalWidth, 328); assert.equal(proof.naturalHeight, 512);
  assert.ok(Math.abs(proof.width / proof.height - 328 / 512) < 0.001, `Artwork must retain uniform aspect ratio: ${JSON.stringify(proof)}`);
  const match = decodeURIComponent(new URL(proof.src).pathname).match(/status-avatar-v2\/(male|female)\/(m\d{2}-a\d{2})/);
  assert.ok(match, `The actual rendered image must identify an original V2 body: ${proof.src}`);
  assert.equal(match[1], expectedSex, "The original artwork must follow the actual profile's selected sex");
  const sourceFile = `assets/images/status-avatar-v2/${match[1]}/${match[2]}.png`;
  if (!sourceProofs.has(sourceFile)) {
    const response = await fetch(proof.src); assert.ok(response.ok);
    const servedSha256 = hash(Buffer.from(await response.arrayBuffer()));
    const originalSha256 = hash(fs.readFileSync(path.join(root, sourceFile)));
    assert.equal(servedSha256, originalSha256, "Rendered art bytes must match the original untouched raster");
    sourceProofs.set(sourceFile, { sourceFile, servedSha256, originalSha256 });
  }
  return { ...proof, sourceFile };
}

async function arrow(label, count) {
  const target = slider(label);
  await until(`Boolean(${target})`, `${label} slider enabled`);
  const readValue = () => browser.evaluate(`(() => {
    const node=${target}, visible=node.parentElement.innerText.match(/([\\d.]+)\\s*(?:kg|%)/);
    return {value:visible ? Number(visible[1]) : null,ariaValue:node.getAttribute('aria-valuenow')};
  })()`);
  const beforeReading = await readValue();
  assert.notEqual(beforeReading.value, null, `${label} must show a readable numeric preview value`);
  assert.notEqual(beforeReading.ariaValue, null, `${label} must expose its numeric value to web assistive technology`);
  assert.ok(Math.abs(Number(beforeReading.ariaValue) - beforeReading.value) < 0.06, `${label} screen-reader and visible values must agree`);
  const before = beforeReading.value;
  await browser.evaluate(`${target}.focus()`);
  for (let index = 0; index < Math.abs(count); index += 1) {
    const key = count > 0 ? "ArrowRight" : "ArrowLeft", code = count > 0 ? 39 : 37;
    await browser.send("Input.dispatchKeyEvent", { type: "keyDown", key, code: key, windowsVirtualKeyCode: code });
    await browser.send("Input.dispatchKeyEvent", { type: "keyUp", key, code: key, windowsVirtualKeyCode: code });
    await delay(45);
  }
  const afterReading = await readValue();
  assert.notEqual(afterReading.value, null, `${label} must keep its numeric preview value readable`);
  assert.notEqual(afterReading.ariaValue, null, `${label} must keep its updated value available to web assistive technology`);
  assert.ok(Math.abs(Number(afterReading.ariaValue) - afterReading.value) < 0.06, `${label} updated screen-reader and visible values must agree`);
  const after = afterReading.value;
  assert.ok(count > 0 ? after > before : after < before, `${label} must respond to real keyboard adjustment: ${before} -> ${after}`);
  return { label, before, after, ariaValueBefore:beforeReading.ariaValue, ariaValueAfter:afterReading.ariaValue };
}

async function enableComposition(label) {
  const control = byLabel(label, "switch");
  assert.ok(["true", "false"].includes(await browser.evaluate(`${control}.getAttribute('aria-checked')`)), `${label} must expose its real on/off state to web assistive technology`);
  if (!await browser.evaluate(`Boolean(${slider(label)})`)) await tap(control, `Enable ${label}`);
  await until(`Boolean(${slider(label)})`, `${label} adjustable track enabled`);
  assert.equal(await browser.evaluate(`${control}.getAttribute('aria-checked')`), "true", `${label} must announce its enabled state`);
}

async function configure(sex, visualStyle, darkMode) {
  let state = await snapshot();
  if (state.settings.energyProfile.sex !== sex) {
    await navigate("/profile", "My profile");
    await tap(byText("Body & energy profile"), "Expand body profile");
    await tap(byText(sex === "female" ? "Female" : "Male"), `Set ${sex} profile`);
    state = await saved((value) => value?.settings?.energyProfile?.sex === sex, "Profile sex");
  }
  if ((state.settings.statusAvatarStyle ?? "silhouette") !== visualStyle || Boolean(state.settings.darkMode) !== darkMode) {
    await navigate("/display-settings", "Appearance and where HabHub opens.");
    if ((state.settings.statusAvatarStyle ?? "silhouette") !== visualStyle) {
      await tap(byText("Advanced"), "Expand advanced display options");
      await tap(byLabel("Status avatar style"), "Choose avatar style");
      await tap(byLabel(visualStyle === "body_model" ? "Detailed body model" : "Clean silhouette", "radio"), `Choose ${visualStyle}`);
      state = await saved((value) => value?.settings?.statusAvatarStyle === visualStyle, "Avatar style");
    }
    if (Boolean(state.settings.darkMode) !== darkMode) {
      await tap(byText("General"), "Expand general display options");
      const darkSwitch = `(() => {let node=[...document.querySelectorAll('div,span')].find(item=>item.textContent==='Dark mode'&&!item.children.length); while(node && !node.querySelector('[role="switch"]')) node=node.parentElement; return node?.querySelector('[role="switch"]');})()`;
      await tap(darkSwitch, "Toggle dark mode");
      await saved((value) => Boolean(value?.settings?.darkMode) === darkMode, "Theme mode");
    }
  }
}

async function scenario(sex, visualStyle, darkMode) {
  const name = `${sex}-${visualStyle}-${darkMode ? "dark" : "light"}`;
  await configure(sex, visualStyle, darkMode);
  const initialRequestOffset = spriteRequests.length;
  const initialObservationStartedAt = Date.now();
  await navigate("/status", "Status");
  await until(`Boolean(${byLabel("Open avatar simulator")})`, "Status avatar control");
  const base = await inspectArtwork(sex);
  // Observe the actual browser loader, not static import count or image tags.
  // Multiple layers may use one cached URL; no other composition should load.
  await delay(1000);
  const initialRequests = spriteRequests.slice(initialRequestOffset).map((request) => ({ ...request }));
  const initialUrls = [...new Set(initialRequests.map((request) => request.url))];
  assert.ok(initialUrls.length <= 1, `Initial Status must not preload other artwork states: ${JSON.stringify(initialUrls)}`);
  if (initialUrls.length) assert.equal(initialUrls[0], base.src, "Any initial sprite request must be the actual selected original body");
  assert.ok(initialRequests.every((request) => !request.failure && request.finishedAt), "Initial selected artwork requests must complete successfully");
  const initialNetwork = { observationMs: Date.now() - initialObservationStartedAt,
    requestCount: initialRequests.length, uniqueSourceCount: initialUrls.length,
    encodedBytes: initialRequests.reduce((sum, request) => sum + (request.encodedBytes ?? 0), 0),
    responseCount: initialRequests.filter((request) => request.responseStatus !== undefined).length,
    cachedResponseCount: initialRequests.filter((request) => request.servedFromCache || request.fromDiskCache).length,
    requests: initialRequests };
  console.log(`NETWORK ${activeWidth} ${name}: ${initialNetwork.requestCount} request(s), ${initialNetwork.uniqueSourceCount} source(s), ${initialNetwork.encodedBytes} encoded bytes`);
  const before = await snapshot();
  const screenshots = [await screenshot(`${name}-status`)];
  await tap(byLabel("Open avatar simulator"), "Open real avatar simulator");
  await until(textPresent("Preview a change without saving it."), "Simulator modal");
  const initial = await inspectArtwork(sex);
  assert.equal(initial.sourceFile, base.sourceFile, "Simulator begins from the same selected body");
  const weight = await arrow("Weight", 9);
  const heavy = await inspectArtwork(sex);
  assert.notEqual(heavy.sourceFile, initial.sourceFile, "A substantial weight change must select an appropriate heavier original body");
  await enableComposition("Body fat");
  const fat = await arrow("Body fat", 5);
  const fatBody = await inspectArtwork(sex);
  await enableComposition("Lean body mass");
  const lean = await arrow("Lean body mass", 4);
  const composed = await inspectArtwork(sex);
  assert.notEqual(composed.sourceFile, fatBody.sourceFile, "Independent lean-mass adjustment must be reflected by the original muscle-state artwork");
  screenshots.push(await screenshot(`${name}-heavier-composition`));
  let extreme;
  if (activeWidth === 390 && visualStyle === "body_model" && !darkMode) {
    const weightMaximum = await arrow("Weight", 20);
    const fatMaximum = await arrow("Body fat", 20);
    assert.equal(weightMaximum.after, Number(await browser.evaluate(`${slider("Weight")}.getAttribute('aria-valuemax')`)), "The maximum-weight preview must reach the actual supported slider limit");
    assert.equal(fatMaximum.after, Number(await browser.evaluate(`${slider("Body fat")}.getAttribute('aria-valuemax')`)), "The maximum-fat preview must reach the actual supported slider limit");
    extreme = { weightMaximum, fatMaximum, artwork: await inspectArtwork(sex) };
    screenshots.push(await screenshot(`${name}-maximum-weight-fat`));
  }
  for (const label of ["Body fat", "Lean body mass"]) {
    const control = byLabel(label, "switch");
    await tap(control, `Disable hypothetical ${label}`);
    assert.equal(await browser.evaluate(`${control}.getAttribute('aria-checked')`), "false", `${label} must announce its disabled state`);
    assert.equal(await browser.evaluate(`Boolean(${slider(label)})`), false, `${label} disabled track must stop advertising adjustment`);
    const offTrack = `document.querySelector('[role="button"][aria-label^="${label}."]')`;
    assert.equal(await browser.evaluate(`${offTrack}?.getAttribute('aria-valuenow')`), null, `${label} disabled track must not announce a hypothetical value as an active slider`);
  }
  await tap(byLabel("About this estimate", "button"), "Open estimate explanation");
  await until(textPresent("not a scan"), "Illustrative estimate disclosure");
  screenshots.push(await screenshot(`${name}-estimate`));
  await tap(byText("Done"), "Close preview without saving");
  await until(`!${textPresent("Avatar simulator")}`, "Simulator closed");
  const restored = await inspectArtwork(sex);
  assert.equal(restored.sourceFile, base.sourceFile, "Closing a preview must restore the actual original profile body");
  await delay(1100);
  const after = await snapshot();
  assert.deepEqual(after.entries, before.entries, "Simulator changes must not edit, add, or delete ledger entries");
  assert.deepEqual(after.settings.energyProfile, before.settings.energyProfile, "Simulator changes must never persist a hypothetical body profile");
  return { name, base, initialNetwork, initial, heavy, fatBody, composed, extreme, restored, actions: [weight, fat, lean], ledgerSha256: hash(JSON.stringify(before.entries)), ledgerEntryCount: before.entries.length, screenshots };
}

try {
  await fetch(baseUrl).then((response) => assert.ok(response.ok, `Web fixture returned ${response.status}`));
  edge = spawn(edgePath, ["--headless=new", "--disable-gpu", "--disable-extensions", "--disable-sync", "--no-first-run", "--no-default-browser-check", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank"], { windowsHide: true, stdio: "ignore" });
  let pages;
  for (let index = 0; index < 100; index += 1) { pages = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json()).catch(() => undefined); if (pages?.some((page) => page.webSocketDebuggerUrl)) break; await delay(150); }
  const page = pages?.find((candidate) => candidate.type === "page" && candidate.url === "about:blank");
  assert.ok(page?.webSocketDebuggerUrl, "Isolated Edge did not expose its page");
  browser = new Browser(page.webSocketDebuggerUrl); await browser.connect();
  await Promise.all([browser.send("Page.enable"), browser.send("Runtime.enable"), browser.send("Network.enable")]);
  // Only choose the supported credential-free demo environment. Onboarding,
  // profile preferences and every preview below are changed through real UI.
  await browser.send("Page.addScriptToEvaluateOnNewDocument", { source: `if(location.origin===${JSON.stringify(new URL(baseUrl).origin)})localStorage.setItem('paceboard-explicit-demo-mode-v1','true');` });
  await browser.send("Emulation.setLocaleOverride", { locale: "en-US" });
  await browser.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await browser.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: false });
  await browser.send("Emulation.setTouchEmulationEnabled", { enabled: true });
  await navigate("/onboarding", "Build a Today page that works for you");
  await tap(byText("Guided setup"), "Start actual guided welcome");
  await until(textPresent("What matters to you?"), "Guided welcome");
  await tap(byLabel("Skip all tutorials"), "Disable automatic tutorial prompts");
  await tap(byText("Make Today mine"), "Complete welcome through real UI");
  await until("location.pathname === '/'", "Today reached after welcome");
  await saved((value) => value?.settings?.onboardingComplete && value?.settings?.tutorialPromptsDisabled, "Real welcome completion");
  for (const width of widths) {
    activeWidth = width; mobile = width < 500;
    await browser.send("Emulation.setDeviceMetricsOverride", { width, height: mobile ? 844 : 1000, deviceScaleFactor: mobile ? 2 : 1, mobile: false });
    await browser.send("Emulation.setTouchEmulationEnabled", { enabled: mobile });
    for (const sex of ["male", "female"]) {
      const combinations = width === 390 ? [["silhouette", false], ["silhouette", true], ["body_model", true], ["body_model", false]] : [["silhouette", false], ["body_model", true]];
      for (const [visualStyle, darkMode] of combinations) {
        const name = `${sex}-${visualStyle}-${darkMode ? "dark" : "light"}`;
        try { const detail = await scenario(sex, visualStyle, darkMode); results.push({ width, name, passed: true, detail }); console.log(`PASS ${width} ${name}`); }
        catch (error) { results.push({ width, name, passed: false, error: String(error) }); await screenshot(`failure-${name}`).catch(() => undefined); console.error(`FAIL ${width} ${name}: ${error.message}`); throw error; }
      }
    }
  }
} finally {
  if (browser) { await browser.send("Browser.close").catch(() => undefined); browser.close(); }
  edge?.kill(); await delay(350);
  const resolved = path.resolve(profile);
  assert.ok(resolved.startsWith(`${path.resolve(profiles)}${path.sep}`), "Profile cleanup escaped the dedicated test folder");
  fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  fs.writeFileSync(path.join(output, "report.json"), JSON.stringify({ baseUrl, testedAt: new Date().toISOString(), initialization: "Credential-free demo flag only; all setup and customization through actual UI; read-only ledger verification", results, sourceProofs: [...sourceProofs.values()],
    networkObservation: { method: "Actual CDP Network request/response/loadingFinished events; encoded bytes include transport accounting and cache responses can be zero. Initial Status observation includes one second after the selected image decodes. Later slider previews intentionally request other selected states.",
      totalSpriteRequests: spriteRequests.length, totalUniqueSpriteSources: new Set(spriteRequests.map((request) => request.url)).size,
      totalEncodedBytes: spriteRequests.reduce((sum, request) => sum + (request.encodedBytes ?? 0), 0), requests: spriteRequests },
    runtimeErrors: [...new Set(runtimeErrors)] }, null, 2));
}
if (results.some((result) => !result.passed) || runtimeErrors.length) process.exitCode = 1;
console.log(`Avatar artwork report: ${path.join(output, "report.json")}; ${results.filter((result) => result.passed).length}/${results.length} checks, ${runtimeErrors.length} runtime errors.`);
