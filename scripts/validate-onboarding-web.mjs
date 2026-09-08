import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { Buffer } from "node:buffer";

const root = path.resolve(import.meta.dirname, "..");
const baseUrl = process.env.HABHUB_USABILITY_URL ?? "http://127.0.0.1:8091";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(baseUrl).hostname), "Snapshot fixtures must never run against a live account origin");
const cleanAccountFixture = JSON.parse(execFileSync(process.execPath, ["--no-warnings", "--experimental-strip-types", "--experimental-loader", "./scripts/typescript-resolver-loader.mjs", "scripts/validate-onboarding-account.mjs", "--emit-clean-fixture"], { cwd: root, encoding: "utf8" }));
assert.equal(cleanAccountFixture.settings.onboardingComplete, false);
assert.equal(cleanAccountFixture.todos.length, 0);
const port = Number(process.env.HABHUB_ONBOARDING_PORT ?? 9344);
const output = path.join(root, "store", "exports", "onboarding-web");
const profiles = path.join(output, "profiles");
fs.mkdirSync(profiles, { recursive: true });
const profile = fs.mkdtempSync(path.join(profiles, "edge-"));
const edgePath = process.env.HABHUB_EDGE_PATH ?? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const results = [];
const runtimeErrors = [];
const screenshots = [];
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
const byTestId = (id) => `document.querySelector('[data-testid="' + CSS.escape(${JSON.stringify(id)}) + '"]')`;
const byText = (text) => `Array.from(document.querySelectorAll('div,span,button,a')).find((node) => node.textContent === ${JSON.stringify(text)} && !Array.from(node.children).some((child) => child.textContent === ${JSON.stringify(text)}))?.closest('[role="button"],[tabindex="0"],button,a')`;

async function snapshot() {
  return browser.evaluate(`new Promise((resolve, reject) => {
    const request = indexedDB.open('habhub-durable-state-v1');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('large-state')) { db.close(); resolve(JSON.parse(localStorage.getItem('paceboard-state-v1') || 'null')); return; }
      const read = db.transaction('large-state', 'readonly').objectStore('large-state').get('paceboard-state-v1');
      read.onerror = () => { db.close(); reject(read.error); };
      read.onsuccess = () => { db.close(); resolve(JSON.parse(read.result || localStorage.getItem('paceboard-state-v1') || 'null')); };
    };
  })`);
}

async function savedSnapshot(predicate, label) {
  const end = Date.now() + 10000;
  while (Date.now() < end) {
    const value = await snapshot();
    if (predicate(value)) return value;
    await delay(200);
  }
  const observed = await snapshot();
  throw new Error(`Timed out waiting for durable settings: ${label}; observed ${JSON.stringify(observed ? { currentUserId: observed.currentUserId, metrics: observed.metrics?.length, entries: observed.entries?.length, todos: observed.todos?.length, completed: observed.settings?.onboardingComplete, skipped: observed.settings?.tutorialPromptsDisabled } : null)}`);
}

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
  const screenshot = path.join(output, `${width}-${name}.png`);
  fs.writeFileSync(screenshot, Buffer.from(image.data, "base64"));
  screenshots.push(screenshot);
  assert.ok(layout.scrollWidth <= layout.width + 1, `${name}: horizontal overflow ${JSON.stringify(layout)}`);
  return layout;
}

async function navigate(route, ready, fixture = "demo") {
  await browser.send("Page.navigate", { url: "about:blank" });
  await until("location.href === 'about:blank'", "Fresh isolated document");
  await browser.send("Storage.clearDataForOrigin", { origin: new URL(baseUrl).origin, storageTypes: "all" });
  const seedHook = fixture === "clean-account" ? await browser.send("Page.addScriptToEvaluateOnNewDocument", { source:
    `if (location.origin === ${JSON.stringify(new URL(baseUrl).origin)}) localStorage.setItem('paceboard-state-v1', ${JSON.stringify(JSON.stringify(cleanAccountFixture))});` }) : null;
  try {
    await browser.send("Page.navigate", { url: `${baseUrl}${route}` });
    await until(textPresent(ready), ready);
  } finally {
    if (seedHook) await browser.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: seedHook.identifier });
  }
  await delay(500);
}


