import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pngjs from "pngjs";

const { PNG } = pngjs;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
const exists = (relativePath) => fs.existsSync(path.join(repoRoot, relativePath));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseEnv(source) {
  return Object.fromEntries(
    source
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
}

function assertLegalUrls(env, sourceName) {
  const keys = [
    "EXPO_PUBLIC_PRIVACY_URL",
    "EXPO_PUBLIC_TERMS_URL",
    "EXPO_PUBLIC_SUPPORT_URL",
    "EXPO_PUBLIC_DELETE_ACCOUNT_URL",
  ];
  for (const key of keys) assert(env[key], `${sourceName} is missing ${key}.`);
  const values = keys.map((key) => env[key].replace(/\/$/, ""));
  assert(new Set(values).size === values.length, `${sourceName} legal URLs must be distinct.`);
  assert(values[0].endsWith("/privacy"), `${sourceName} privacy URL must end in /privacy.`);
  assert(values[1].endsWith("/terms"), `${sourceName} terms URL must end in /terms.`);
  assert(values[2].endsWith("/support"), `${sourceName} support URL must end in /support.`);
  assert(
    values[3].endsWith("/delete-account"),
    `${sourceName} deletion URL must end in /delete-account.`,
  );
}

function readPng(relativePath) {
  assert(exists(relativePath), `Missing image asset: ${relativePath}`);
  return PNG.sync.read(fs.readFileSync(path.join(repoRoot, relativePath)));
}

function pixelStats(image) {
  let transparent = 0;
  let opaque = 0;
  let coloredVisible = 0;
  let nonWhiteVisible = 0;
  const colors = new Set();
  for (let offset = 0; offset < image.data.length; offset += 4) {
    const red = image.data[offset];
    const green = image.data[offset + 1];
    const blue = image.data[offset + 2];
    const alpha = image.data[offset + 3];
    if (alpha === 0) transparent += 1;
    if (alpha === 255) opaque += 1;
    if (alpha > 0) {
      if (!(red === green && green === blue)) coloredVisible += 1;
      if (red !== 255 || green !== 255 || blue !== 255) nonWhiteVisible += 1;
      if (colors.size < 16) colors.add(`${red},${green},${blue},${alpha}`);
    }
  }
  return { transparent, opaque, coloredVisible, nonWhiteVisible, colors };
}

const appConfig = JSON.parse(read("app.json")).expo;
assert(appConfig.icon === "./assets/images/habhub-store-icon.png", "Use the production store icon.");
const routerPlugin = appConfig.plugins.find(
  (plugin) => Array.isArray(plugin) && plugin[0] === "expo-router",
);
assert(
  routerPlugin?.[1]?.asyncRoutes?.web === "production",
  "Production web routes must stay split instead of shipping every feature at startup.",
);
assert(appConfig.android?.edgeToEdgeEnabled === true, "SDK 54 must be laid out edge-to-edge.");
assert(
  appConfig.android?.blockedPermissions?.includes("android.permission.RECORD_AUDIO"),
  "RECORD_AUDIO must stay blocked while HabHub has no recording feature.",
);
assert(
  appConfig.android?.blockedPermissions?.includes("android.permission.SYSTEM_ALERT_WINDOW"),
  "SYSTEM_ALERT_WINDOW must stay out of release manifests.",
);

const adaptiveIcon = appConfig.android?.adaptiveIcon ?? {};
assert(adaptiveIcon.backgroundImage, "Adaptive icon needs a dedicated background image.");
assert(adaptiveIcon.foregroundImage, "Adaptive icon needs a transparent foreground image.");
assert(adaptiveIcon.monochromeImage, "Adaptive icon needs a monochrome themed-icon image.");

const notificationsPlugin = appConfig.plugins.find(
  (plugin) => Array.isArray(plugin) && plugin[0] === "expo-notifications",
);
assert(notificationsPlugin, "expo-notifications must use explicit production configuration.");
const notificationOptions = notificationsPlugin[1] ?? {};
assert(notificationOptions.mode === "production", "iOS APNs entitlement mode must be production.");
assert(notificationOptions.defaultChannel === "paceboard", "Android default push channel must be paceboard.");
assert(notificationOptions.icon, "Android notifications need a dedicated small icon.");
assert(/^#[0-9A-F]{6}$/i.test(notificationOptions.color ?? ""), "Notification tint must be a hex color.");

const storeIcon = readPng("assets/images/habhub-store-icon.png");
assert(storeIcon.width === 1024 && storeIcon.height === 1024, "Store icon must be 1024x1024.");
const storeStats = pixelStats(storeIcon);
assert(storeStats.opaque === storeIcon.width * storeIcon.height, "Store icon must be fully opaque.");
assert(storeStats.coloredVisible > 10_000, "Store icon must contain the HabHub color mark.");

for (const asset of [
  "assets/images/habhub-adaptive-foreground.png",
  "assets/images/habhub-adaptive-monochrome.png",
  "assets/images/habhub-splash-mark.png",
]) {
  const image = readPng(asset);
  const stats = pixelStats(image);
  assert(image.width === 1024 && image.height === 1024, `${asset} must be 1024x1024.`);
  assert(stats.transparent > 100_000 && stats.opaque > 10_000, `${asset} needs transparent padding and visible art.`);
}

const monochrome = pixelStats(readPng("assets/images/habhub-adaptive-monochrome.png"));
assert(monochrome.nonWhiteVisible === 0, "Adaptive monochrome art must be white with alpha only.");
assert(
  notificationOptions.icon === "./assets/images/habhub-notification-icon.png",
  "Android notifications must use the generated native small icon.",
);
const notificationIcon = readPng("assets/images/habhub-notification-icon.png");
const notificationStats = pixelStats(notificationIcon);
assert(notificationIcon.width === 96 && notificationIcon.height === 96, "Notification icon must be 96x96.");
assert(notificationStats.transparent > 0, "Notification icon must have a transparent background.");
assert(notificationStats.nonWhiteVisible === 0, "Notification icon must be white with alpha only.");

for (const route of ["privacy", "terms", "support", "delete-account", "community-guidelines"]) {
  assert(exists(`app/${route}.tsx`), `Missing public /${route} route.`);
}
const layout = read("app/_layout.tsx");
for (const route of ["privacy", "terms", "support", "delete-account", "community-guidelines"]) {
  assert(layout.includes(`rootSegment === "${route}"`), `/${route} must bypass signed-out redirect.`);
  assert(layout.includes(`name="${route}"`), `/${route} must be registered in the root stack.`);
}

const signIn = read("app/sign-in.tsx");
for (const route of ["privacy", "terms", "support"]) {
  assert(signIn.includes(`router.push("/${route}"`), `Sign-in must link to /${route}.`);
}
const privacy = read("app/privacy.tsx");
for (const route of ["terms", "support", "delete-account"]) {
  assert(privacy.includes(`route="/${route}"`), `Privacy must link to /${route}.`);
}
for (const source of [read("app/terms.tsx"), read("app/support.tsx")]) {
  assert(
    source.includes('route="/community-guidelines"'),
    "Terms and support must link to the public Community Guidelines.",
  );
}
const settings = read("app/settings.tsx");
for (const route of ["privacy", "terms", "support", "delete-account", "community-guidelines"]) {
  assert(settings.includes(`router.push("/${route}"`), `Settings must link to /${route}.`);
}

assertLegalUrls(parseEnv(read(".env.example")), ".env.example");
if (exists(".env")) assertLegalUrls(parseEnv(read(".env")), ".env");

const capturePlan = JSON.parse(read("store/capture-plan.json"));
assert(capturePlan.screenshots?.length >= 8, "Capture plan needs at least eight feature scenes.");
const androidWidgetScene = capturePlan.screenshots.find((scene) => scene.id === "android-widgets");
assert(
  !androidWidgetScene ||
    (androidWidgetScene.platforms?.length === 1 && androidWidgetScene.platforms[0] === "google"),
  "If Android widgets are marketed, they must remain a Google-only scene.",
);
assert(
  !capturePlan.screenshots.some((scene) =>
    ["background-sync", "notification-tap", "native-video-export"].includes(scene.id),
  ),
  "Unverified native-only behavior must not appear in the store capture plan.",
);
const storeReadme = read("store/README.md");
assert(
  storeReadme.includes("in-app reporting") &&
    storeReadme.includes("blocking") &&
    storeReadme.includes("moderation"),
  "Store plan must retain explicit UGC safety release criteria.",
);
assert(read("app/terms.tsx").includes("reviewRequired"), "Terms must retain the legal-review notice.");
assert(read("app/privacy.tsx").includes("reviewRequired"), "Privacy policy must retain the legal-review notice.");

console.log(
  "Store routes, legal-link wiring, release icon assets, notification configuration, and capture plan validated.",
);
