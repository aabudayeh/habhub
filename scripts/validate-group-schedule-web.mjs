import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { Buffer } from "node:buffer";

const root = path.resolve(import.meta.dirname, "..");
const baseUrl = process.env.HABHUB_USABILITY_URL ?? "http://127.0.0.1:8091";
const port = Number(process.env.HABHUB_USABILITY_PORT ?? 9343);
const output = path.join(root, "store", "exports", "group-schedule-web");
const profiles = path.join(output, "profiles");
fs.mkdirSync(profiles, { recursive: true });
const profile = fs.mkdtempSync(path.join(profiles, "edge-"));
const edgePath = process.env.HABHUB_EDGE_PATH ?? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const results = [];
const runtimeErrors = [];
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class Browser {
  constructor(url) { this.url = url; this.sequence = 0; this.pending = new Map(); }
  async connect() {
    this.socket = new WebSocket(this.url);
    this.socket.addEventListener("message", ({ data }) => {
      const event = JSON.parse(String(data));
      if (event.method === "Runtime.exceptionThrown") {
        const error = event.params.exceptionDetails.exception?.description ?? event.params.exceptionDetails.text;
        runtimeErrors.push(error); console.error(`App exception: ${error}`);
      }
      if (event.method === "Runtime.consoleAPICalled" && event.params.type === "error") runtimeErrors.push(event.params.args.map((arg) => arg.value ?? arg.description ?? "").join(" "));
      const pending = this.pending.get(event.id);
      if (!pending) return;
      clearTimeout(pending.timer); this.pending.delete(event.id);
      if (event.error) pending.reject(new Error(event.error.message));
      else pending.resolve(event.result);
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
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  }
  close() { for (const value of this.pending.values()) clearTimeout(value.timer); this.pending.clear(); this.socket.close(); }
}

let browser;
let edge;
async function until(expression, label) {
  const end = Date.now() + 20000;
  while (Date.now() < end) {
    if (await browser.evaluate(expression).catch(() => false)) return;
    await delay(100);
  }
  throw new Error(`Timed out: ${label}. Visible: ${await browser.evaluate("document.body?.innerText?.slice(0,1200)")}`);
}
const textPresent = (text) => `document.body?.innerText?.includes(${JSON.stringify(text)})`;
const byLabel = (label) => `document.querySelector('[aria-label="' + CSS.escape(${JSON.stringify(label)}) + '"]')`;
const byText = (text) => `Array.from(document.querySelectorAll('div,span,button,a')).find((node) => node.textContent === ${JSON.stringify(text)} && !Array.from(node.children).some((child) => child.textContent === ${JSON.stringify(text)}))?.closest('[role="button"],[tabindex="0"],button,a')`;

async function tap(expression, label, mobile, holdMs = 0) {
  const rect = await browser.evaluate(`(() => {
    const node = ${expression}; if (!node) return null;
    node.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    const rect = node.getBoundingClientRect(); const x = rect.left + rect.width / 2; const y = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(x,y);
    return { x, y, width: rect.width, height: rect.height, reachable: Boolean(hit && (node.contains(hit) || hit.contains(node))) };
  })()`);
  assert.ok(rect && rect.width > 0 && rect.height > 0, `Missing visible target: ${label}`);
  assert.ok(rect.reachable, `Another surface intercepts ${label}`);
  if (mobile) {
    await browser.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: rect.x, y: rect.y }] });
    if (holdMs) await delay(holdMs);
    await browser.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } else {
    await browser.send("Input.dispatchMouseEvent", { type: "mousePressed", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
    if (holdMs) await delay(holdMs);
    await browser.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
  }
  await delay(350);
  return { label, width: Math.round(rect.width), height: Math.round(rect.height) };
}

async function shot(name, width) {
  const layout = await browser.evaluate(`({ width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth, scrollX: window.scrollX })`);
  await browser.send("Page.bringToFront");
  await browser.evaluate("Promise.race([new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))), new Promise(resolve => setTimeout(resolve, 500))])");
  const image = await browser.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  fs.writeFileSync(path.join(output, `${width}-${name}.png`), Buffer.from(image.data, "base64"));
  assert.ok(layout.scrollWidth <= layout.width + 1, `${name}: horizontal overflow ${JSON.stringify(layout)}`);
  return layout;
}

async function navigate(route, ready) {
  await browser.send("Page.navigate", { url: `${baseUrl}${route}` });
  await until(textPresent(ready), ready);
  await delay(500);
  const skip = await browser.evaluate(`Boolean(${byText("Skip")})`);
  if (skip) await tap(byText("Skip"), "Skip initial guide", false);
  await delay(250);
}


try {
  await fetch(baseUrl).then((response) => { if (!response.ok) throw new Error(`Web fixture returned ${response.status}`); });
  edge = spawn(edgePath, ["--headless=new", "--disable-gpu", "--disable-extensions", "--disable-sync", "--no-first-run", "--no-default-browser-check", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank"], { windowsHide: true, stdio: "ignore" });
  let pages;
  for (let index = 0; index < 100; index += 1) {
    pages = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json()).catch(() => undefined);
    if (pages?.some((page) => page.webSocketDebuggerUrl)) break;
    await delay(150);
  }
  const page = pages?.find((candidate) => candidate.type === "page" && candidate.url === "about:blank");
  assert.ok(page?.webSocketDebuggerUrl, "Isolated Edge did not expose its page");
  browser = new Browser(page.webSocketDebuggerUrl); await browser.connect();
  await Promise.all([browser.send("Page.enable"), browser.send("Runtime.enable")]);
  const pageIds = ["today", "status", "menu", "quick-guide", "notifications", "metric-editor", "settings", "display", "progress", "leaderboard", "chat", "workout", "challenges", "badges", "groups", "customize", "group-notes", "group-schedule", "recap-feed", "group-recap", "profile", "timer", "food", "todo"];
  await browser.send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
    if (!location.origin.startsWith('http://127.0.0.1')) return;
    localStorage.setItem('paceboard-explicit-demo-mode-v1','true');
    localStorage.setItem('metric-rally-onboarding-complete-v1:demo:ahmad', JSON.stringify({completed:true,version:4,completedAt:new Date().toISOString()}));
    for (const key of ['demo%3Aahmad','ahmad']) localStorage.setItem('metric-rally-tutorial-first-visits-v1:'+key, JSON.stringify({pageIds:${JSON.stringify(pageIds)},updatedAt:new Date().toISOString()}));
  })()` });
  await browser.send("Emulation.setLocaleOverride", { locale: "en-US" });
  await browser.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  for (const width of [320, 390, 1440]) {
    const mobile = width < 500;
    await browser.send("Emulation.setDeviceMetricsOverride", { width, height: mobile ? 844 : 1000, deviceScaleFactor: 1, mobile: false });
    await browser.send("Emulation.setTouchEmulationEnabled", { enabled: mobile });
    const run = async (name, work) => {
      try { const detail = await work(); results.push({ width, name, passed: true, detail }); console.log(`PASS ${width} ${name}`); }
      catch (error) { results.push({ width, name, passed: false, error: String(error) }); await shot(`failure-${name}`, width).catch(() => undefined); console.error(`FAIL ${width} ${name}: ${error.message}`); }
    };
    await run("calendar-views", async () => {
      await navigate("/group-schedule", "Group Schedule");
      await until(`Boolean(${byLabel("Day calendar view")})`, "New calendar");
      await shot("calendar-default", width);
      const day = await tap(byLabel("Day calendar view"), "Day calendar view", mobile);
      assert(day.width >= 44 && day.height >= 40);
      await tap(byLabel("Next day"), "Next day", mobile);
      const nextDay = await browser.evaluate(`${byLabel("Choose a calendar date")}?.textContent`);
      await tap(byLabel("Previous day"), "Previous day", mobile);
      assert.notEqual(await browser.evaluate(`${byLabel("Choose a calendar date")}?.textContent`), nextDay);
      await tap(byLabel("Week calendar view"), "Week calendar view", mobile);
      await shot("calendar-week", width);
      const cells = await browser.evaluate("Array.from(document.querySelectorAll('[aria-label$=\" items\"]')).map(n=>n.getBoundingClientRect()).map(r=>({width:r.width,height:r.height}))");
      assert(cells.length >= 168);
      assert(cells.every(cell => cell.width >= 43.5 && cell.height >= 44));
      await tap(byLabel("Month calendar view"), "Month calendar view", mobile);
      await shot("calendar-month", width);
      await tap(byLabel("Day calendar view"), "Return to day", mobile);
      return {day,cells:cells.length,nextDay};
    });
    await run("event-create-reminder-edit", async () => {
      // Stay in this document: demo group rows are intentionally memory-only.
      await tap(byText("New event"), "New event", mobile);
      await until(`Boolean(${byLabel("Event title")})`, "Event editor");
      await tap(byLabel("Event title"), "Title input", mobile);
      await browser.send("Input.insertText",{text:"QA shared plan "+width});
      await tap(byLabel("Event notes"), "Notes input", mobile);
      await browser.send("Input.insertText",{text:"Meet at the north gate; bring water."});
      await tap(byLabel("Shared event reminder"), "Shared event reminder", mobile);
      await until(textPresent("15 minutes before"), "Reminder choices");
      await tap(byText("15 minutes before"), "15-minute reminder", mobile);
      await shot("event-editor",width);
      await tap(byText("Save"), "Save new event", mobile);
      await until(`!Boolean(${byLabel("Event title")})`, "Event saved");
      await until(textPresent("QA shared plan "+width), "Saved event visible");
      await tap(byText("QA shared plan "+width), "Open saved event", mobile);
      await until(textPresent("Group plans"), "Slot details");
      await until(textPresent("Reminder 15 min before"), "Saved reminder offset");
      await shot("event-details",width);
      await tap(byText("Edit"), "Edit saved event", mobile);
      await until(`Boolean(${byLabel("Event title")})`, "Edit editor");
      assert.equal(await browser.evaluate(`${byLabel("Event title")}.value`),"QA shared plan "+width);
      await tap(byLabel("All-day event"), "Switch to all-day", mobile);
      await until(`!Boolean(${byLabel("Shared event reminder")})`, "All-day clears timed reminder control");
      await shot("event-all-day",width);
      await tap(byText("Save"), "Save all-day event", mobile);
      await until(`!Boolean(${byLabel("Event title")})`, "All-day saved");
      await tap(byText("QA shared plan "+width), "Open all-day event", mobile);
      await until(textPresent("Group plans"), "All-day slot");
      assert.equal(await browser.evaluate(textPresent("Reminder 15 min before")),false);
      await tap(byLabel("Close details"), "Close slot", mobile);
      return {created:true,editedAllDay:true,reminderCleared:true};
    });
    await run("reminder-preference-and-empty-slot", async () => {
      const checkedState = `(() => { const node = ${byLabel("Group event reminders")}; const input = node?.matches('input') ? node : node?.querySelector('input'); return input ? input.checked : node?.getAttribute('aria-checked') === 'true'; })()`;
      const checked = await browser.evaluate(checkedState);
      await tap(byLabel("Group event reminders"), "Toggle reminder opt-in", mobile);
      await until(`(${checkedState}) !== ${JSON.stringify(checked)}`, "Reminder preference changed");
      await tap(byLabel("Group event reminders"), "Restore reminder opt-in", mobile);
      const empty = "Array.from(document.querySelectorAll('[aria-label$=\"0 items\"]')).find(node => node.getBoundingClientRect().width > 50)";
      await tap(empty,"Hold empty calendar slot",mobile,650);
      await until(`Boolean(${byLabel("Event title")})`,"Slot creates event");
      assert.equal(await browser.evaluate(`${byLabel("Event title")}.value`),"");
      await tap(byText("Cancel"),"Cancel unsaved slot event",mobile);
      await until(`!Boolean(${byLabel("Event title")})`,"Canceled editor");
      await shot("calendar-finished",width);
      return {initialOptIn:checked,longPress:true};
    });
  }
} finally {
  if (browser) { await browser.send("Browser.close").catch(() => undefined); browser.close(); }
  edge?.kill();
  await delay(350);
  const resolved = path.resolve(profile);
  assert.ok(resolved.startsWith(`${path.resolve(profiles)}${path.sep}`), "Profile cleanup escaped the dedicated test folder");
  fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  fs.writeFileSync(path.join(output, "report.json"), JSON.stringify({ baseUrl, testedAt: new Date().toISOString(), results, runtimeErrors: [...new Set(runtimeErrors)] }, null, 2));
}
if (results.some((result) => !result.passed) || runtimeErrors.length) process.exitCode = 1;
console.log(`Usability report: ${path.join(output, "report.json")}; ${results.filter((result) => result.passed).length}/${results.length} checks, ${runtimeErrors.length} runtime errors.`);
