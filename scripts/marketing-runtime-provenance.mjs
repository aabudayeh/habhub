import { spawnSync } from "node:child_process";
import strictAssert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimeDescriptorName = "habhub-marketing-runtime.json";
export const guardedMarketingCaptures = {
  "08-status-avatar.jpg": "avatar",
  "25-menu.jpg": "menu",
};
const renderArtifactPaths = [
  "video/frames/en-US/15-status-avatar.png",
  "video/apple-frames/en-US/15-status-avatar.png",
  "video/feature-tour/frames/en-US/19-avatar.png",
  "video/feature-tour/frames/en-US/33-menu.png",
  "video/apple/en-US/habhub-apple-master-886x1920.mp4",
  "video/google/en-US/habhub-google-master-1080x1920.mp4",
  "video/feature-tour/en-US/habhub-comprehensive-feature-tour-1080x1920.mp4",
];

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function relativeFiles(directory, prefix = "") {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((item) => {
    assert(!item.isSymbolicLink(), `Capture provenance does not follow symlinks: ${item.name}`);
    const relative = `${prefix}${item.name}`;
    return item.isDirectory()
      ? relativeFiles(path.join(directory, item.name), `${relative}/`)
      : [relative];
  }).sort();
}

function hashFiles(root, names) {
  return names.map((name) => {
    const bytes = fs.readFileSync(path.join(root, name));
    return { path: name, bytes: bytes.length, sha256: sha256(bytes) };
  });
}

export function currentMarketingSourceHashes(root = repoRoot) {
  const spriteRoot = "assets/images/status-avatar-v2";
  const spriteFiles = relativeFiles(path.join(root, spriteRoot))
    .filter((name) => name.endsWith(".png"))
    .map((name) => `${spriteRoot}/${name}`);
  assert(spriteFiles.length > 0, "Avatar capture requires the actual current sprite assets.");
  const avatarPaths = [
    "src/components/BodyProgressAvatar.tsx",
    "src/components/StatusAvatarSimulator.tsx",
    "src/domain/statusAvatarAtlas.ts",
    "src/domain/statusAvatar.ts",
    "src/domain/statusAvatarSimulation.ts",
    "src/generated/statusAvatarSprites.ts",
    ...spriteFiles,
  ].sort();
  return {
    avatar: sha256(JSON.stringify(hashFiles(root, avatarPaths))),
    menu: sha256(JSON.stringify(hashFiles(root, ["app/menu.tsx"]))),
  };
}

function runtimeFiles(root) {
  const dist = path.join(root, "dist");
  return hashFiles(dist, relativeFiles(dist).filter((name) => name !== runtimeDescriptorName));
}

function localRuntimeDescriptor(root) {
  const descriptorPath = path.join(root, "dist", runtimeDescriptorName);
  assert(fs.existsSync(descriptorPath),
    "Capture needs a verified fresh export. Run node scripts/marketing-runtime-provenance.mjs --export-web first.");
  const descriptor = JSON.parse(fs.readFileSync(descriptorPath, "utf8"));
  assert(descriptor.schemaVersion === 1 && Array.isArray(descriptor.files), "Unknown capture-runtime provenance.");
  assert(JSON.stringify(descriptor.sourceHashes) === JSON.stringify(currentMarketingSourceHashes(root)),
    "The avatar or menu changed after the verified export. Export again before capturing.");
  const files = runtimeFiles(root);
  assert(files.length > 0 && JSON.stringify(descriptor.files) === JSON.stringify(files),
    "Local dist changed after its verified export. Do not capture an unstamped or partly replaced export.");
  assert(descriptor.exportSha256 === sha256(JSON.stringify(files)), "Invalid capture export fingerprint.");
  return descriptor;
}

export function runtimeEvidence(descriptor) {
  return {
    schemaVersion: descriptor.schemaVersion,
    sourceHashes: descriptor.sourceHashes,
    exportSha256: descriptor.exportSha256,
    exportedAt: descriptor.exportedAt,
  };
}

