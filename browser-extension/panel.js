import { getAppUrl } from "./config.js";

const frame = document.querySelector("#app");
const loading = document.querySelector("#loading");
const loadError = document.querySelector("#load-error");
const offline = document.querySelector("#offline");
const connectionLabel = document.querySelector("#connection-label");
const refreshButton = document.querySelector("#refresh");
const openSiteButton = document.querySelector("#open-site");
const retryButton = document.querySelector("#retry");
const signInButton = document.querySelector("#sign-in");

let appUrl = "";
let appOrigin = "";
let loadTimeout = 0;
let probeInterval = 0;
let companionReady = false;

function updateConnectivity() {
  const online = navigator.onLine;
  offline.hidden = online;
  connectionLabel.textContent = online
    ? companionReady
      ? "Companion ready"
      : "Connecting live companion…"
    : "Offline · changes sync later";
  connectionLabel.classList.toggle("online", online && companionReady);
  connectionLabel.classList.toggle("offline-label", !online);
}

function setLoading() {
  window.clearTimeout(loadTimeout);
  window.clearInterval(probeInterval);
  companionReady = false;
  frame.classList.remove("ready");
  loading.hidden = false;
  loadError.hidden = true;
  updateConnectivity();
  loadTimeout = window.setTimeout(() => {
    if (companionReady) return;
    window.clearInterval(probeInterval);
    loading.hidden = true;
    loadError.hidden = false;
  }, 15000);
}

function probeCompanion() {
  if (!appOrigin) return;
  frame.contentWindow?.postMessage(
    { type: "habhub:companion-ping", version: 1 },
    appOrigin,
  );
}

function markCompanionReady() {
  if (companionReady) return;
  companionReady = true;
  window.clearTimeout(loadTimeout);
  window.clearInterval(probeInterval);
  loading.hidden = true;
  loadError.hidden = true;
  frame.classList.add("ready");
  updateConnectivity();
}

function companionUrl(cacheBust = false) {
  // Expo Router resolves the companion by its clean route. Loading the emitted
  // static document directly preserves its filename in the pathname, so the
  // router correctly renders Unmatched Route instead of ExtensionDashboard.
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

frame.addEventListener("load", () => {
  if (companionReady) return;
  probeCompanion();
  window.clearInterval(probeInterval);
  probeInterval = window.setInterval(probeCompanion, 750);
});

window.addEventListener("message", (event) => {
  if (
    event.source !== frame.contentWindow ||
    event.origin !== appOrigin ||
    event.data?.type !== "habhub:companion-ready" ||
    event.data?.version !== 1
  )
    return;
  markCompanionReady();
});

window.addEventListener("online", updateConnectivity);
window.addEventListener("offline", updateConnectivity);
refreshButton.addEventListener("click", () => loadCompanion(true));
retryButton.addEventListener("click", () => loadCompanion(true));
openSiteButton.addEventListener("click", () => void openWebsite("/"));
signInButton.addEventListener("click", () => void openWebsite("/sign-in"));

appUrl = await getAppUrl();
appOrigin = new URL(appUrl).origin;
loadCompanion();
