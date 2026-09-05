import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (path) => fs.readFileSync(path, "utf8");
const appConfig = JSON.parse(read("app.json"));
const easConfig = JSON.parse(read("eas.json"));
const packageJson = JSON.parse(read("package.json"));
const workspace = read("pnpm-workspace.yaml");
const lockfile = read("pnpm-lock.yaml");
const patchPath = "patches/react-native@0.81.5.patch";
const patch = read(patchPath);
const installedReactNativePath = fs.realpathSync("node_modules/react-native");
const virtualStoreEntry = path.basename(
  path.dirname(path.dirname(installedReactNativePath)),
);

const buildProperties = appConfig.expo.plugins.find(
  (plugin) => Array.isArray(plugin) && plugin[0] === "expo-build-properties",
);
assert.equal(
  buildProperties?.[1]?.android?.buildReactNativeFromSource,
  true,
  "The ReactRootView fix cannot ship from the stock precompiled react-android AAR",
);
assert.match(
  workspace,
  /patchedDependencies:\s*[\s\S]*react-native@0\.81\.5:\s*patches\/react-native@0\.81\.5\.patch/,
);
assert.match(
  workspace,
  /^virtualStoreDirMaxLength:\s*60\s*$/m,
  "React Native source builds require a bounded pnpm virtual-store path",
);
assert.ok(
  virtualStoreEntry.length <= 60,
  `React Native virtual-store entry exceeds 60 characters: ${virtualStoreEntry}`,
);
assert.doesNotMatch(
  virtualStoreEntry,
  /=|patch_hash=/,
  `React Native virtual-store entry is unsafe for Prefab CLI arguments: ${virtualStoreEntry}`,
);
assert.equal(
  packageJson.scripts?.["eas-build-post-install"],
  "pnpm doctor && pnpm validate:rn-keyboard",
  "EAS must run Expo Doctor and the native keyboard packaging guard before Gradle",
);
assert.equal(
  easConfig.build?.preview?.env?.ORG_GRADLE_PROJECT_reactNativeArchitectures,
  "arm64-v8a",
  "Preview source builds must stay arm64-only to fit the EAS build deadline",
);
assert.equal(
  easConfig.build?.production?.env?.ORG_GRADLE_PROJECT_reactNativeArchitectures,
  "arm64-v8a,armeabi-v7a",
  "Production source builds must cover 64-bit and legacy ARM phones without compiling non-phone ABIs past the EAS deadline",
);
assert.match(
  lockfile,
  /patchedDependencies:\s*[\s\S]*react-native@0\.81\.5:\s*[a-f0-9]{64}/,
  "The lockfile must bind React Native 0.81.5 to the committed patch",
);

assert.match(
  patch,
  /Keyboard\.addListener\('keyboardDidHide', this\._onKeyboardHide\)/,
);
assert.match(patch, /ViewCompat\.getRootWindowInsets\(getRootView\(\)\)/);
assert.match(
  patch,
  /mVisibleViewArea\.bottom \+ barInsets\.bottom/,
  "Android keyboard-hide coordinates must include the system bar inset",
);

const patchedFiles = [...patch.matchAll(/^diff --git a\/(.+?) b\//gm)].map(
  (match) => match[1],
);
assert.deepEqual(patchedFiles, [
  "Libraries/Components/Keyboard/KeyboardAvoidingView.js",
  "ReactAndroid/src/main/java/com/facebook/react/ReactRootView.java",
]);

const installedKeyboardAvoider = read(
  "node_modules/react-native/Libraries/Components/Keyboard/KeyboardAvoidingView.js",
);
const installedReactRootView = read(
  "node_modules/react-native/ReactAndroid/src/main/java/com/facebook/react/ReactRootView.java",
);
assert.match(
  installedKeyboardAvoider,
  /Keyboard\.addListener\('keyboardDidHide', this\._onKeyboardHide\)/,
  "The installed JS dependency does not contain the committed keyboard patch",
);
assert.match(installedReactRootView, /WindowInsetsCompat\.Type\.ime\(\)/);

console.log("React Native Android keyboard backport validation passed.");
