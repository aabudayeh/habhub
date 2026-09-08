import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { Buffer } from "node:buffer";

const root = path.resolve(import.meta.dirname, "..");
const baseUrl = process.env.HABHUB_USABILITY_URL ?? "http://127.0.0.1:8091";
const port = Number(process.env.HABHUB_ONBOARDING_PORT ?? 9344);
const output = path.join(root, "store", "exports", "onboarding-web");
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
  throw new Error(`Timed out waiting for durable settings: ${label}`);
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
  fs.writeFileSync(path.join(output, `${width}-${name}.png`), Buffer.from(image.data, "base64"));
  assert.ok(layout.scrollWidth <= layout.width + 1, `${name}: horizontal overflow ${JSON.stringify(layout)}`);
  return layout;
}

async function navigate(route, ready) {
  await browser.send("Page.navigate", { url: "about:blank" });
  await until("location.href === 'about:blank'", "Fresh isolated document");
  await browser.send("Storage.clearDataForOrigin", { origin: new URL(baseUrl).origin, storageTypes: "all" });
  await browser.send("Page.navigate", { url: `${baseUrl}${route}` });
  await until(textPresent(ready), ready);
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
    await run("guided-live-personalization",async()=>{
      await navigate("/onboarding","Build a Today page that works for you");
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
      await until(textPresent("Make Today yours"),"Live tracker choices");
      const route=await browser.evaluate("location.pathname");
      assert.equal(await browser.evaluate(textPresent("Your starter dashboard")),false,"No second setup form");
      assert.equal(await browser.evaluate(textPresent("Start with the navigation bar")),false,"Live setup is not an isolated example tour");
      await delay(700);
      const before = await snapshot();
      assert.ok(before?.settings?.onboardingComplete, "Live setup uses the persisted app account");
      const chip = byTestId("live-setup-tracker-steps");
      const original = await browser.evaluate(chip+".getAttribute('aria-checked')");
      await tap(chip,"Toggle real Steps tile",mobile);
      await until(chip+".getAttribute('aria-checked') !== "+JSON.stringify(original),"Live tracker toggled");
      const changed = await savedSnapshot(value =>
        value?.metrics?.find(metric => metric.id === 'steps')?.sections.today === (original !== 'true'),
      "Steps visibility changed");
      assert.equal(changed.metrics.find(metric=>metric.id==='steps').sections.today, original !== 'true');
      assert.deepEqual(changed.entries, before.entries, "Tracker selection must not add/delete/edit any real or demo history");
      await tap(chip,"Restore Steps tile",mobile);
      await shot("guided-live-trackers",width);
      await tap(byLabel("Continue live setup"),"Live layout step",mobile);
      await until(textPresent("Keep only what helps"),"Live layout choices");
      const pref=byLabel("Show To-dos on Today");
      const isChecked="(() => { const n="+pref+"; return n.matches('input')?n.checked:(n.querySelector('input')?.checked??n.getAttribute('aria-checked')==='true'); })()";
      const prior=await browser.evaluate(isChecked);
      await tap(pref,"Toggle live Today To-Dos",mobile);
      await until("("+isChecked+") !== "+JSON.stringify(prior),"Live layout changed");
      const layoutSaved = await savedSnapshot(value => value?.settings?.showTodosToday === !prior,
        "Today To-Dos visibility changed");
      assert.equal(layoutSaved.settings.showTodosToday,!prior);
      await browser.send("Page.reload");
      await until(textPresent("Keep only what helps"),"Live setup resumes after refresh");
      assert.equal((await snapshot()).settings.showTodosToday,!prior,"Layout survives refresh");
      await tap(pref,"Restore To-Dos",mobile);
      await shot("guided-live-layout",width);
      await tap(byLabel("Continue live setup"),"First-log step",mobile);
      await until(textPresent("Try your first real log"),"First real log prompt");
      await tap(byText("Open Log"),"Open actual Log page",mobile);
      await until(textPresent("Only log a real value"),"Contextual real-entry explanation");
      assert.equal(await browser.evaluate("location.pathname"),"/log");
      await shot("guided-live-log",width);
      await tap(byText("Continue setup on Today"),"Return without logging",mobile);
      await until(textPresent("Your app is ready to explore"),"Explore step");
      await tap(byLabel("Finish live setup"),"Finish nonblocking setup",mobile);
      await until("!"+byTestId("live-setup-coach"),"Live setup finished");
      await delay(500);
      const after=await savedSnapshot(value=>value?.settings?.guidedSetupStep === "complete", "Live setup completed");
      assert.deepEqual(after.entries,before.entries,"Finishing/skipping logging never manufactures an entry");
      assert.equal(after.settings.guidedSetupStep,"complete");
      assert.equal(after.group.members.find(member=>member.id===after.currentUserId).name,"Jordan");
      await shot("guided-live-finished",width);
      return {welcomeScreens:1,liveSteps:4,name:"Jordan",selected,route,historyPreserved:true,refreshResume:true};
    });
    await run("classic-five-stages",async()=>{
      await navigate("/onboarding","Build a Today page that works for you");
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
      await shot("classic-finished",width);
      return {stages:5,route:await browser.evaluate("location.pathname")};
    });
    await run("skip-all-tutorials-persists",async()=>{
      await navigate("/onboarding","Build a Today page that works for you");
      await tap(byText("Guided setup"),"Guided setup",mobile);
      await until(textPresent("What matters to you?"),"Guided start");
      await enterName();
      await tap(byLabel("Skip all tutorials"),"Disable all automatic tutorials",mobile);
      await until(byLabel("Skip all tutorials")+".getAttribute('aria-checked') === 'true'","Skip-all checked state");
      await tap(byText("Make Today mine"),"Enter without tips",mobile);
      await until("location.pathname === '/'", "Skip-all enters Today");
      await delay(700);
      assert.equal(await browser.evaluate("Boolean("+byTestId("live-setup-coach")+")"),false);
      assert.equal((await snapshot()).settings.tutorialPromptsDisabled,true);
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
      return {globalOptOut:true,persistedAfterRefresh:true,newPagePromptSuppressed:true,manualGuideAvailable:true};
    });
  }
} finally {
  if (browser) { await browser.send("Browser.close").catch(()=>undefined); browser.close(); }
  edge?.kill();
  await delay(350);
  const resolved=path.resolve(profile);
  assert.ok(resolved.startsWith(path.resolve(profiles)+path.sep),"Profile cleanup escaped dedicated test folder");
  fs.rmSync(resolved,{recursive:true,force:true,maxRetries:5,retryDelay:300});
  fs.writeFileSync(path.join(output,"report.json"),JSON.stringify({baseUrl,testedAt:new Date().toISOString(),results,runtimeErrors:[...new Set(runtimeErrors)]},null,2));
}
if(results.some(result=>!result.passed)||runtimeErrors.length) process.exitCode=1;
console.log("Onboarding report: "+path.join(output,"report.json")+"; "+results.filter(result=>result.passed).length+"/"+results.length+" checks, "+runtimeErrors.length+" runtime errors.");
