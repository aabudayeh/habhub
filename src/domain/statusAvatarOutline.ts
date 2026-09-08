import type { StatusAvatarGeometry } from "./statusAvatar";

const CENTER_X = 100;

type Point = readonly [number, number];
type BodySegment = {
  control1: Point;
  control2: Point;
  end: Point;
};

const point = ([x, y]: Point) => `${x.toFixed(6)} ${y.toFixed(6)}`;

function curve(control1: Point, control2: Point, end: Point): BodySegment {
  return { control1, control2, end };
}

/**
 * Builds one closed, symmetrical body silhouette. Fullness and muscle alter
 * only horizontal landmarks, so every combination keeps the same head,
 * height, baseline and human proportions.
 */
export function statusAvatarSilhouettePath(
  geometry: StatusAvatarGeometry,
) {
  const female = geometry.variant === "female";
  const {
    ankleHalf,
    calfHalf,
    chestHalf,
    elbowInnerHalf,
    elbowOuterHalf,
    headHalf,
    hipHalf,
    kneeHalf,
    neckHalf,
    shoulderHalf,
    thighHalf,
    upperArmInnerHalf,
    upperArmOuterHalf,
    waistHalf,
    wristInnerHalf,
    wristOuterHalf,
  } = geometry.body;
  const upperArmOuter = CENTER_X + upperArmOuterHalf;
  const elbowOuter = CENTER_X + elbowOuterHalf;
  const wristOuter = CENTER_X + wristOuterHalf;
  const wristInner = CENTER_X + wristInnerHalf;
  const elbowInner = CENTER_X + elbowInnerHalf;
  const upperArmInner = CENTER_X + upperArmInnerHalf;
  // Keep the complete head/jaw outline identical within each sex. Training may
  // widen the lower neck into the shoulders, but never changes the face.
  const faceNeckHalf = female
    ? 10
    : geometry.variant === "male"
      ? 12
      : 11;

  const start: Point = [CENTER_X, 8];
  const jawHalf = female ? 13.5 : geometry.variant === "male" ? 15 : 14.25;
  const head: BodySegment[] = [
    curve(
      [CENTER_X + headHalf * 0.62, 8],
      [CENTER_X + headHalf, 16],
      [CENTER_X + headHalf, 30],
    ),
    curve(
      [CENTER_X + headHalf, 35],
      [CENTER_X + headHalf - 0.5, 40],
      [CENTER_X + headHalf - 1, 43],
    ),
    curve(
      [CENTER_X + headHalf + 3.5, 42],
      [CENTER_X + headHalf + 4, 48],
      [CENTER_X + headHalf + 1.5, 52],
    ),
    curve(
      [CENTER_X + headHalf, 57],
      [CENTER_X + jawHalf + 2, 62],
      [CENTER_X + jawHalf, 64],
    ),
    curve(
      [CENTER_X + jawHalf - 1, 67],
      [CENTER_X + faceNeckHalf, 68],
      [CENTER_X + faceNeckHalf, 71],
    ),
    curve(
      [CENTER_X + faceNeckHalf, 75],
      [CENTER_X + faceNeckHalf, 78],
      [CENTER_X + faceNeckHalf + 0.5, 80],
    ),
  ];

  const segments: BodySegment[] = [
    ...head,
    // Shoulder to fingertips. Hands finish at upper-thigh level, as in the
    // reference silhouettes, rather than reaching toward the knees.
    curve(
      [CENTER_X + neckHalf + 8, 81],
      [CENTER_X + shoulderHalf - 8, 82],
      [CENTER_X + shoulderHalf, 87],
    ),
    curve(
      [CENTER_X + shoulderHalf + 7, 95],
      [upperArmOuter, 109],
      [upperArmOuter, 126],
    ),
    curve(
      [upperArmOuter + 1, 141],
      [elbowOuter + 1, 157],
      [elbowOuter, 172],
    ),
    curve(
      [elbowOuter - 1, 188],
      [wristOuter + 1, 213],
      [wristOuter, 230],
    ),
    curve(
      [wristOuter + 5, 237],
      [wristOuter + 7, 246],
      [wristOuter + 4, 252],
    ),
    curve(
      [wristOuter + 2, 259],
      [wristOuter - 2, 263],
      [wristOuter - 4, 258],
    ),
    curve(
      [wristOuter - 7, 253],
      [wristInner - 1, 242],
      [wristInner, 232],
    ),
    curve(
      [wristInner - 1, 215],
      [elbowInner - 2, 190],
      [elbowInner, 176],
    ),
    curve(
      [elbowInner, 158],
      [upperArmInner + 1, 140],
      [upperArmInner, 126],
    ),
    curve(
      [upperArmInner - 2, 119],
      [CENTER_X + chestHalf - 2, 113],
      [CENTER_X + chestHalf - 3, 108],
    ),
    curve(
      [CENTER_X + chestHalf, 124],
      [CENTER_X + chestHalf, 136],
      [CENTER_X + chestHalf - 1, 145],
    ),
    curve(
      [CENTER_X + chestHalf - 2, 160],
      [CENTER_X + waistHalf, 173],
      [CENTER_X + waistHalf, 183],
    ),
    curve(
      [CENTER_X + waistHalf, 195],
      [CENTER_X + hipHalf, 204],
      [CENTER_X + hipHalf, 216],
    ),
    curve(
      [CENTER_X + hipHalf, 231],
      [CENTER_X + thighHalf + 3, 245],
      [CENTER_X + thighHalf, 262],
    ),
    curve(
      [CENTER_X + thighHalf - 2, 281],
      [CENTER_X + kneeHalf + 2, 296],
      [CENTER_X + kneeHalf, 310],
    ),
    curve(
      [CENTER_X + kneeHalf, 326],
      [CENTER_X + calfHalf + 1, 340],
      [CENTER_X + calfHalf, 352],
    ),
    curve(
      [CENTER_X + calfHalf - 2, 368],
      [CENTER_X + ankleHalf + 1, 384],
      [CENTER_X + ankleHalf, 393],
    ),
    curve(
      [CENTER_X + ankleHalf + 2, 399],
      [CENTER_X + ankleHalf + 13, 402],
      [CENTER_X + ankleHalf + 14, 407],
    ),
    curve(
      [CENTER_X + ankleHalf + 14, 412],
      [CENTER_X + 13, 413],
      [CENTER_X + 9, 411],
    ),
    curve(
      [CENTER_X + 5, 408],
      [CENTER_X + 7, 400],
      [CENTER_X + 8, 393],
    ),
    curve(
      [CENTER_X + 10, 378],
      [CENTER_X + 11, 363],
      [CENTER_X + 10, 348],
    ),
    curve(
      [CENTER_X + 9, 334],
      [CENTER_X + 8, 320],
      [CENTER_X + 9, 307],
    ),
    curve(
      [CENTER_X + 10, 291],
      [CENTER_X + 8, 274],
      [CENTER_X + 6, 259],
    ),
    curve(
      [CENTER_X + 5, 248],
      [CENTER_X + 3, 237],
      [CENTER_X, 229],
    ),
  ];

  const mirror = ([x, y]: Point): Point => [CENTER_X * 2 - x, y];
  const vertices = [start, ...segments.map((segment) => segment.end)];
  const right = segments
    .map(
      (segment) =>
        `C ${point(segment.control1)} ${point(segment.control2)} ${point(
          segment.end,
        )}`,
    )
    .join(" ");
  const left = segments
    .map((segment, index) => ({ segment, index }))
    .reverse()
    .map(
      ({ segment, index }) =>
        `C ${point(mirror(segment.control2))} ${point(
          mirror(segment.control1),
        )} ${point(mirror(vertices[index]))}`,
    )
    .join(" ");
  return `M ${point(start)} ${right} ${left} Z`;
}
