import { getAppUrl } from "./config.js";

async function openPath(path) {
  const base = await getAppUrl();
  await chrome.tabs.create({ url: `${base}${path}` });
  window.close();
}

document.querySelectorAll("[data-path]").forEach((button) => {
  button.addEventListener("click", () => void openPath(button.dataset.path));
});
document.querySelector("#browser").addEventListener("click", () => void openPath("/"));
document.querySelector("#panel").addEventListener("click", async () => {
  const current = await chrome.windows.getCurrent();
  await chrome.sidePanel.open({ windowId: current.id });
  window.close();
});
