import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

import pngjs from "pngjs";

const { PNG } = pngjs;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const OUTPUT_WIDTH = 328;
const OUTPUT_HEIGHT = 512;
const BODY_CENTER = OUTPUT_WIDTH / 2;
const BODY_TOP = 6;
const BODY_HEIGHT = 500;
const ADIPOSITY_STATES = 20;
const MUSCLE_STATES = 10;

// These are measured alpha bounds from the approved v1 art. V2 preserves
// those frames as every other anchor, supersamples them, then bakes one new
// geometric midpoint between each pair. It never blends complete bodies.
const SOURCE = {
  male: {
    file: "status-avatar-male-atlas-v1.png",
    bodyCenters: [
      [86.5, 220, 356.5, 495, 629, 764.5, 901.5, 1036.5, 1169],
      [86, 220, 357, 494.5, 629, 764.5, 901.5, 1036.5, 1168.5],
      [86.5, 220, 357, 494.5, 629.5, 764.5, 901.5, 1036.5, 1168.5],
      [86.5, 219.5, 357, 494.5, 629, 764.5, 901.5, 1036.5, 1169],
      [86.5, 220, 356.5, 495, 629, 764.5, 901.5, 1036.5, 1168.5],
      [86.5, 220, 357, 495, 629, 764, 901.5, 1036, 1169],
      [86.5, 219.5, 356.5, 494.5, 629, 764, 901.5, 1036.5, 1168.5],
    ],
    bodyHeights: [152, 152, 153, 155, 156, 158, 155],
    bodyTops: [47, 216, 383, 556, 726, 897, 1067],
  },
  female: {
    file: "status-avatar-female-atlas-v1.png",
    bodyCenters: [
      [97.5, 239, 379.5, 521.5, 662.5, 804, 946, 1091.5],
      [97.5, 239, 379.5, 522, 662.5, 805, 946.5, 1093],
      [98, 239.5, 380.5, 522, 663.5, 805.5, 948.5, 1095],
      [98, 239.5, 381, 523.5, 664, 806, 949, 1095.5],
      [98.5, 240.5, 381, 523.5, 664.5, 806.5, 950, 1096.5],
      [99, 241, 382, 524, 665, 808, 951, 1097.5],
      [100, 242, 383.5, 525.5, 666.5, 809, 952.5, 1099.5],
    ],
    bodyHeights: [143, 146, 147, 147, 148, 148, 156],
    bodyTops: [43, 201, 365, 525, 683, 842, 1002],
  },
};

function lanczos(value, radius = 3) {
  const absolute = Math.abs(value);
  if (absolute < 1e-7) return 1;
  if (absolute >= radius) return 0;
  const piValue = Math.PI * value;
  return (
    (Math.sin(piValue) / piValue) *
    (Math.sin(piValue / radius) / (piValue / radius))
  );
}

function sourcePixel(image, x, y, channel) {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return 0;
  return image.data[(y * image.width + x) * 4 + channel];
}

