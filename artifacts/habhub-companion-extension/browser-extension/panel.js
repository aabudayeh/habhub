import { getAppUrl } from "./config.js";

const frame = document.querySelector("#app");
const loading = document.querySelector("#loading");
const loadError = document.querySelector("#load-error");
const authRequired = document.querySelector("#auth-required");
const authTitle = document.querySelector("#auth-title");
const authCopy = document.querySelector("#auth-copy");
const offline = document.querySelector("#offline");
const connectionLabel = document.querySelector("#connection-label");
const refreshButton = document.querySelector("#refresh");
const openPanelButton = document.querySelector("#open-panel");
const openSiteButton = document.querySelector("#open-site");
const retryButton = document.querySelector("#retry");
const signInButton = document.querySelector("#sign-in");
const authSignInButton = document.querySelector("#auth-sign-in");
const authRetryButton = document.querySelector("#auth-retry");

let appUrl = "";
let appOrigin = "";
let loadTimeout = 0;
let probeInterval = 0;
let companionReady = false;
let companionPhase = "loading";
let handshakeNonce = "";

function newNonce() {
  const bytes = new Uint32Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(36)).join("-");
}

function hideAllStates() {
  loading.hidden = true;
  loadError.hidden = true;
  authRequired.hidden = true;
}

function updateConnectivity() {
  const online = navigator.onLine;
  offline.hidden = online;
  if (!online) connectionLabel.textContent = "Offline - changes sync later";
  else if (companionReady) connectionLabel.textContent = "Live companion";
  else if (companionPhase === "signed-out") connectionLabel.textContent = "Sign in required";
  else if (companionPhase === "setup-required") connectionLabel.textContent = "Finish setup required";
  else if (companionPhase === "data-loading") connectionLabel.textContent = "Loading your HabHub data...";
  else if (companionPhase === "error") connectionLabel.textContent = "Companion unavailable";
  else connectionLabel.textContent = "Connecting live companion...";
  connectionLabel.classList.toggle("online", online && companionReady);
  connectionLabel.classList.toggle("offline-label", !online);
}

function setLoading() {
  window.clearTimeout(loadTimeout);
  window.clearInterval(probeInterval);
  companionReady = false;
  companionPhase = "loading";
  handshakeNonce = newNonce();
  frame.classList.remove("ready");
  hideAllStates();
  loading.hidden = false;
  updateConnectivity();
  loadTimeout = window.setTimeout(() => {
    if (
      companionReady ||
      companionPhase === "signed-out" ||
      companionPhase === "setup-required" ||
      companionPhase === "data-loading"
    ) return;
    hideAllStates();
    loadError.hidden = false;
    companionPhase = "error";
    updateConnectivity();
  }, 20000);
}

function probeCompanion() {
  if (!appOrigin || !handshakeNonce) return;
  frame.contentWindow?.postMessage(
    { type: "habhub:companion-ping", version: 2, nonce: handshakeNonce },
    appOrigin,
  );
}

function showAccountState(kind) {
  if (companionPhase === kind) {
    updateConnectivity();
    return;
  }
  companionPhase = kind;
  window.clearTimeout(loadTimeout);
  frame.classList.remove("ready");
  hideAllStates();
  authRequired.hidden = false;
  if (kind === "setup-required") {
    authTitle.textContent = "Finish HabHub setup";
    authCopy.textContent = "Open HabHub and finish onboarding once. Your live companion will then use the same account and settings.";
    authSignInButton.textContent = "Open HabHub setup";
  } else {
    authTitle.textContent = "Sign in to HabHub";
    authCopy.textContent = "Open HabHub once in this browser, sign in, then return here and retry.";
    authSignInButton.textContent = "Open HabHub sign in";
  }
  updateConnectivity();
}

function markCompanionReady() {
  companionReady = true;
  companionPhase = "ready";
  window.clearTimeout(loadTimeout);
  window.clearInterval(probeInterval);
  hideAllStates();
  frame.classList.add("ready");
  updateConnectivity();
}

function handleCompanionState(payload) {
  if (payload.authStatus === "signedOut" || payload.authStatus === "demo") {
    showAccountState("signed-out");
    return;
  }
  if (payload.setupRequired) {
    showAccountState("setup-required");
    return;
  }
  if (payload.authStatus !== "signedIn" || !payload.dataReady) {
    companionPhase = "data-loading";
    hideAllStates();
    loading.hidden = false;
    updateConnectivity();
    return;
  }
  markCompanionReady();
}

function companionUrl(cacheBust = false) {
  const url = new URL("/extension", appUrl);
  url.searchParams.set("surface", "browser-extension");
  if (cacheBust) url.searchParams.set("refresh", String(Date.now()));
  return url.toString();
}

function loadCompanion(cacheBust = false) {
  if (!appUrl) return;
  setLoading();
  frame.src = companionUrl(cacheBust);
}

async function openWebsite(path = "/") {
  const url = new URL(path, appUrl).toString();
  await chrome.tabs.create({ url });
}

async function openSidePanel() {
  const currentWindow = await chrome.windows.getCurrent();
  if (typeof currentWindow.id !== "number") throw new Error("No browser window is available.");
  await chrome.sidePanel.open({ windowId: currentWindow.id });
  window.close();
}

frame.addEventListener("load", () => {
  if (companionReady) return;
  probeCompanion();
  window.clearInterval(probeInterval);
  probeInterval = window.setInterval(probeCompanion, 700);
});

window.addEventListener("message", (event) => {
  if (
    event.source !== frame.contentWindow ||
    event.origin !== appOrigin ||
    event.data?.type !== "habhub:companion-state" ||
    event.data?.version !== 2 ||
    event.data?.nonce !== handshakeNonce
  ) return;
  handleCompanionState(event.data);
});

window.addEventListener("online", updateConnectivity);
window.addEventListener("offline", updateConnectivity);
refreshButton?.addEventListener("click", () => loadCompanion(true));
retryButton?.addEventListener("click", () => loadCompanion(true));
authRetryButton?.addEventListener("click", () => loadCompanion(true));
openSiteButton?.addEventListener("click", () => void openWebsite("/"));
openPanelButton?.addEventListener("click", () => void openSidePanel().catch(() => openWebsite("/extension")));
signInButton?.addEventListener("click", () => void openWebsite("/sign-in"));
authSignInButton?.addEventListener("click", () => {
  const path = companionPhase === "setup-required" ? "/onboarding" : "/sign-in";
  void openWebsite(path);
});

appUrl = await getAppUrl();
appOrigin = new URL(appUrl).origin;
loadCompanion();
