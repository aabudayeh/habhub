import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pngjs from "pngjs";

const { PNG } = pngjs;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(repoRoot, "assets/images/habhub-icon.png");
const notificationSourcePath = path.join(
  repoRoot,
  "public/habhub-notification-badge-96.png",
);
const outputDirectory = path.join(repoRoot, "assets/images");
const NAVY = [8, 27, 73, 255];

function clamp(value, minimum = 0, maximum = 1) {
  return Math.max(minimum, Math.min(maximum, value));
}

function smoothstep(edge0, edge1, value) {
  const amount = clamp((value - edge0) / (edge1 - edge0));
  return amount * amount * (3 - 2 * amount);
}

function createCanvas(width, height, color = [0, 0, 0, 0]) {
  const image = new PNG({ width, height });
  for (let offset = 0; offset < image.data.length; offset += 4) {
    image.data[offset] = color[0];
    image.data[offset + 1] = color[1];
    image.data[offset + 2] = color[2];
    image.data[offset + 3] = color[3];
  }
  return image;
}

function extractBrandMark(source) {
  const mark = createCanvas(source.width, source.height);
  let minX = source.width;
  let minY = source.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const offset = (y * source.width + x) * 4;
      const red = source.data[offset];
      const green = source.data[offset + 1];
      const blue = source.data[offset + 2];
      const sourceAlpha = source.data[offset + 3] / 255;
      const maximum = Math.max(red, green, blue) / 255;
      const minimum = Math.min(red, green, blue) / 255;
      const chroma = maximum - minimum;
      const coral = red > 105 && red - green > 32 && red - blue > 20;
      const teal = green > 85 && blue > 75 && green - red > 34;
      const opacity =
        coral || teal
          ? sourceAlpha * smoothstep(0.27, 0.48, maximum) * smoothstep(0.13, 0.38, chroma)
          : 0;

      if (opacity <= 0.01) continue;
      mark.data[offset] = red;
      mark.data[offset + 1] = green;
      mark.data[offset + 2] = blue;
      mark.data[offset + 3] = Math.round(opacity * 255);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < minX || maxY < minY) throw new Error("Could not isolate the HabHub mark.");
  return { image: mark, bounds: { minX, minY, maxX, maxY } };
}

function samplePremultiplied(image, x, y) {
  const left = Math.max(0, Math.min(image.width - 1, Math.floor(x)));
  const top = Math.max(0, Math.min(image.height - 1, Math.floor(y)));
  const right = Math.min(image.width - 1, left + 1);
  const bottom = Math.min(image.height - 1, top + 1);
  const horizontal = clamp(x - left);
  const vertical = clamp(y - top);
  const weights = [
    [(1 - horizontal) * (1 - vertical), left, top],
    [horizontal * (1 - vertical), right, top],
    [(1 - horizontal) * vertical, left, bottom],
    [horizontal * vertical, right, bottom],
  ];
  let alpha = 0;
  let red = 0;
  let green = 0;
  let blue = 0;
  for (const [weight, sampleX, sampleY] of weights) {
    const offset = (sampleY * image.width + sampleX) * 4;
    const sampleAlpha = image.data[offset + 3] / 255;
    alpha += weight * sampleAlpha;
    red += weight * sampleAlpha * image.data[offset];
    green += weight * sampleAlpha * image.data[offset + 1];
    blue += weight * sampleAlpha * image.data[offset + 2];
  }
  if (alpha <= 0.001) return [0, 0, 0, 0];
  return [red / alpha, green / alpha, blue / alpha, alpha * 255];
}

function placeMark(mark, bounds, canvas, maximumSize) {
  const sourceWidth = bounds.maxX - bounds.minX + 1;
  const sourceHeight = bounds.maxY - bounds.minY + 1;
  const scale = maximumSize / Math.max(sourceWidth, sourceHeight);
  const outputWidth = Math.round(sourceWidth * scale);
  const outputHeight = Math.round(sourceHeight * scale);
  const startX = Math.round((canvas.width - outputWidth) / 2);
  const startY = Math.round((canvas.height - outputHeight) / 2);

  for (let y = 0; y < outputHeight; y += 1) {
    for (let x = 0; x < outputWidth; x += 1) {
      const sourceX = bounds.minX + (x + 0.5) / scale - 0.5;
      const sourceY = bounds.minY + (y + 0.5) / scale - 0.5;
      const [red, green, blue, alpha] = samplePremultiplied(mark, sourceX, sourceY);
      if (alpha <= 0) continue;
      const destinationOffset = ((startY + y) * canvas.width + startX + x) * 4;
      const sourceOpacity = alpha / 255;
      const destinationOpacity = canvas.data[destinationOffset + 3] / 255;
      const outputOpacity = sourceOpacity + destinationOpacity * (1 - sourceOpacity);
      canvas.data[destinationOffset] = Math.round(
        (red * sourceOpacity + canvas.data[destinationOffset] * destinationOpacity * (1 - sourceOpacity)) /
          outputOpacity,
      );
      canvas.data[destinationOffset + 1] = Math.round(
        (green * sourceOpacity + canvas.data[destinationOffset + 1] * destinationOpacity * (1 - sourceOpacity)) /
          outputOpacity,
      );
      canvas.data[destinationOffset + 2] = Math.round(
        (blue * sourceOpacity + canvas.data[destinationOffset + 2] * destinationOpacity * (1 - sourceOpacity)) /
          outputOpacity,
      );
      canvas.data[destinationOffset + 3] = Math.round(outputOpacity * 255);
    }
  }
  return canvas;
}

function makeMonochrome(source) {
  const output = createCanvas(source.width, source.height);
  for (let offset = 0; offset < source.data.length; offset += 4) {
    output.data[offset] = 255;
    output.data[offset + 1] = 255;
    output.data[offset + 2] = 255;
    output.data[offset + 3] = source.data[offset + 3];
  }
  return output;
}

function writePng(filename, image) {
  fs.writeFileSync(path.join(outputDirectory, filename), PNG.sync.write(image));
}

function writeProjectPng(relativePath, image) {
  fs.writeFileSync(path.join(repoRoot, relativePath), PNG.sync.write(image));
}

const source = PNG.sync.read(fs.readFileSync(sourcePath));
const notificationSource = PNG.sync.read(fs.readFileSync(notificationSourcePath));
const { image: mark, bounds } = extractBrandMark(source);
const storeIcon = placeMark(mark, bounds, createCanvas(1024, 1024, NAVY), 700);
const adaptiveForeground = placeMark(mark, bounds, createCanvas(1024, 1024), 610);
const splashMark = placeMark(mark, bounds, createCanvas(1024, 1024), 760);

writePng("habhub-store-icon.png", storeIcon);
writePng("habhub-adaptive-background.png", createCanvas(1024, 1024, NAVY));
writePng("habhub-adaptive-foreground.png", adaptiveForeground);
writePng("habhub-adaptive-monochrome.png", makeMonochrome(adaptiveForeground));
writePng("habhub-notification-icon.png", makeMonochrome(notificationSource));
writePng("habhub-splash-mark.png", splashMark);
writeProjectPng("public/habhub-icon.png", storeIcon);
writeProjectPng(
  "public/pwa-icon-512.png",
  placeMark(mark, bounds, createCanvas(512, 512, NAVY), 350),
);
writeProjectPng(
  "public/pwa-icon-192.png",
  placeMark(mark, bounds, createCanvas(192, 192, NAVY), 131),
);

console.log(
  "Generated HabHub native, PWA, adaptive, monochrome, notification, and splash assets.",
);