function normalizedAnchor(image, config, row, column) {
  const sourceHeight = config.bodyHeights[row];
  const sourceTop = config.bodyTops[row];
  const sourceCenter = config.bodyCenters[row][column];
  const scale = BODY_HEIGHT / sourceHeight;
  const firstSourceY = Math.floor(sourceTop - (BODY_TOP + 3) / scale) - 3;
  const lastSourceY =
    Math.ceil(sourceTop + (OUTPUT_HEIGHT - BODY_TOP + 3) / scale) + 3;
  const horizontalHeight = lastSourceY - firstSourceY + 1;
  const horizontal = new Float32Array(horizontalHeight * OUTPUT_WIDTH * 4);

  // Premultiplied-alpha separable Lanczos avoids dark fringes around the
  // transparent silhouette while retaining the approved internal line work.
  for (let sourceY = firstSourceY; sourceY <= lastSourceY; sourceY += 1) {
    const horizontalY = sourceY - firstSourceY;
    for (let outputX = 0; outputX < OUTPUT_WIDTH; outputX += 1) {
      const mappedX = sourceCenter + (outputX + 0.5 - BODY_CENTER) / scale - 0.5;
      const left = Math.floor(mappedX) - 2;
      let weightTotal = 0;
      let alpha = 0;
      let red = 0;
      let green = 0;
      let blue = 0;
      for (let index = 0; index < 6; index += 1) {
        const sourceX = left + index;
        const weight = lanczos(mappedX - sourceX);
        if (!weight) continue;
        const pixelAlpha = sourcePixel(image, sourceX, sourceY, 3) / 255;
        weightTotal += weight;
        alpha += pixelAlpha * weight;
        red += sourcePixel(image, sourceX, sourceY, 0) * pixelAlpha * weight;
        green += sourcePixel(image, sourceX, sourceY, 1) * pixelAlpha * weight;
        blue += sourcePixel(image, sourceX, sourceY, 2) * pixelAlpha * weight;
      }
      const offset = (horizontalY * OUTPUT_WIDTH + outputX) * 4;
      const denominator = Math.abs(weightTotal) > 1e-7 ? weightTotal : 1;
      horizontal[offset] = red / denominator;
      horizontal[offset + 1] = green / denominator;
      horizontal[offset + 2] = blue / denominator;
      horizontal[offset + 3] = alpha / denominator;
    }
  }

  const output = new PNG({ width: OUTPUT_WIDTH, height: OUTPUT_HEIGHT });
  for (let outputY = 0; outputY < OUTPUT_HEIGHT; outputY += 1) {
    const mappedY = sourceTop + (outputY + 0.5 - BODY_TOP) / scale - 0.5;
    const top = Math.floor(mappedY) - 2;
    for (let outputX = 0; outputX < OUTPUT_WIDTH; outputX += 1) {
      let weightTotal = 0;
      let alpha = 0;
      let red = 0;
      let green = 0;
      let blue = 0;
      for (let index = 0; index < 6; index += 1) {
        const sourceY = top + index;
        const weight = lanczos(mappedY - sourceY);
        const horizontalY = sourceY - firstSourceY;
        if (!weight || horizontalY < 0 || horizontalY >= horizontalHeight)
          continue;
        const offset = (horizontalY * OUTPUT_WIDTH + outputX) * 4;
        weightTotal += weight;
        red += horizontal[offset] * weight;
        green += horizontal[offset + 1] * weight;
        blue += horizontal[offset + 2] * weight;
        alpha += horizontal[offset + 3] * weight;
      }
      const denominator = Math.abs(weightTotal) > 1e-7 ? weightTotal : 1;
      const resolvedAlpha = Math.max(0, Math.min(1, alpha / denominator));
      const outputOffset = (outputY * OUTPUT_WIDTH + outputX) * 4;
      if (resolvedAlpha <= 10 / 255) {
        output.data.fill(0, outputOffset, outputOffset + 4);
        continue;
      }
      const premultipliedMaximum = 255 * resolvedAlpha;
      const resolvedRed = Math.max(
        0,
        Math.min(premultipliedMaximum, red / denominator),
      );
      const resolvedGreen = Math.max(
        0,
        Math.min(premultipliedMaximum, green / denominator),
      );
      const resolvedBlue = Math.max(
        0,
        Math.min(premultipliedMaximum, blue / denominator),
      );
      output.data[outputOffset] = Math.round(
        resolvedRed / resolvedAlpha,
      );
      output.data[outputOffset + 1] = Math.round(
        resolvedGreen / resolvedAlpha,
      );
      output.data[outputOffset + 2] = Math.round(
        resolvedBlue / resolvedAlpha,
      );
      output.data[outputOffset + 3] = Math.round(resolvedAlpha * 255);
    }
  }
  return output;
}

function alphaBounds(image, threshold = 4) {
  let left = image.width;
  let right = -1;
  let top = image.height;
  let bottom = -1;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (image.data[(y * image.width + x) * 4 + 3] <= threshold) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < left || bottom < top) throw new Error("Generated sprite is empty");
  return {
    bottom,
    center: (left + right) / 2,
    height: bottom - top + 1,
    left,
    right,
    top,
    width: right - left + 1,
  };
}