// Verify actual HTTP bytes, not just a descriptor which a stale server might
// still expose. The bounded workers also check every lazy route and body asset.
export async function verifyFrozenMarketingRuntime(baseUrl, root = repoRoot) {
  const origin = new URL(baseUrl);
  assert(["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname),
    "Auditable marketing capture must use the frozen local dist server.");
  const descriptor = localRuntimeDescriptor(root);
  const descriptorBytes = fs.readFileSync(path.join(root, "dist", runtimeDescriptorName));
  const fetched = await fetch(new URL(`/${runtimeDescriptorName}`, origin), {
    cache: "no-store", signal: AbortSignal.timeout(15_000),
  });
  assert(fetched.ok && sha256(new Uint8Array(await fetched.arrayBuffer())) === sha256(descriptorBytes),
    "The capture server is not serving the verified local export descriptor.");
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(8, descriptor.files.length) }, async () => {
    while (next < descriptor.files.length) {
      const item = descriptor.files[next++];
      const urlPath = item.path.split("/").map(encodeURIComponent).join("/");
      const response = await fetch(new URL(`/${urlPath}`, origin), {
        cache: "no-store", signal: AbortSignal.timeout(15_000),
      });
      assert(response.ok, `Capture runtime is missing ${item.path}.`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      assert(bytes.length === item.bytes && sha256(bytes) === item.sha256,
        `Capture server bytes do not match frozen dist: ${item.path}`);
    }
  }));
  // The source or export may have changed during the bounded HTTP scan.
  const after = localRuntimeDescriptor(root);
  assert(after.exportSha256 === descriptor.exportSha256, "Capture export changed during verification.");
  return runtimeEvidence(descriptor);
}

export function captureEvidencePath(imagePath) {
  return imagePath.replace(/\.jpg$/i, ".capture.json");
}

export function assertFreshCaptureEvidence(evidence, bytes, surfaces, label, root = repoRoot) {
  const runtime = evidence?.runtime;
  assert(runtime?.schemaVersion === 1 && /^[a-f0-9]{64}$/.test(runtime.exportSha256 ?? "") &&
    Number.isFinite(Date.parse(runtime.exportedAt)), `${label} lacks verified runtime provenance; recapture it.`);
  const current = currentMarketingSourceHashes(root);
  for (const surface of surfaces)
    assert(runtime.sourceHashes?.[surface] === current[surface],
      `${label} contains stale ${surface} rendering; recapture it from the current verified export.`);
  assert(evidence.outputSha256 === sha256(bytes), `${label} does not match its successful capture evidence.`);
}

export function readFreshMarketingCapture(imagePath, root = repoRoot) {
  const fileName = path.basename(imagePath);
  const surface = guardedMarketingCaptures[fileName];
  assert(surface, `No guarded marketing surface is defined for ${fileName}.`);
  const sidecar = captureEvidencePath(imagePath);
  assert(fs.existsSync(sidecar), `${fileName} lacks capture evidence; do not reuse an older screenshot.`);
  const evidence = JSON.parse(fs.readFileSync(sidecar, "utf8"));
  assertFreshCaptureEvidence(evidence, fs.readFileSync(imagePath), [surface], fileName, root);
  return evidence;
}

export function assertFreshMarketingRender(root = repoRoot) {
  const exportRoot = path.join(root, "store/exports");
  const proofPath = path.join(exportRoot, "changed-surfaces.render.json");
  assert(fs.existsSync(proofPath), "Avatar/menu ads need a verified rebuild: run the provenance helper with --render-marketing.");
  const proof = JSON.parse(fs.readFileSync(proofPath, "utf8"));
  assert(proof.schemaVersion === 1, "Unknown marketing render evidence.");
  for (const fileName of Object.keys(guardedMarketingCaptures)) {
    const imagePath = path.join(root, "store/source-captures/iphone-420x911", fileName);
    const capture = readFreshMarketingCapture(imagePath, root);
    assert(proof.sourceCaptures?.[fileName] === capture.outputSha256,
      `Marketing compositions predate the reviewed ${fileName}; rebuild all montage masters.`);
  }
  assert(JSON.stringify(proof.artifacts) === JSON.stringify(hashFiles(exportRoot, renderArtifactPaths)),
    "Avatar/menu frames or montage videos changed after their verified rebuild.");
  return proof;
}