try {
  await fetch(baseUrl).then((response) => { if (!response.ok) throw new Error('Web fixture returned '+response.status); });
  edge = spawn(edgePath, ["--headless=new", "--disable-gpu", "--disable-extensions", "--disable-sync", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port="+port, "--user-data-dir="+profile, "about:blank"], { windowsHide: true, stdio: "ignore" });
  let pages;
  for (let index = 0; index < 100; index += 1) {
    pages = await fetch("http://127.0.0.1:"+port+"/json/list").then(response=>response.json()).catch(()=>undefined);
    if (pages?.some(page=>page.webSocketDebuggerUrl)) break;
    await delay(150);
  }
  const page = pages?.find(candidate=>candidate.type==="page" && candidate.url==="about:blank");
  assert.ok(page?.webSocketDebuggerUrl, "Isolated Edge did not expose its page");
  browser = new Browser(page.webSocketDebuggerUrl); await browser.connect();
  await Promise.all([browser.send("Page.enable"), browser.send("Runtime.enable")]);
  await browser.send("Page.addScriptToEvaluateOnNewDocument", { source: "(() => { if (location.origin !== "+JSON.stringify(new URL(baseUrl).origin)+") return; localStorage.setItem('paceboard-explicit-demo-mode-v1','true'); })()" });
  await browser.send("Emulation.setLocaleOverride",{locale:"en-US"});
  await browser.send("Emulation.setEmulatedMedia",{features:[{name:"prefers-reduced-motion",value:"reduce"}]});
  for (const width of process.env.HABHUB_ONBOARDING_WIDTHS ? process.env.HABHUB_ONBOARDING_WIDTHS.split(",").map(Number) : [320,390,1440]) {
    const mobile=width<500;
    await browser.send("Emulation.setDeviceMetricsOverride",{width,height:mobile?844:1000,deviceScaleFactor:1,mobile:false});
    await browser.send("Emulation.setTouchEmulationEnabled",{enabled:mobile});
    const run=async(name,work)=>{
      if (process.env.HABHUB_ONBOARDING_SCENARIOS && !process.env.HABHUB_ONBOARDING_SCENARIOS.split(",").includes(name)) return;
      try { const detail=await work(); results.push({width,name,passed:true,detail}); console.log("PASS "+width+" "+name); }
      catch(error) { results.push({width,name,passed:false,error:String(error)}); await shot("failure-"+name,width).catch(()=>undefined); console.error("FAIL "+width+" "+name+": "+error.message); }
    };
    const enterName = async()=>{
      await tap(byLabel("What should we call you?"),"Name input",mobile);
      await browser.send("Input.dispatchKeyEvent",{type:"keyDown",key:"a",code:"KeyA",windowsVirtualKeyCode:65,modifiers:2});
      await browser.send("Input.dispatchKeyEvent",{type:"keyUp",key:"a",code:"KeyA",windowsVirtualKeyCode:65,modifiers:2});
      await browser.send("Input.insertText",{text:"Jordan"});
      assert.equal(await browser.evaluate(byLabel("What should we call you?")+".value"),"Jordan");
      await browser.send("Input.dispatchKeyEvent",{type:"keyDown",key:"Tab",code:"Tab",windowsVirtualKeyCode:9});
      await browser.send("Input.dispatchKeyEvent",{type:"keyUp",key:"Tab",code:"Tab",windowsVirtualKeyCode:9});
      await delay(250);
    };
    await run("quick-guide-first-setup-redirect",async()=>{
      await navigate("/quick-guide","Automatic tutorial prompts");
      await tap(byTestId("quick-guide-live-setup"),"Begin first setup from Quick Guide",mobile);
      await until("location.pathname === '/onboarding'","Incomplete setup opens its actual welcome page");
      await until(textPresent("Build a Today page that works for you"),"Welcome choices remain available");
      assert.equal(await browser.evaluate(textPresent("Classic setup")),true);
      assert.equal(await browser.evaluate(textPresent("Guided setup")),true);
      await shot("quick-guide-starts-onboarding",width);
      return {route:"/onboarding",welcomeChoicesVisible:true};
    });
    await run("clean-account-guided-live-personalization",async()=>{
      await navigate("/onboarding","Build a Today page that works for you","clean-account");
      await shot("welcome",width);
      assert.equal(await browser.evaluate(textPresent("Classic setup")),true,"Classic choice remains available");
      const guided = await tap(byText("Guided setup"),"Guided setup",mobile);
      assert(guided.height>=44 && guided.width>=44);
      await until(textPresent("What matters to you?"),"Guided welcome");
      await enterName();
      const selected=[];
      for(const goal of ["Move more","Do it with friends"]) {
        const was=await browser.evaluate(byLabel(goal)+".textContent");
        const checked=await browser.evaluate(byLabel(goal)+".getAttribute('aria-checked')");
        assert.ok(checked === "true" || checked === "false", "Checkbox should expose its checked state: "+goal);
        const size=await tap(byLabel(goal),goal,mobile);
        await until(byLabel(goal)+".textContent !== "+JSON.stringify(was),"Goal selection icon toggled "+goal);
        await until(byLabel(goal)+".getAttribute('aria-checked') === "+JSON.stringify(checked === "true" ? "false" : "true"), "Screen-reader checked state toggled "+goal);
        assert(size.height>=44 && size.width>=44);
        selected.push(size);
      }
      await shot("guided-goals",width);
      await tap(byText("Make Today mine"),"Enter actual Today",mobile);
      await until("location.pathname === '/'", "Guided welcome enters Today directly");
      await until(textPresent("Add your first tracker"),"Compact live tracker guidance");
      const route=await browser.evaluate("location.pathname");
      assert.equal(await browser.evaluate(textPresent("Your starter dashboard")),false,"No second setup form");
      assert.equal(await browser.evaluate(textPresent("Start with the navigation bar")),false,"Live setup is not an isolated example tour");
      const before = await savedSnapshot(value => value?.settings?.onboardingComplete && value.metrics.length === 0,"Empty guided account saved");
      assert.ok(before?.settings?.onboardingComplete, "Live setup uses the persisted app account");
      assert.equal(before.currentUserId, cleanAccountFixture.currentUserId,"Actual clean-account identity, not seeded demo persona");
      assert.equal(before.settings.energyProfile.bodyFatPercent,undefined,"Unknown body fat stays unknown after hydration");
      assert.equal(before.settings.energyProfile.leanBodyMassKg,undefined,"Unknown lean mass stays unknown after hydration");
      for (const key of ["entries","photos","todos","journalNotes","calendarReminders","gymPlans","gymSessions"]) assert.deepEqual(before[key],[],key+" begins empty");
      const coachHeight = await browser.evaluate(byTestId("live-setup-coach")+".getBoundingClientRect().height");
      assert.ok(coachHeight <= 210,"The live coach must stay compact at "+width+"px: "+coachHeight);
      assert.equal(await browser.evaluate(textPresent("Google Health for web")),false,"No health disclosure during guided Today (offline local fixture)");
      assert.equal(await browser.evaluate("Boolean("+byTestId("today-featured-card")+")"),false,"An empty guided Today hides its zero-of-zero featured summary");
      await shot("guided-empty-today",width);
      await tap(byTestId("live-setup-add-trackers"),"Open actual ready-made/custom tracker editor",mobile);
      await until(textPresent("Add something to track"),"Actual tracker editor");
      assert.equal(await browser.evaluate("location.pathname"),"/metric-editor");
      await tap(byLabel("Choose a ready-made tracker"),"Open real ready-made catalog",mobile);
      await tap(byText("Steps"),"Select Steps preset",mobile);
      await tap(byText("Water"),"Select Water preset",mobile);
      await until(textPresent("2 ready-made trackers selected"),"Real multi-tracker selection");
      await shot("guided-real-picker",width);
      await tap(byText("Add selected trackers"),"Save selected trackers through the real editor",mobile);
      await until("location.pathname === '/'","Picker save returns to Today");
      await until(textPresent("Add your first tracker"),"Guide remains available after real picker return");
      const chosen = await savedSnapshot(value=>value?.metrics?.some(metric=>metric.id==='water'),"Chosen real tracker persisted");
      assert.deepEqual(chosen.metrics.map(metric=>metric.id).sort(),["steps","water"]);
      assert.deepEqual(chosen.entries,[]); assert.deepEqual(chosen.todos,[]);
      assert.equal(await browser.evaluate("Boolean("+byTestId("today-featured-card")+")"),true,"Featured summary returns when the user adds real trackers");
      await shot("guided-live-trackers",width);
      await tap(byLabel("Continue live setup"),"Live layout step",mobile);
      await until(textPresent("Arrange Today"),"Live layout guidance");
      await tap(byText("Edit Today"),"Enter actual Today edit mode",mobile);
      await until(textPresent("Add existing"),"Actual edit tools visible");
      assert.equal(await browser.evaluate(textPresent("Create tracker")),true);
      assert.equal(await browser.evaluate(textPresent("Tracked goals")),true);
      await tap(byLabel("Hide trackers"),"Use the actual Today visibility control",mobile);
      await tap(byText("Done"),"Save actual Today layout",mobile);
      const layoutSaved = await savedSnapshot(value => value?.settings?.showGoalsToday === false,"Today tracker visibility changed");
      assert.equal(layoutSaved.settings.showGoalsToday,false);
      await browser.send("Page.reload");
      await until(textPresent("Arrange Today"),"Live setup resumes after refresh");
      assert.equal((await snapshot()).settings.showGoalsToday,false,"Layout survives refresh");
      await tap(byText("Edit Today"),"Reopen actual edit mode",mobile);
      await tap(byLabel("Show trackers"),"Restore tracker visibility",mobile);
      await tap(byText("Done"),"Finish real edit mode",mobile);
      await shot("guided-live-layout",width);
      await tap(byLabel("Continue live setup"),"First-log step",mobile);
      await until(textPresent("Build your own history"),"First real log prompt");
      await tap(byText("Open Log"),"Open actual Log page",mobile);
      await until(textPresent("Only log a real value"),"Contextual real-entry explanation");
      assert.equal(await browser.evaluate("location.pathname"),"/log");
      await shot("guided-live-log",width);
      await tap(byText("Continue setup on Today"),"Return without logging",mobile);
      await until(textPresent("Ready to explore"),"Explore step");
      await tap(byLabel("Finish live setup"),"Finish nonblocking setup",mobile);
      await until("!"+byTestId("live-setup-coach"),"Live setup finished");
      await delay(500);
      const after=await savedSnapshot(value=>value?.settings?.guidedSetupStep === "complete", "Live setup completed");
      assert.deepEqual(after.entries,before.entries,"Finishing/skipping logging never manufactures an entry");
      assert.deepEqual(after.todos,[],"No demo tasks inherited after real picker use");
      assert.deepEqual(after.metrics.map(metric=>metric.id).sort(),["steps","water"],"Finishing preserves chosen trackers; no fallback To-Dos tracker is added");
      assert.equal(after.settings.guidedSetupStep,"complete");
      assert.equal(after.group.members.find(member=>member.id===after.currentUserId).name,"Jordan");
      await shot("guided-live-finished",width);
      return {fixture:"actual createCleanAccountState snapshot; offline explicit-demo auth, not remote sign-up",welcomeScreens:1,liveSteps:4,name:"Jordan",selected,route,coachHeight,emptyHistory:true,realPickerRoundTrip:true,realEditMode:true,refreshResume:true,selectedTrackersPreserved:true};
    });
    await run("intentional-demo-preserved",async()=>{
      // Onboarding intentionally defers background snapshots until its explicit
      // completion flush. Read the unchanged real demo from Quick Guide first.
      await navigate("/quick-guide","Automatic tutorial prompts");
      const before = await savedSnapshot(value=>value?.entries?.length>0 && value.todos?.length>0,"Intentional demo snapshot populated before onboarding");
      await tap(byTestId("quick-guide-live-setup"),"Open setup from actual Quick Guide",mobile);
      await until(textPresent("Build a Today page that works for you"),"Welcome opens");
      await tap(byText("Guided setup"),"Guided setup in intentional demo",mobile);
      await enterName();
      await tap(byText("Make Today mine"),"Open demo Today guide",mobile);
      await until(textPresent("Add your first tracker"),"Demo guide visible");
      await tap(byTestId("live-setup-skip-all"),"Finish demo tips without changing data",mobile);
      const after=await savedSnapshot(value=>value?.settings?.guidedSetupStep === "complete","Demo guide finished");
      assert.deepEqual(after.entries,before.entries);
      assert.deepEqual(after.todos,before.todos);
      assert.deepEqual(after.metrics,before.metrics);
      await shot("intentional-demo-preserved",width);
      return {fixture:"credential-free demo",entriesPreserved:after.entries.length,todosPreserved:after.todos.length,catalogPreserved:after.metrics.length};
    });
    await run("empty-guide-use-defaults",async()=>{
      await navigate("/onboarding","Build a Today page that works for you","clean-account");
      await tap(byText("Guided setup"),"Guided setup",mobile); await enterName();
      await tap(byText("Make Today mine"),"Begin empty guide",mobile);
      await until(textPresent("Add your first tracker"),"Empty Today guide");
      await tap(byText("Use defaults"),"Choose ordinary defaults without adding trackers",mobile);
      const after=await savedSnapshot(value=>value?.settings?.guidedSetupStep === "complete","Defaults persisted");
      assert.deepEqual(after.metrics.map(metric=>metric.id),["steps","water","todo_completion"]);
      assert.deepEqual(after.entries,[]); assert.deepEqual(after.todos,[]);
      assert.equal(after.settings.tutorialPromptsDisabled,false,"Use defaults finishes live setup without globally disabling page guides");
      assert.equal(await browser.evaluate("Boolean("+byTestId("today-featured-card")+")"),true,"Ordinary defaults retain the featured summary");
      await shot("empty-guide-defaults",width);
      return {fixture:"actual clean-account local snapshot",defaultTrackers:after.metrics.map(metric=>metric.id),noSampleHistory:true,pageGuidesRemainAvailable:true};
    });
    await run("empty-guide-close-skips-all",async()=>{
      await navigate("/onboarding","Build a Today page that works for you","clean-account");
      await tap(byText("Guided setup"),"Guided setup",mobile); await enterName();
      await tap(byText("Make Today mine"),"Begin empty live guide",mobile);
      await until(textPresent("Add your first tracker"),"Empty Today guide");
      const close = await tap(byTestId("live-setup-skip-all"),"Skip all tutorials from the live coach",mobile);
      assert.ok(close.height >= 44 && close.width >= 44,"Coach close remains a full-size accessible target");
      const after=await savedSnapshot(value=>value?.settings?.guidedSetupStep === "complete" && value.settings.tutorialPromptsDisabled,"Live global skip persisted");
      assert.deepEqual(after.metrics.map(metric=>metric.id),["steps","water","todo_completion"]);
      assert.deepEqual(after.entries,[]); assert.deepEqual(after.todos,[]);
      await browser.send("Page.reload");
      await until(textPresent("Your day"),"Today after skip-all refresh");
      assert.equal(await browser.evaluate("Boolean("+byTestId("live-setup-coach")+")"),false);
      assert.equal((await snapshot()).settings.tutorialPromptsDisabled,true);
      await shot("empty-guide-close-skips-all",width);
      return {fixture:"actual clean-account local snapshot",defaultTrackers:after.metrics.map(metric=>metric.id),noSampleHistory:true,globalOptOut:true,refreshPreserved:true,close};
    });
    await run("classic-five-stages",async()=>{
      await navigate("/onboarding","Build a Today page that works for you","clean-account");
      await tap(byText("Classic setup"),"Classic setup",mobile);
      await until(textPresent("Step 1 of 5"),"Classic stage one");
      await enterName();
      await shot("classic-goals",width);
      for(const [stage,title] of [[2,"Your starter dashboard"],[3,"Optional personal setup"],[4,"Connect what helps"],[5,"Ready when you are"]]) {
        await tap(byText("Continue"),"Classic continue",mobile);
        await until(textPresent("Step "+stage+" of 5"),"Classic stage "+stage);
        await until(textPresent(title),title);
        await shot("classic-stage-"+stage,width);
      }
      await tap(byText("Finish without the guide"),"Finish without guide",mobile);
      await tap(byText("Start using HabHub"),"Finish classic setup",mobile);
      await until("location.pathname !== '/onboarding'","Classic enters app");
      assert.equal(await browser.evaluate(textPresent("Start with the navigation bar")),false,"Classic finish should not force basic guide");
      const after=await savedSnapshot(value=>value?.settings?.onboardingComplete,"Classic clean account persisted");
      assert.deepEqual(after.entries,[]); assert.deepEqual(after.todos,[]);
      await shot("classic-finished",width);
      return {fixture:"actual clean-account local snapshot",stages:5,route:await browser.evaluate("location.pathname"),noSampleHistory:true};
    });
    await run("empty-guide-global-skip-from-quick-guide",async()=>{
      await navigate("/onboarding","Build a Today page that works for you","clean-account");
      await tap(byText("Guided setup"),"Guided setup",mobile); await enterName();
      await tap(byText("Make Today mine"),"Begin empty live guide",mobile);
      await until(textPresent("Add your first tracker"),"Empty Today guide");
      await savedSnapshot(value=>value?.settings?.onboardingComplete && value.metrics.length === 0,"Empty live setup durable");
      await browser.send("Page.navigate",{url:baseUrl+"/quick-guide"});
      await until(textPresent("Automatic tutorial prompts"),"Quick Guide preference");
      await tap(byTestId("tutorial-prompts-toggle"),"Turn off every automatic tutorial from Quick Guide",mobile);
      const after=await savedSnapshot(value=>value?.settings?.guidedSetupStep === "complete" && value.settings.tutorialPromptsDisabled,"Quick Guide global skip persisted");
      assert.deepEqual(after.metrics.map(metric=>metric.id),["steps","water","todo_completion"]);
      assert.deepEqual(after.entries,[]); assert.deepEqual(after.todos,[]);
      await browser.send("Page.reload");
      await until(textPresent("Automatic tutorial prompts"),"Quick Guide refresh");
      assert.equal((await snapshot()).settings.tutorialPromptsDisabled,true);
      await shot("quick-guide-empty-account-skip",width);
      return {fixture:"actual clean-account local snapshot",defaultTrackers:after.metrics.map(metric=>metric.id),noSampleHistory:true,globalOptOut:true,refreshPreserved:true};
    });
    await run("skip-all-tutorials-persists",async()=>{
      await navigate("/onboarding","Build a Today page that works for you","clean-account");
      await tap(byText("Guided setup"),"Guided setup",mobile);
      await until(textPresent("What matters to you?"),"Guided start");
      await enterName();
      await tap(byLabel("Skip all tutorials"),"Disable all automatic tutorials",mobile);
      await until(byLabel("Skip all tutorials")+".getAttribute('aria-checked') === 'true'","Skip-all checked state");
      await tap(byText("Make Today mine"),"Enter without tips",mobile);
      await until("location.pathname === '/'", "Skip-all enters Today");
      const skipped = await savedSnapshot(value=>value?.settings?.onboardingComplete && value?.settings?.tutorialPromptsDisabled,"Skipped clean setup persisted");
      assert.equal(await browser.evaluate("Boolean("+byTestId("live-setup-coach")+")"),false);
      assert.equal(skipped.settings.tutorialPromptsDisabled,true);
      assert.deepEqual(skipped.metrics.map(metric=>metric.id),["steps","water","todo_completion"]);
      assert.deepEqual(skipped.entries,[]); assert.deepEqual(skipped.todos,[]);
      await browser.send("Page.reload");
      await until(textPresent("Your day"),"Reload Today without tutorials");
      assert.equal((await snapshot()).settings.tutorialPromptsDisabled,true);
      await tap("document.querySelector('a[href=\"/insights\"]')","Explore Progress with tips disabled",mobile);
      await until("location.pathname === '/insights'","Progress opens");
      await delay(1800);
      assert.equal(await browser.evaluate("document.body.innerText.includes('First time on')"),false,"Global opt-out suppresses new-page prompts");
      await browser.send("Page.navigate",{url:baseUrl+"/quick-guide"});
      await until(textPresent("Automatic tutorial prompts"),"Global tutorial control remains discoverable");
      await shot("skip-all-quick-guide",width);
      assert.equal((await snapshot()).settings.tutorialPromptsDisabled,true);
      await tap(byTestId("quick-guide-full-course"),"Expand complete guide",mobile);
      await tap(byLabel("Watch Complete HabHub guide"),"Manually open a guide despite automatic opt-out",mobile);
      await until(textPresent("Start with the daily summary"),"Manual guide still opens");
      return {fixture:"actual clean-account local snapshot",defaultTrackers:skipped.metrics.map(metric=>metric.id),noSampleHistory:true,globalOptOut:true,persistedAfterRefresh:true,newPagePromptSuppressed:true,manualGuideAvailable:true};
    });
  }
} finally {
  if (browser) { await browser.send("Browser.close").catch(()=>undefined); browser.close(); }
  edge?.kill();
  await delay(350);
  const resolved=path.resolve(profile);
  assert.ok(resolved.startsWith(path.resolve(profiles)+path.sep),"Profile cleanup escaped dedicated test folder");
  fs.rmSync(resolved,{recursive:true,force:true,maxRetries:5,retryDelay:300});
  fs.writeFileSync(path.join(output,"report.json"),JSON.stringify({baseUrl,testedAt:new Date().toISOString(),fixtureScope:"Local UI with explicit-demo auth; clean-account cases use the exact createCleanAccountState snapshot before onboarding. No remote authentication, cloud write, or native permission claim.",results,screenshots,runtimeErrors:[...new Set(runtimeErrors)]},null,2));
}
if(results.some(result=>!result.passed)||runtimeErrors.length) process.exitCode=1;
console.log("Onboarding report: "+path.join(output,"report.json")+"; "+results.filter(result=>result.passed).length+"/"+results.length+" checks, "+runtimeErrors.length+" runtime errors.");