function smoothStep(edge0, edge1, value) {
  const progress = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return progress * progress * (3 - 2 * progress);
}

function armAdiposityWeight(normalizedY) {
  // The source poses join the upper arm to the shoulder until roughly 32% of
  // body height, then separate from the torso down to the fingertips near 58%.
  // Ease both ends so the reconstructed limb cannot create a shoulder seam or
  // an oversized hand. The middle section receives the full proportional gain.
  const shoulderRelease = smoothStep(0.32, 0.39, normalizedY);
  const handRelease = 1 - smoothStep(0.52, 0.585, normalizedY);
  return shoulderRelease * handRelease;
}

function fatRegionWeight(normalizedY) {
  if (normalizedY < 0.12) return 0;
  if (normalizedY < 0.2) return 0.25;
  if (normalizedY < 0.35) return 0.58;
  if (normalizedY < 0.59) return 1;
  if (normalizedY < 0.76) return 0.88;
  if (normalizedY < 0.94) return 0.48;
  return 0.16;
}

function muscleRegionWeight(normalizedY) {
  if (normalizedY < 0.12) return 0;
  if (normalizedY < 0.2) return 0.48;
  if (normalizedY < 0.36) return 1;
  if (normalizedY < 0.56) return 0.36;
  if (normalizedY < 0.76) return 0.74;
  if (normalizedY < 0.94) return 0.62;
  return 0.18;
}

function premultipliedBilinear(image, mappedX, mappedY, output, offset) {
  const x0 = Math.floor(mappedX);
  const y0 = Math.floor(mappedY);
  const fx = mappedX - x0;
  const fy = mappedY - y0;
  let alpha = 0;
  let red = 0;
  let green = 0;
  let blue = 0;
  for (let yIndex = 0; yIndex < 2; yIndex += 1) {
    const y = y0 + yIndex;
    if (y < 0 || y >= image.height) continue;
    const yWeight = yIndex ? fy : 1 - fy;
    for (let xIndex = 0; xIndex < 2; xIndex += 1) {
      const x = x0 + xIndex;
      if (x < 0 || x >= image.width) continue;
      const weight = yWeight * (xIndex ? fx : 1 - fx);
      const pixelOffset = (y * image.width + x) * 4;
      const pixelAlpha = image.data[pixelOffset + 3] / 255;
      alpha += pixelAlpha * weight;
      red += image.data[pixelOffset] * pixelAlpha * weight;
      green += image.data[pixelOffset + 1] * pixelAlpha * weight;
      blue += image.data[pixelOffset + 2] * pixelAlpha * weight;
    }
  }
  const resolvedAlpha = Math.max(0, Math.min(1, alpha));
  if (resolvedAlpha <= 1 / 255) {
    output.fill(0, offset, offset + 4);
    return;
  }
  output[offset] = Math.round(Math.max(0, Math.min(255, red / resolvedAlpha)));
  output[offset + 1] = Math.round(
    Math.max(0, Math.min(255, green / resolvedAlpha)),
  );
  output[offset + 2] = Math.round(
    Math.max(0, Math.min(255, blue / resolvedAlpha)),
  );
  output[offset + 3] = Math.round(resolvedAlpha * 255);
}

function alphaRunsForRow(image, y, threshold = 16) {
  const runs = [];
  let start = -1;
  for (let x = 0; x < image.width; x += 1) {
    const visible = image.data[(y * image.width + x) * 4 + 3] > threshold;
    if (visible && start < 0) start = x;
    if ((!visible || x === image.width - 1) && start >= 0) {
      runs.push([start, visible ? x : x - 1]);
      start = -1;
    }
  }
  return runs;
}