function exportForMarketing(root) {
  const sourceHashes = currentMarketingSourceHashes(root);
  const descriptorPath = path.join(root, "dist", runtimeDescriptorName);
  // This is one owned generated descriptor, never a recursive source cleanup.
  fs.rmSync(descriptorPath, { force: true });
  const result = spawnSync(process.execPath, [
    path.join(root, "node_modules/expo/bin/cli"), "export", "--platform", "web", "--clear",
  ], { cwd: root, stdio: "inherit", windowsHide: true });
  assert(!result.error && result.status === 0, "Web export failed; no capture provenance was issued.");
  assert(JSON.stringify(currentMarketingSourceHashes(root)) === JSON.stringify(sourceHashes),
    "Avatar/menu source changed during export. Export again after those changes settle.");
  const files = runtimeFiles(root);
  assert(files.some((file) => file.path === "index.html") && files.some((file) => file.path.endsWith(".js")),
    "Successful export did not produce the expected web runtime.");
  fs.writeFileSync(descriptorPath, `${JSON.stringify({
    schemaVersion: 1, exportedAt: new Date().toISOString(), sourceHashes,
    exportSha256: sha256(JSON.stringify(files)), files,
  }, null, 2)}\n`);
  console.log(`Verified marketing runtime: ${descriptorPath}`);
}

function renderForMarketing(root) {
  const sourceCaptures = Object.fromEntries(Object.keys(guardedMarketingCaptures).map((fileName) => [
    fileName, readFreshMarketingCapture(path.join(root, "store/source-captures/iphone-420x911", fileName), root).outputSha256,
  ]));
  const result = spawnSync("powershell.exe", [
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(root, "scripts/build-store-marketing-assets.ps1"),
  ], { cwd: root, stdio: "inherit", windowsHide: true });
  assert(!result.error && result.status === 0, "Marketing rebuild failed; no render provenance was issued.");
  for (const [fileName, hash] of Object.entries(sourceCaptures)) {
    const capture = readFreshMarketingCapture(path.join(root, "store/source-captures/iphone-420x911", fileName), root);
    assert(capture.outputSha256 === hash, `${fileName} changed during the rebuild; render again.`);
  }
  const exportRoot = path.join(root, "store/exports");
  fs.writeFileSync(path.join(exportRoot, "changed-surfaces.render.json"), `${JSON.stringify({
    schemaVersion: 1, renderedAt: new Date().toISOString(), sourceCaptures,
    artifacts: hashFiles(exportRoot, renderArtifactPaths),
  }, null, 2)}\n`);
  console.log("Verified current-avatar/menu frames and all three montage masters.");
}

