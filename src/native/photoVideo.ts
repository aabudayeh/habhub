import { NativeModules, Platform } from "react-native";

export type NativePhotoVideoFrame = {
  uri: string;
  date: string;
  metadata: string[];
};

type HabHubPhotoVideoBridge = {
  createPhotoProgressVideo?: (
    frames: NativePhotoVideoFrame[],
    frameDurationMs: number,
  ) => Promise<string>;
  savePhotoProgressVideo?: (fileUri: string) => Promise<string>;
};

const bridge = NativeModules.HabHubAndroid as
  | HabHubPhotoVideoBridge
  | undefined;

export function nativePhotoVideoAvailable() {
  return (
    Platform.OS === "android" &&
    typeof bridge?.createPhotoProgressVideo === "function" &&
    typeof bridge?.savePhotoProgressVideo === "function"
  );
}

export async function createNativePhotoProgressVideo(
  frames: NativePhotoVideoFrame[],
  frameDurationMs: number,
) {
  if (!nativePhotoVideoAvailable() || !bridge?.createPhotoProgressVideo)
    throw new Error("Video export is unavailable in this Android build.");
  return bridge.createPhotoProgressVideo(frames, frameDurationMs);
}

export async function saveNativePhotoProgressVideo(fileUri: string) {
  if (!nativePhotoVideoAvailable() || !bridge?.savePhotoProgressVideo)
    throw new Error("Saving video is unavailable in this Android build.");
  return bridge.savePhotoProgressVideo(fileUri);
}