function rowBodyAndArms(image, y) {
  const runs = alphaRunsForRow(image, y);
  const bodyIndex = runs.findIndex(
    ([left, right]) => left <= BODY_CENTER && right >= BODY_CENTER,
  );
  if (bodyIndex <= 0 || bodyIndex >= runs.length - 1) return undefined;
  const widest = (candidates) =>
    candidates
      .filter(([left, right]) => right - left >= 4)
      .sort(
        ([leftA, rightA], [leftB, rightB]) =>
          rightB - leftB - (rightA - leftA),
      )[0];
  const leftArm = widest(runs.slice(0, bodyIndex));
  const rightArm = widest(runs.slice(bodyIndex + 1));
  if (!leftArm || !rightArm) return undefined;
  return { body: runs[bodyIndex], leftArm, rightArm };
}

function drawScaledArm({
  destination,
  destinationRun,
  regionalWeight,
  reference,
  run,
  extensionProgress,
  y,
}) {
  const [sourceLeft, sourceRight] = run;
  const sourceCenter = (sourceLeft + sourceRight) / 2;
  const sourceHalfWidth = (sourceRight - sourceLeft + 1) / 2 + 1.5;
  const destinationCenter = (destinationRun[0] + destinationRun[1]) / 2;
  const destinationHalfWidth =
    (destinationRun[1] - destinationRun[0] + 1) / 2 + 1.5;
  // Blend out of the protected-torso result at the shoulder, then recover the
  // approved arm thickness and add a restrained high-adiposity gain. Keeping
  // the original arm centerline lets a large torso naturally meet the upper
  // arm instead of forcing the limb outward into a disconnected bulge.
  const resolvedReferenceHalfWidth =
    sourceHalfWidth * (1 + extensionProgress * regionalWeight * 0.14);
  const targetHalfWidth =
    destinationHalfWidth +
    (resolvedReferenceHalfWidth - destinationHalfWidth) * regionalWeight;
  const targetCenter =
    destinationCenter + (sourceCenter - destinationCenter) * regionalWeight;
  const scale = targetHalfWidth / sourceHalfWidth;
  const targetLeft = Math.max(0, Math.floor(targetCenter - targetHalfWidth - 1));
  const targetRight = Math.min(
    destination.width - 1,
    Math.ceil(targetCenter + targetHalfWidth + 1),
  );
  for (let x = targetLeft; x <= targetRight; x += 1) {
    const mappedX = sourceCenter + (x - targetCenter) / scale;
    const offset = (y * destination.width + x) * 4;
    premultipliedBilinear(reference, mappedX, y, destination.data, offset);
  }
}

function restoreProportionalArms(destination, reference, adiposityExtension) {
  if (adiposityExtension <= 0) return destination;
  const extensionProgress = Math.min(1, adiposityExtension / 7);
  for (let y = 0; y < destination.height; y += 1) {
    const normalizedY = Math.max(0, Math.min(1, (y - BODY_TOP) / BODY_HEIGHT));
    const regionalWeight = armAdiposityWeight(normalizedY);
    if (regionalWeight <= 0.001) continue;
    const referenceParts = rowBodyAndArms(reference, y);
    const destinationParts = rowBodyAndArms(destination, y);
    if (!referenceParts || !destinationParts) continue;
    drawScaledArm({
      destination,
      destinationRun: destinationParts.leftArm,
      extensionProgress,
      regionalWeight,
      reference,
      run: referenceParts.leftArm,
      y,
    });
    drawScaledArm({
      destination,
      destinationRun: destinationParts.rightArm,
      extensionProgress,
      regionalWeight,
      reference,
      run: referenceParts.rightArm,
      y,
    });
  }
  return destination;
}

