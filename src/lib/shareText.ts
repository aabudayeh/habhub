import { Platform, Share } from "react-native";

export type ShareTextResult = "shared" | "copied" | "cancelled";

async function copyWithBrowserFallback(message: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(message);
    return;
  }
  const field = document.createElement("textarea");
  field.value = message;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.appendChild(field);
  field.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(field);
  if (!copied) throw new Error("Copy is not supported in this browser.");
}

/** Use the native share sheet, Web Share API, or a browser clipboard fallback. */
export async function shareText(
  message: string,
  title?: string,
): Promise<ShareTextResult> {
  if (Platform.OS !== "web") {
    await Share.share({ message, title });
    return "shared";
  }
  if (typeof navigator === "undefined" || typeof document === "undefined")
    throw new Error("Sharing is not available here.");

  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ title, text: message });
      return "shared";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError")
        return "cancelled";
      // Desktop browsers may expose Web Share but reject the payload. Copying
      // still gives the user a useful invite without losing their action.
    }
  }
  await copyWithBrowserFallback(message);
  return "copied";
}
