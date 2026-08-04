async function configureCompanion() {
  // Opening the side panel directly keeps the toolbar action useful instead of
  // making the user pass through a redirect-only popup first.
  await chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true });
}

chrome.runtime.onInstalled.addListener(() => {
  void configureCompanion();
});

chrome.runtime.onStartup.addListener(() => {
  void configureCompanion();
});