function midpointSprite(
  anchors,
  rowCoordinate,
  columnCoordinate,
  adiposityExtension = 0,
  extensionReference,
) {
  const row = Math.floor(rowCoordinate);
  const column = Math.floor(columnCoordinate);
  const rowFraction = rowCoordinate - row;
  const columnFraction = columnCoordinate - column;
  const base = anchors[row][column];
  if (!rowFraction && !columnFraction && !adiposityExtension) return base;

  const baseBounds = alphaBounds(base);
  const nextColumn = anchors[row][Math.min(column + 1, anchors[row].length - 1)];
  const nextRow = anchors[Math.min(row + 1, anchors.length - 1)][column];
  const columnWidthRatio = alphaBounds(nextColumn).width / baseBounds.width;
  const rowWidthRatio = alphaBounds(nextRow).width / baseBounds.width;
  const output = new PNG({ width: OUTPUT_WIDTH, height: OUTPUT_HEIGHT });

  for (let y = 0; y < OUTPUT_HEIGHT; y += 1) {
    const normalizedY = Math.max(0, Math.min(1, (y - BODY_TOP) / BODY_HEIGHT));
    // The actual adjacent-frame width delta supplies the main morph. A small
    // sub-pixel floor ensures that equal integer alpha bounds still produce a
    // real intermediate frame after supersampling.
    const adiposityScale =
      1 +
      ((columnWidthRatio - 1) * columnFraction +
        columnFraction * 0.008) *
        fatRegionWeight(normalizedY);
    const muscleScale =
      1 +
      ((rowWidthRatio - 1) * rowFraction + rowFraction * 0.006) *
        muscleRegionWeight(normalizedY);
    const rawExtensionDelta =
      adiposityExtension * 0.038 * fatRegionWeight(normalizedY);
    for (let x = 0; x < OUTPUT_WIDTH; x += 1) {
      const distanceFromCenter = Math.abs(x - BODY_CENTER);
      // A stable, smoothly tapered central band widens the torso but reaches
      // zero before the outer forearms. This prevents the below-elbow drift in
      // very high adiposity states without detecting changing alpha edges (an
      // approach that produced visible seams). Below the hands, the taper
      // smoothly releases so hips and legs can retain the full progression.
      const centralTaper =
        1 - smoothStep(76, 100, distanceFromCenter);
      const upperBodyGuard = 1 - smoothStep(0.55, 0.66, normalizedY);
      const extensionWeight =
        1 - upperBodyGuard * (1 - centralTaper);
      const extensionScale = 1 + rawExtensionDelta * extensionWeight;
      const horizontalScale = adiposityScale * muscleScale * extensionScale;
      const mappedX = BODY_CENTER + (x - BODY_CENTER) / horizontalScale;
      const offset = (y * OUTPUT_WIDTH + x) * 4;
      premultipliedBilinear(base, mappedX, y, output.data, offset);
    }
  }
  return restoreProportionalArms(
    output,
    extensionReference ?? base,
    adiposityExtension,
  );
}

function spriteName(row, column) {
  return `m${String(row).padStart(2, "0")}-a${String(column).padStart(2, "0")}.png`;
}

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let current = value;
  for (let bit = 0; bit < 8; bit += 1)
    current = current & 1 ? 0xedb88320 ^ (current >>> 1) : current >>> 1;
  return current >>> 0;
});

function pngChunk(type, data = Buffer.alloc(0)) {
  const typeBuffer = Buffer.from(type, "ascii");
  const output = Buffer.alloc(data.length + 12);
  output.writeUInt32BE(data.length, 0);
  typeBuffer.copy(output, 4);
  data.copy(output, 8);
  let crc = 0xffffffff;
  for (let index = 4; index < output.length - 4; index += 1)
    crc = crcTable[(crc ^ output[index]) & 0xff] ^ (crc >>> 8);
  output.writeUInt32BE((crc ^ 0xffffffff) >>> 0, output.length - 4);
  return output;
}

