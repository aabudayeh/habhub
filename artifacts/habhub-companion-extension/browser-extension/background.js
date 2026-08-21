async function configureCompanion() {
  await chrome.sidePanel?.setOptions?.({
    path: "panel.html",
    enabled: true,
  });
  // Version 0.2 opened the side panel directly from the toolbar action. Clear
  // that persisted behavior so the action's normal popup can open first.
  await chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: false });
}

chrome.runtime.onInstalled.addListener(() => {
  void configureCompanion().catch(() => undefined);
});

chrome.runtime.onStartup.addListener(() => {
  void configureCompanion().catch(() => undefined);
});
