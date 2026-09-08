import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { Buffer } from "node:buffer";

const root = path.resolve(import.meta.dirname, "..");
const baseUrl = process.env.HABHUB_USABILITY_URL ?? "http://127.0.0.1:8091";
const port = Number(process.env.HABHUB_USABILITY_PORT ?? 9342);
const hostedSmoke = process.env.HABHUB_USABILITY_HOSTED === "1";
const baseOrigin = new URL(baseUrl).origin;
assert.ok(!hostedSmoke || /^https:\/\/habhub(?:--[a-z0-9]+)?\.expo\.app$/.test(baseOrigin), "Hosted demo smoke tests are limited to HabHub hosting");
const output = path.join(root, "store", "exports", hostedSmoke ? "usability-web-hosted" : "usability-web");
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

function contrastRatio(foreground, background) {
  const luminance = (color) => {
    const rgb = color.match(/[\d.]+/g)?.slice(0, 3).map(Number);
    assert.equal(rgb?.length, 3, `Expected browser RGB color: ${color}`);
    const linear = rgb.map((channel) => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  };
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
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
    if (location.origin !== ${JSON.stringify(baseOrigin)}) return;
    if (${hostedSmoke}) {
      // Hosted checks must first opt into demo through the actual sign-in UI.
      if (localStorage.getItem('paceboard-explicit-demo-mode-v1') !== 'true') return;
    } else {
      if (!location.origin.startsWith('http://127.0.0.1')) return;
      localStorage.setItem('paceboard-explicit-demo-mode-v1','true');
    }
    localStorage.setItem('metric-rally-onboarding-complete-v1:demo:ahmad', JSON.stringify({completed:true,version:4,completedAt:new Date().toISOString()}));
    for (const key of ['demo%3Aahmad','ahmad']) localStorage.setItem('metric-rally-tutorial-first-visits-v1:'+key, JSON.stringify({pageIds:${JSON.stringify(pageIds)},updatedAt:new Date().toISOString()}));
  })()` });
  await browser.send("Emulation.setLocaleOverride", { locale: "en-US" });
  await browser.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  if (hostedSmoke) {
    await browser.send("Page.navigate", { url: `${baseUrl}/sign-in` });
    await until(textPresent("Try the full demo first"), "hosted explicit-demo entry");
    await tap(byText("Try the full demo first"), "Try the full demo first", false);
    await until("localStorage.getItem('paceboard-explicit-demo-mode-v1') === 'true'", "real demo opt-in");
  }
  for (const width of hostedSmoke ? [390] : [320, 390, 1440]) {
    const mobile = width < 500;
    await browser.send("Emulation.setDeviceMetricsOverride", { width, height: mobile ? 844 : 1000, deviceScaleFactor: 1, mobile: false });
    await browser.send("Emulation.setTouchEmulationEnabled", { enabled: mobile });
    const run = async (name, work) => {
      try { const detail = await work(); results.push({ width, name, passed: true, detail }); console.log(`PASS ${width} ${name}`); }
      catch (error) { results.push({ width, name, passed: false, error: String(error) }); await shot(`failure-${name}`, width).catch(() => undefined); console.error(`FAIL ${width} ${name}: ${error.message}`); }
    };
    await run("today-edit", async () => {
      await navigate("/", "Your day");
      await shot("today", width);
      const trackerNames = await browser.evaluate(`['Steps','Water','Sleep','Weight'].map(name => {
        const row = document.querySelector('[aria-label="'+name+'"]');
        const label = row && [...row.querySelectorAll('div,span')].find(node => node.textContent === name && !node.children.length);
        return { name, width: label?.getBoundingClientRect().width ?? null, fontSize: label ? getComputedStyle(label).fontSize : null };
      })`);
      if (width < 350)
        assert.equal(await browser.evaluate("document.querySelectorAll('[aria-label$=\" day streak\"]').length"), 0, "Narrow Today rows reserve width for tracker names, not streak chips");
      const target = await tap(byLabel("Customize Today"), "Customize Today", mobile);
      await until(textPresent("Done"), "Today edit mode");
      await shot("today-edit", width);
      await tap(byText("Done"), "Done", mobile);
      await until(`!Boolean(${byText("Done")})`, "leave edit mode");
      return { ...target, trackerNames };
    });
    await run("compact-menu", async () => {
      await navigate("/", "Your day");
      await tap(byLabel("Open menu"), "Open menu", mobile);
      await until(`Boolean(${byLabel("Cloud account & health sync")})`, "compact menu");
      assert.equal(await browser.evaluate(`Boolean(${byLabel("Find a page or setting")})`), false, "Menu must not restore the unwanted search field");
      assert.equal(await browser.evaluate(textPresent("Explore")), false, "Menu must not restore the unwanted Explore grid");
      const orderedSettings = await browser.evaluate(`(() => {
        const labels = ['Cloud account & health sync', 'Notifications', 'Display', 'Groups', 'Customize trackers', 'Quick guide', 'Legal & support'];
        return [...document.querySelectorAll('[role="button"][aria-label]')]
          .map(node => ({label: node.getAttribute('aria-label'), top: node.getBoundingClientRect().top}))
          .filter(item => labels.includes(item.label)).sort((a, b) => a.top - b.top).map(item => item.label);
      })()`);
      assert.deepEqual(orderedSettings.slice(-2), ["Quick guide", "Legal & support"], "Help destinations stay last in the requested order");
      await shot("menu", width);
      const target = await tap(byLabel("Notifications"), "Notifications destination", mobile);
      await until("location.pathname === '/notifications'", "Notifications destination route");
      await until(textPresent("Notifications"), "notification preferences");
      return target;
    });
    await run("compact-page-headers", async () => {
      const pages = [];
      for (const [route, title] of [["/", "Your day"], ["/log", "What are you adding?"], ["/group", "Leaderboard"], ["/insights", "Progress"], ["/gym", "Workout"]]) {
        await navigate(route, title);
        if (route === "/group") {
          await delay(1800);
          if (await browser.evaluate(`Boolean(${byText("Dismiss")})`)) await tap(byText("Dismiss"), "Dismiss previous demo challenge result", mobile);
        }
        await until("Boolean(document.querySelector('[data-testid=\"page-header\"]'))", `Header on ${route}`);
        const layout = await browser.evaluate(`(() => {
          const header = document.querySelector('[data-testid="page-header"]');
          const title = header.querySelector('[data-testid="page-header-title"]');
          const actions = header.querySelector('[data-testid="page-header-actions"]');
          const box = node => { const r = node.getBoundingClientRect(); return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}; };
          return {header:box(header),title:{...box(title),text:title.textContent,fontSize:getComputedStyle(title).fontSize,textOverflow:getComputedStyle(title).textOverflow,scrollWidth:title.scrollWidth,clientWidth:title.clientWidth},actions:box(actions),
            icons:[...header.querySelectorAll('[data-testid="header-icon"]')].map(node=>({...box(node),label:node.getAttribute('aria-label'),radius:getComputedStyle(node).borderRadius})),viewport:document.documentElement.clientWidth};
        })()`);
        assert.ok(layout.icons.length > 0, `${route} must expose its actual header icons`);
        for (const icon of layout.icons) {
          assert.equal(icon.width, 40, `${route} ${icon.label} must match Today width`);
          assert.equal(icon.height, 40, `${route} ${icon.label} must match Today height`);
          assert.equal(icon.radius, "13px");
          assert.ok(icon.left >= 0 && icon.right <= layout.viewport, `${route} ${icon.label} must stay onscreen`);
        }
        assert.ok(layout.title.right <= layout.actions.left + 1 || layout.title.bottom <= layout.actions.top, `${route} title must not overlap its actions`);
        assert.ok(layout.title.scrollWidth <= layout.title.clientWidth + 1, `${route} title must not overflow its available width`);
        assert.ok(layout.header.height <= 96, `${route} default header must stay compact`);
        if (route === "/log") {
          assert.equal(layout.title.text, "Log");
          assert.ok(await browser.evaluate(textPresent("What are you adding?")), "Log retains its complete question in the tracker selector");
        }
        if (route === "/group" && width < 360) assert.ok(layout.title.height < 32, "Leaderboard must not break its name mid-word");
        await shot(`header-${route === "/" ? "today" : route.slice(1)}`, width);
        pages.push({route,...layout});
      }
      return pages;
    });
    await run("quick-guide", async () => {
      await navigate("/", "Your day");
      await tap(byLabel("Open menu"), "Open menu", mobile);
      await tap(byLabel("Quick guide"), "Quick guide destination", mobile);
      await until(textPresent("Guided tutorials"), "tutorial library");
      assert.equal(await browser.evaluate(`Boolean(${byLabel("Watch Complete HabHub guide")})`), false, "Full course starts collapsed");
      const target = await tap("document.querySelector('[data-testid=\"quick-guide-full-course\"]')", "Expand complete course", mobile);
      await until(`Boolean(${byLabel("Watch Complete HabHub guide")})`, "full-course Watch control");
      await shot("quick-guide-expanded", width);
      await tap("document.querySelector('[data-testid=\"quick-guide-full-course\"]')", "Collapse complete course", mobile);
      await until(`!Boolean(${byLabel("Watch Complete HabHub guide")})`, "full course collapsed");
      return target;
    });
    await run("group-note-rich-editor", async () => {
      await navigate("/group-notes", "Group Notes");
      await tap(byLabel("Add group note"), "Create shared rich note", mobile);
      await until("Boolean(document.querySelector('[contenteditable=\"true\"]'))", "Shared rich-text composer");
      const controls = ["Undo", "Redo", "Heading 1", "Heading 2", "Bold", "Italic", "Strikethrough", "Text color", "Bullet list", "Checklist", "Quote", "Insert hyperlink"];
      const sizes = await browser.evaluate(`(${JSON.stringify(controls)}).map(label => {
        const node = document.querySelector('[aria-label="'+label+'"]'); const box = node?.getBoundingClientRect();
        return {label, width:box?.width,height:box?.height,left:box?.left,right:box?.right};
      })`);
      for (const control of sizes) assert.ok(control.width >= 40 && control.height >= 40 && control.left >= 0 && control.right <= width, `Readable formatting toolbar: ${JSON.stringify(control)}`);
      const title = `Shared rich note ${width}`;
      await tap("document.querySelector('input[placeholder=\"Title (optional)\"]')", "Note title", mobile);
      await browser.send("Input.insertText", { text: title });
      await tap("document.querySelector('[contenteditable=\"true\"]')", "Note body", mobile);
      await browser.send("Input.insertText", { text: "A shared plan" });
      await browser.send("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2 });
      await browser.send("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2 });
      await tap(byLabel("Bold"), "Bold selected shared text", mobile);
      await until("Boolean(document.querySelector('[contenteditable=\"true\"] strong, [contenteditable=\"true\"] b'))", "Bold editor markup");
      await shot("group-note-editor", width);
      await tap(byText("Save note"), "Save rich shared note", mobile);
      await until(`!Boolean(document.querySelector('[contenteditable="true"]')) && ${textPresent(title)}`, "Shared note saved");
      assert.equal(await browser.evaluate(textPresent("**A shared plan**")), false, "Cards render formatting rather than raw Markdown");
      await tap("document.querySelector('[aria-label=\"Edit note\"]')", "Reopen saved note", mobile);
      await until("Boolean(document.querySelector('[contenteditable=\"true\"] strong, [contenteditable=\"true\"] b'))", "Saved bold survives editor round trip");
      await tap(byLabel("Close editor"), "Close unchanged note", mobile);
      await until("!document.querySelector('[contenteditable=\"true\"]')", "Unchanged editor closes without prompt");
      await shot("group-note-saved", width);
      return {title, controls:sizes, mode:"credential-free local UI fixture; remote storage/RLS tested separately"};
    });
    await run("group-note-image-editor", async () => {
      await tap(byLabel("Add group note"), "Create image note", mobile);
      await until("Boolean(document.querySelector('[contenteditable=\"true\"]'))", "Image note editor");
      await browser.send("Page.setInterceptFileChooserDialog", { enabled: true });
      await tap(byText("Add image"), "Open real image picker", mobile);
      await until("Boolean(document.querySelector('input[type=\"file\"]'))", "Image picker file input");
      const { root: documentNode } = await browser.send("DOM.getDocument", { depth: -1, pierce: true });
      const { nodeId } = await browser.send("DOM.querySelector", { nodeId: documentNode.nodeId, selector: "input[type=file]" });
      const fixture = path.join(root, "assets", "images", "status-avatar-v2", "male", "m00-a00.png");
      assert.ok(fs.existsSync(fixture), "Use an existing harmless image fixture");
      await browser.send("DOM.setFileInputFiles", { nodeId, files: [fixture] });
      await browser.send("Page.setInterceptFileChooserDialog", { enabled: false });
      await until(`Boolean(${byLabel("Remove image")}) && !${textPresent("Opening…")}`, "Selected image preview");
      await shot("group-note-image", width);
      await tap(byText("Save note"), "Save image-only note", mobile);
      await until("!document.querySelector('[contenteditable=\"true\"]')", "Image-only note saved");
      await tap("document.querySelector('[aria-label=\"Edit note\"]')", "Reopen image-only note", mobile);
      await until(`Boolean(${byLabel("Remove image")})`, "Image retained when reopening");
      await tap(byLabel("Remove image"), "Remove attached image", mobile);
      await tap("document.querySelector('[contenteditable=\"true\"]')", "Add text after removing image", mobile);
      await browser.send("Input.insertText", { text: "Image removed; text retained." });
      await tap(byText("Save note"), "Save image removal", mobile);
      await until("!document.querySelector('[contenteditable=\"true\"]')", "Image removal saved");
      await tap("document.querySelector('[aria-label=\"Edit note\"]')", "Verify removed image", mobile);
      await until(textPresent("Image removed; text retained."), "Retained text");
      assert.equal(await browser.evaluate(`Boolean(${byLabel("Remove image")})`), false, "Removed image must not return on edit");
      await tap(byLabel("Close editor"), "Close verified note", mobile);
      return {imagePicker:"actual browser file input", image:"existing local PNG fixture", scope:"local UI only; no external upload"};
    });
    await run("group-note-unsaved-guard", async () => {
      await tap(byLabel("Add group note"), "Create unsaved note", mobile);
      await until("Boolean(document.querySelector('[contenteditable=\"true\"]'))", "Unsaved composer");
      await tap("document.querySelector('[contenteditable=\"true\"]')", "Unsaved text", mobile);
      await browser.send("Input.insertText", { text: "Discard this draft only." });
      await tap(byLabel("Close editor"), "Leave dirty note", mobile);
      await until(textPresent("Save this note?"), "Shared note unsaved guard");
      await shot("group-note-unsaved", width);
      await tap(byText("Keep editing"), "Keep draft", mobile);
      await until(`!${textPresent("Save this note?")}`, "Dismiss guard without losing draft");
      assert.ok(await browser.evaluate(textPresent("Discard this draft only.")), "Keep editing preserves body");
      await tap(byLabel("Close editor"), "Leave draft again", mobile);
      await until(textPresent("Save this note?"), "Guard reopens");
      await tap(byText("Discard"), "Discard unsaved shared draft", mobile);
      await until("!document.querySelector('[contenteditable=\"true\"]')", "Draft discarded");
      assert.equal(await browser.evaluate(textPresent("Discard this draft only.")), false, "Discard cannot publish the draft");
      return {keptDraft:true,discardedWithoutPublishing:true};
    });
    await run("info-popover", async () => {
      await navigate("/metric-editor?id=water&duplicate=1", "Duplicate Water");
      await tap(byText("Advanced settings"), "Advanced tracker settings", mobile);
      await until(`Boolean(${byLabel("About Step name")})`, "quick-entry help trigger");
      const target = await tap(byLabel("About Step name"), "Step name help", mobile);
      assert.ok(target.width >= 44 && target.height >= 44, `Help must be an actual 44px target: ${JSON.stringify(target)}`);
      await until(textPresent("A short singular label"), "help popover content");
      await shot("info-popover", width);
      // Choose the compact close button, not the full-screen dismiss layer.
      await tap(`Array.from(document.querySelectorAll('[aria-label="Close information"]')).find((node) => node.getBoundingClientRect().width < 100)`, "Close information", mobile);
      await until(`!${textPresent("A short singular label")}`, "help popover dismissed");
      return target;
    });
    await run("challenge-member-profile", async () => {
      await navigate("/group", "Leaderboard");
      await delay(1800);
      if (await browser.evaluate(`Boolean(${byText("Dismiss")})`))
        await tap(byText("Dismiss"), "Dismiss challenge result", mobile);
      const member = byLabel("View profile: Sarah");
      await until(`Boolean(${member})`, "Challenge member profile control");
      const target = await tap(member, "Challenge avatar and name", mobile);
      await until("location.pathname === '/member-profile/sarah'", "Challenge opens Sarah's profile");
      await until(textPresent("Badge showcase"), "Member profile loaded");
      await shot("challenge-member-profile", width);
      return { ...target, route: await browser.evaluate("location.pathname") };
    });
    await run("member-safety-spacing", async () => {
      // The local static fixture serves [id].html without production rewrites.
      // Reach this dynamic route through the same real in-app profile link.
      if (!await browser.evaluate(`location.pathname === '/member-profile/sarah' && ${textPresent("Badge showcase")}`)) {
        await navigate("/group", "Leaderboard");
        await delay(1800);
        if (await browser.evaluate(`Boolean(${byText("Dismiss")})`))
          await tap(byText("Dismiss"), "Dismiss challenge result", mobile);
        await tap(byLabel("View profile: Sarah"), "Open Sarah's profile", mobile);
      }
      await until(textPresent("Community safety"), "Member safety section");
      const spacing = await browser.evaluate(`(() => {
        const text = value => [...document.querySelectorAll('div,span')].find(node => node.textContent === value && !node.children.length);
        const isCard = node => { const style = getComputedStyle(node); return parseFloat(style.borderRadius) >= 12 && parseFloat(style.paddingLeft) >= 12 && node.getBoundingClientRect().width > 150; };
        let safety = text('Community safety'); while (safety && !isCard(safety)) safety = safety.parentElement;
        let badgeSection = text('Badge showcase'); let badgeCard;
        while (badgeSection && !badgeCard) { badgeCard = [...badgeSection.querySelectorAll('div')].find(isCard); badgeSection = badgeSection.parentElement; }
        if (!safety || !badgeCard) return null;
        safety.scrollIntoView({block:'end',behavior:'instant'});
        return {gap: safety.getBoundingClientRect().top - badgeCard.getBoundingClientRect().bottom, safetyWidth: safety.getBoundingClientRect().width, badgeWidth: badgeCard.getBoundingClientRect().width};
      })()`);
      assert.ok(spacing && spacing.gap >= 11.5, `Showcase and safety need at least 12px separation: ${JSON.stringify(spacing)}`);
      await shot("member-safety", width);
      return spacing;
    });
    await run("logged-exercise-done", async () => {
      await navigate("/gym", "Workout");
      if (!await browser.evaluate(textPresent("Logged exercises"))) {
        if (!await browser.evaluate(`Boolean(${byText("Full-body strength")})`))
          await tap(byText("Logged today"), "Expand logged workouts", mobile);
        await tap(byText("Full-body strength"), "Open logged strength workout", mobile);
      }
      await until(textPresent("Logged exercises"), "Logged workout editor");
      await tap(byText("Back squat"), "Hold logged exercise to edit", mobile, 750);
      await until(`Boolean(${byLabel("Done")})`, "Exercise edit Done button");
      const appearance = await browser.evaluate(`(() => {
        const button = ${byLabel("Done")};
        button.scrollIntoView({block:'center',behavior:'instant'});
        const text = [...button.querySelectorAll('div,span')].find(node => node.textContent === 'Done' && !node.children.length);
        const rect = button.getBoundingClientRect();
        return {width:rect.width,height:rect.height,text:text?.textContent,foreground:text ? getComputedStyle(text).color : '',background:getComputedStyle(button).backgroundColor,fontSize:text ? parseFloat(getComputedStyle(text).fontSize) : 0};
      })()`);
      assert.ok(appearance.width >= 44 && appearance.height >= 44, `Done needs a 44px target: ${JSON.stringify(appearance)}`);
      assert.equal(appearance.text, "Done", "Done must retain its visible text label");
      assert.ok(appearance.fontSize >= 12, "Done text must remain readable");
      const contrast = contrastRatio(appearance.foreground, appearance.background);
      assert.ok(contrast >= 4.5, `Done text contrast is too low: ${contrast.toFixed(2)}:1`);
      await shot("logged-exercise-edit", width);
      await tap(byLabel("Done"), "Finish exercise editing", mobile);
      await until(`!Boolean(${byLabel("Done")})`, "Exit exercise edit mode");
      return { ...appearance, contrastRatio: contrast };
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