async function testProvenance() {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "habhub-marketing-provenance-test-"));
  let server;
  const write = (name, content) => {
    const destination = path.join(fixture, name);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, content);
  };
  try {
    for (const name of [
      "src/components/BodyProgressAvatar.tsx", "src/components/StatusAvatarSimulator.tsx", "src/domain/statusAvatarAtlas.ts",
      "src/domain/statusAvatar.ts", "src/generated/statusAvatarSprites.ts",
      "src/domain/statusAvatarSimulation.ts",
      "assets/images/status-avatar-v2/male/m00-a00.png", "app/menu.tsx",
    ]) write(name, `fixture:${name}`);
    write("dist/index.html", "<script src='/bundle.js'></script>");
    write("dist/bundle.js", "const fixture = 'reviewed human avatar';");
    write("dist/assets/body.png", "fixture body asset");
    const files = runtimeFiles(fixture);
    const descriptor = {
      schemaVersion: 1, exportedAt: new Date().toISOString(),
      sourceHashes: currentMarketingSourceHashes(fixture),
      exportSha256: sha256(JSON.stringify(files)), files,
    };
    write(`dist/${runtimeDescriptorName}`, `${JSON.stringify(descriptor)}\n`);
    let corruptResponse = false;
    server = http.createServer((request, response) => {
      if (corruptResponse && request.url === "/bundle.js") {
        response.end("old alien-renderer bundle");
        return;
      }
      const target = path.join(fixture, "dist", decodeURIComponent(request.url));
      if (!fs.existsSync(target)) response.writeHead(404).end();
      else response.end(fs.readFileSync(target));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const runtime = await verifyFrozenMarketingRuntime(baseUrl, fixture);
    strictAssert.deepEqual(runtime, runtimeEvidence(descriptor));
    const imageBytes = Buffer.from("captured current avatar");
    const evidence = { runtime, outputSha256: sha256(imageBytes) };
    assertFreshCaptureEvidence(evidence, imageBytes, ["avatar"], "fixture image", fixture);
    strictAssert.throws(() => assertFreshCaptureEvidence(evidence, Buffer.from("old screenshot"), ["avatar"], "fixture image", fixture), /does not match/);
    strictAssert.throws(() => assertFreshCaptureEvidence({ outputSha256: sha256(imageBytes) }, imageBytes, ["avatar"], "fixture image", fixture), /lacks verified/);
    corruptResponse = true;
    await strictAssert.rejects(verifyFrozenMarketingRuntime(baseUrl, fixture), /server bytes do not match/);
    corruptResponse = false;
    const avatarPath = "src/components/BodyProgressAvatar.tsx";
    write(avatarPath, "changed renderer");
    strictAssert.throws(() => assertFreshCaptureEvidence(evidence, imageBytes, ["avatar"], "fixture image", fixture), /stale avatar/);
    await strictAssert.rejects(verifyFrozenMarketingRuntime(baseUrl, fixture), /changed after the verified export/);
    write(avatarPath, `fixture:${avatarPath}`);
    const simulatorPath = "src/components/StatusAvatarSimulator.tsx";
    write(simulatorPath, "updated simulator accessibility");
    strictAssert.throws(() => assertFreshCaptureEvidence(evidence, imageBytes, ["avatar"], "fixture guide", fixture), /stale avatar/);
    write(simulatorPath, `fixture:${simulatorPath}`);
    write("app/menu.tsx", "menu without removed rows");
    // A menu-only edit must not unnecessarily invalidate the unchanged body still.
    assertFreshCaptureEvidence(evidence, imageBytes, ["avatar"], "fixture image", fixture);
    strictAssert.throws(() => assertFreshCaptureEvidence(evidence, imageBytes, ["avatar", "menu"], "fixture guide", fixture), /stale menu/);
    write("app/menu.tsx", "fixture:app/menu.tsx");
    write("app/unrelated.tsx", "unrelated page edit");
    strictAssert.deepEqual(currentMarketingSourceHashes(fixture), descriptor.sourceHashes);
    for (const fileName of Object.keys(guardedMarketingCaptures)) {
      const imageRelative = `store/source-captures/iphone-420x911/${fileName}`;
      write(imageRelative, imageBytes);
      write(captureEvidencePath(imageRelative), JSON.stringify(evidence));
    }
    for (const artifact of renderArtifactPaths) write(`store/exports/${artifact}`, `render:${artifact}`);
    const renderProof = {
      schemaVersion: 1,
      sourceCaptures: Object.fromEntries(Object.keys(guardedMarketingCaptures).map((name) => [name, evidence.outputSha256])),
      artifacts: hashFiles(path.join(fixture, "store/exports"), renderArtifactPaths),
    };
    write("store/exports/changed-surfaces.render.json", JSON.stringify(renderProof));
    assertFreshMarketingRender(fixture);
    write("store/exports/changed-surfaces.render.json", JSON.stringify({
      ...renderProof, sourceCaptures: { ...renderProof.sourceCaptures, "08-status-avatar.jpg": "old avatar screenshot" },
    }));
    strictAssert.throws(() => assertFreshMarketingRender(fixture), /predate the reviewed/);
    write("store/exports/changed-surfaces.render.json", JSON.stringify(renderProof));
    write(`store/exports/${renderArtifactPaths.at(-1)}`, "old comprehensive video");
    strictAssert.throws(() => assertFreshMarketingRender(fixture), /changed after their verified rebuild/);
    write("dist/assets/body.png", "changed local body asset");
    await strictAssert.rejects(verifyFrozenMarketingRuntime(baseUrl, fixture), /Local dist changed/);
    console.log("Marketing provenance tests passed: valid frozen bytes; rejected unstamped, changed-source, replaced-output, stale-menu, changed-served/local assets, stale compositions and replaced videos; unrelated source remains valid.");
  } finally {
    if (server) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
    assert(path.dirname(fixture) === path.resolve(os.tmpdir()) && path.basename(fixture).startsWith("habhub-marketing-provenance-test-"),
      "Refusing cleanup outside the owned temporary fixture.");
    fs.rmSync(fixture, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--export-web")) exportForMarketing(repoRoot);
  else if (process.argv.includes("--render-marketing")) renderForMarketing(repoRoot);
  else if (process.argv.includes("--self-test")) await testProvenance();
  else throw new Error("Choose --export-web, --render-marketing or --self-test; existing media cannot be stamped retroactively.");
}