function paletteFor(image) {
  const histogram = new Map();
  for (let offset = 0; offset < image.data.length; offset += 4) {
    const alpha = image.data[offset + 3];
    if (alpha <= 2) continue;
    const red = image.data[offset];
    const green = image.data[offset + 1];
    const blue = image.data[offset + 2];
    // Six-bit seed bins retain edge alpha and subtle navy/purple shading;
    // adaptive median-cut below reduces only the actually used bins to 255.
    const key =
      (Math.round(red / 4.047619) << 18) |
      (Math.round(green / 4.047619) << 12) |
      (Math.round(blue / 4.047619) << 6) |
      Math.round(alpha / 4.047619);
    const existing = histogram.get(key);
    if (existing) {
      existing.count += 1;
      existing.red += red;
      existing.green += green;
      existing.blue += blue;
      existing.alpha += alpha;
    } else {
      histogram.set(key, {
        alpha,
        blue,
        count: 1,
        green,
        key,
        red,
      });
    }
  }
  const entries = [...histogram.values()].map((entry) => ({
    ...entry,
    alphaValue: entry.alpha / entry.count,
    blueValue: entry.blue / entry.count,
    greenValue: entry.green / entry.count,
    redValue: entry.red / entry.count,
  }));
  const boxes = [entries];
  while (boxes.length < 255) {
    let splitIndex = -1;
    let splitChannel = "redValue";
    let splitScore = -1;
    for (let index = 0; index < boxes.length; index += 1) {
      const box = boxes[index];
      if (box.length < 2) continue;
      const ranges = {
        alphaValue:
          Math.max(...box.map((entry) => entry.alphaValue)) -
          Math.min(...box.map((entry) => entry.alphaValue)),
        blueValue:
          Math.max(...box.map((entry) => entry.blueValue)) -
          Math.min(...box.map((entry) => entry.blueValue)),
        greenValue:
          Math.max(...box.map((entry) => entry.greenValue)) -
          Math.min(...box.map((entry) => entry.greenValue)),
        redValue:
          Math.max(...box.map((entry) => entry.redValue)) -
          Math.min(...box.map((entry) => entry.redValue)),
      };
      const channel = Object.entries(ranges).sort((left, right) => right[1] - left[1])[0][0];
      const population = box.reduce((total, entry) => total + entry.count, 0);
      const score = ranges[channel] * Math.sqrt(population);
      if (score > splitScore) {
        splitChannel = channel;
        splitIndex = index;
        splitScore = score;
      }
    }
    if (splitIndex < 0) break;
    const box = boxes[splitIndex].sort(
      (left, right) => left[splitChannel] - right[splitChannel],
    );
    const population = box.reduce((total, entry) => total + entry.count, 0);
    let cumulative = 0;
    let middle = 1;
    for (; middle < box.length; middle += 1) {
      cumulative += box[middle - 1].count;
      if (cumulative >= population / 2) break;
    }
    boxes.splice(splitIndex, 1, box.slice(0, middle), box.slice(middle));
  }

  const palette = [[0, 0, 0, 0]];
  const indices = new Map();
  for (const box of boxes) {
    const total = box.reduce((sum, entry) => sum + entry.count, 0);
    const color = ["redValue", "greenValue", "blueValue", "alphaValue"].map(
      (channel) =>
        Math.round(
          box.reduce(
            (sum, entry) => sum + entry[channel] * entry.count,
            0,
          ) / total,
        ),
    );
    const paletteIndex = palette.length;
    palette.push(color);
    for (const entry of box) indices.set(entry.key, paletteIndex);
  }
  return { indices, palette };
}

function writePng(filePath, image) {
  const { indices, palette } = paletteFor(image);
  const rows = Buffer.alloc((image.width + 1) * image.height);
  for (let y = 0; y < image.height; y += 1) {
    const rowOffset = y * (image.width + 1);
    rows[rowOffset] = 0;
    for (let x = 0; x < image.width; x += 1) {
      const sourceOffset = (y * image.width + x) * 4;
      const alpha = image.data[sourceOffset + 3];
      if (alpha <= 2) {
        rows[rowOffset + x + 1] = 0;
        continue;
      }
      const key =
        (Math.round(image.data[sourceOffset] / 4.047619) << 18) |
        (Math.round(image.data[sourceOffset + 1] / 4.047619) << 12) |
        (Math.round(image.data[sourceOffset + 2] / 4.047619) << 6) |
        Math.round(alpha / 4.047619);
      rows[rowOffset + x + 1] = indices.get(key);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(image.width, 0);
  header.writeUInt32BE(image.height, 4);
  header[8] = 8;
  header[9] = 3;
  const colors = Buffer.alloc(palette.length * 3);
  const transparency = Buffer.alloc(palette.length);
  palette.forEach(([red, green, blue, alpha], index) => {
    colors[index * 3] = red;
    colors[index * 3 + 1] = green;
    colors[index * 3 + 2] = blue;
    transparency[index] = alpha;
  });
  fs.writeFileSync(
    filePath,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      pngChunk("IHDR", header),
      pngChunk("PLTE", colors),
      pngChunk("tRNS", transparency),
      pngChunk("IDAT", zlib.deflateSync(rows, { level: 9 })),
      pngChunk("IEND"),
    ]),
  );
}

