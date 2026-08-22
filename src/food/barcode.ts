const FOOD_BARCODE_LENGTHS = new Set([8, 12, 13, 14]);

export function normalizeFoodBarcodeInput(value: string) {
  const digits = value.replace(/\D/g, "");
  return FOOD_BARCODE_LENGTHS.has(digits.length) ? digits : undefined;
}

export function webCameraErrorMessage(reason: unknown) {
  const name =
    reason && typeof reason === "object" && "name" in reason
      ? String(reason.name)
      : "";

  if (name === "NotAllowedError" || name === "SecurityError")
    return "Camera access is blocked. Allow camera access for HabHub in your browser settings, then try again.";
  if (name === "NotFoundError" || name === "DevicesNotFoundError")
    return "No camera was found on this device. Enter the barcode number below instead.";
  if (name === "NotReadableError" || name === "TrackStartError")
    return "The camera is busy in another app. Close the other camera app, then try again.";
  if (name === "OverconstrainedError" || name === "ConstraintNotSatisfiedError")
    return "The rear camera could not be selected. Try again, or enter the barcode number below.";
  if (name === "AbortError")
    return "The camera stopped before scanning started. Try again.";
  return "The camera could not start in this browser. Try again, or enter the barcode number below.";
}