function buildVariant(variant, config) {
  const atlasPath = path.join(root, "assets", "images", config.file);
  const atlas = PNG.sync.read(fs.readFileSync(atlasPath));
  const outputDirectory = path.join(
    root,
    "assets",
    "images",
    "status-avatar-v2",
    variant,
  );
  fs.rmSync(outputDirectory, { force: true, recursive: true });
  fs.mkdirSync(outputDirectory, { recursive: true });

  const anchors = config.bodyCenters.map((columns, row) =>
    columns.map((_, column) => normalizedAnchor(atlas, config, row, column)),
  );
  const adiposityStates = ADIPOSITY_STATES;
  const files = [];
  let totalBytes = 0;
  for (let row = 0; row < MUSCLE_STATES; row += 1) {
    const rowFiles = [];
    const rowCoordinate =
      (row * (config.bodyCenters.length - 1)) / (MUSCLE_STATES - 1);
    const sourceMaximum = config.bodyCenters[0].length - 1;
    const extensionReference = midpointSprite(
      anchors,
      rowCoordinate,
      sourceMaximum,
    );
    for (let column = 0; column < adiposityStates; column += 1) {
      const approvedColumn = Math.min(column, 12);
      const columnCoordinate = (approvedColumn * sourceMaximum) / 12;
      const adiposityExtension = Math.max(0, column - 12);
      const image =
        column === 12
          ? extensionReference
          : midpointSprite(
              anchors,
              rowCoordinate,
              columnCoordinate,
              adiposityExtension,
              extensionReference,
            );
      const name = spriteName(row, column);
      const filePath = path.join(outputDirectory, name);
      writePng(filePath, image);
      totalBytes += fs.statSync(filePath).size;
      rowFiles.push(name);
    }
    files.push(rowFiles);
  }
  return { adiposityStates, files, totalBytes };
}

function manifestSource(results) {
  const variants = ["female", "male"].map((variant) => {
    const rows = results[variant].files
      .map(
        (files) =>
          `    [\n${files
            .map(
              (file) =>
                `      require("../../assets/images/status-avatar-v2/${variant}/${file}"),`,
            )
            .join("\n")}\n    ],`,
      )
      .join("\n");
    return `  ${variant}: [\n${rows}\n  ],`;
  });
  return `// Generated by scripts/build-status-avatar-sprites.mjs. Do not edit by hand.\n` +
    `// Each entry is one normalized, supersampled, single-outline body.\n` +
    `export const STATUS_AVATAR_SPRITES = {\n${variants.join("\n")}\n} as const;\n`;
}

const results = {};
for (const variant of ["female", "male"])
  results[variant] = buildVariant(variant, SOURCE[variant]);

const generatedDirectory = path.join(root, "src", "generated");
fs.mkdirSync(generatedDirectory, { recursive: true });
fs.writeFileSync(
  path.join(generatedDirectory, "statusAvatarSprites.ts"),
  manifestSource(results),
  "utf8",
);

process.stdout.write(
  `Generated ${results.male.files.flat().length} male and ` +
    `${results.female.files.flat().length} female status sprites ` +
    `(${OUTPUT_WIDTH}x${OUTPUT_HEIGHT}; ${BODY_HEIGHT}px body; ` +
    `${((results.male.totalBytes + results.female.totalBytes) / 1_048_576).toFixed(2)} MiB).\n`,
);
