import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as Sharing from "expo-sharing";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  LayoutChangeEvent,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import ViewShot from "react-native-view-shot";

import { AppText as Text } from "@/src/components/AppText";
import { ExpandableImage } from "@/src/components/ExpandableImage";
import { SelectionMenu } from "@/src/components/SelectionMenu";
import { Card } from "@/src/components/ui";
import { LocalizedAlert as Alert } from "@/src/i18n";
import { imageSourceUri } from "@/src/domain/media";
import {
  chronologicalProgressPhotos,
  fullPhotoDate,
  photoFrameDurationMs,
  photoIndexAtOffset,
  photoMeasurementLabel,
  photoWeightLabel,
  PHOTO_VIDEO_SPEEDS,
  PhotoVideoSpeed,
} from "@/src/domain/photoProgress";
import { palette, useAppColors, useGroupAccent } from "@/src/theme";
import { MetricEntry, PhotoUpdate } from "@/src/types";

const MAX_COLLAGE_PHOTOS = 24;

type PhotoComparisonStudioProps = {
  photos: PhotoUpdate[];
  entries: MetricEntry[];
  userId: string;
  locale: string;
  onDeletePhoto: (photoId: string) => void;
};

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function webVideoMimeType() {
  if (typeof MediaRecorder === "undefined") return undefined;
  return [
    "video/mp4;codecs=avc1.42E01E",
    "video/mp4",
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ].find((mime) => MediaRecorder.isTypeSupported(mime));
}

function webVideoAvailable() {
  return (
    Platform.OS === "web" &&
    typeof document !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    typeof HTMLCanvasElement !== "undefined" &&
    "captureStream" in HTMLCanvasElement.prototype &&
    Boolean(webVideoMimeType())
  );
}

function loadWebImage(photo: PhotoUpdate) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const uri = imageSourceUri(photo.uri);
    if (!uri) {
      reject(new Error("This photo is not available to the browser."));
      return;
    }
    const image = document.createElement("img");
    if (/^https?:/i.test(uri)) image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("A selected photo could not be loaded."));
    image.src = uri;
  });
}

function drawCover(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const sourceWidth = width / scale;
  const sourceHeight = height / scale;
  const sourceX = (image.naturalWidth - sourceWidth) / 2;
  const sourceY = (image.naturalHeight - sourceHeight) / 2;
  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    x,
    y,
    width,
    height,
  );
}

async function deliverWebFile(blob: Blob, filename: string, title: string) {
  const file = new File([blob], filename, { type: blob.type });
  const shareNavigator = navigator as Navigator & {
    canShare?: (data: ShareData) => boolean;
  };
  if (
    typeof shareNavigator.share === "function" &&
    shareNavigator.canShare?.({ files: [file] })
  ) {
    try {
      await shareNavigator.share({ files: [file], title });
      return;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
    }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function drawVideoFrame(
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  photo: PhotoUpdate,
  entries: MetricEntry[],
  userId: string,
  locale: string,
  showBodyFat: boolean,
  showLeanMass: boolean,
) {
  context.fillStyle = "#F5F7F2";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#17211B";
  context.font = "700 25px sans-serif";
  context.textAlign = "left";
  context.fillText("HabHub photo progress", 36, 50);
  drawCover(context, image, 36, 78, canvas.width - 72, canvas.height - 260);
  context.textAlign = "center";
  context.fillStyle = "#17211B";
  context.font = "700 24px sans-serif";
  context.fillText(fullPhotoDate(photo.localDate, locale), canvas.width / 2, canvas.height - 130);
  const metadata = [
    photoWeightLabel(entries, userId, photo.localDate, locale),
    showBodyFat
      ? photoMeasurementLabel(entries, userId, photo.localDate, "body_fat", locale)?.compactLabel
      : undefined,
    showLeanMass
      ? photoMeasurementLabel(entries, userId, photo.localDate, "lean_body_mass", locale)?.compactLabel
      : undefined,
  ].filter(Boolean) as string[];
  if (metadata.length) {
    context.fillStyle = "#176B4D";
    context.font = "700 17px sans-serif";
    metadata.forEach((line, index) =>
      context.fillText(line, canvas.width / 2, canvas.height - 96 + index * 25),
    );
  }
}

export function PhotoComparisonStudio({
  photos,
  entries,
  userId,
  locale,
  onDeletePhoto,
}: PhotoComparisonStudioProps) {
  const colors = useAppColors();
  const accent = useGroupAccent();
  const ordered = useMemo(
    () => chronologicalProgressPhotos(photos.filter((photo) => photo.userId === userId)),
    [photos, userId],
  );
  const bodyEntries = useMemo(
    () =>
      entries.filter(
        (entry) =>
          entry.userId === userId &&
          ["weight", "body_fat", "lean_body_mass"].includes(entry.metricId),
      ),
    [entries, userId],
  );
  const [activeId, setActiveId] = useState(ordered.at(-1)?.id ?? "");
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<PhotoVideoSpeed>(1);
  const [trackWidth, setTrackWidth] = useState(0);
  const [collageOpen, setCollageOpen] = useState(false);
  const [collageIds, setCollageIds] = useState<string[]>(() =>
    ordered.length > 1 ? [ordered[0].id, ordered.at(-1)!.id] : [],
  );
  const [showBodyFat, setShowBodyFat] = useState(false);
  const [showLeanMass, setShowLeanMass] = useState(false);
  const [exportingVideo, setExportingVideo] = useState(false);
  const [videoProgress, setVideoProgress] = useState(0);
  const collageRef = useRef<ViewShot>(null);
  const activeIndex = Math.max(0, ordered.findIndex((photo) => photo.id === activeId));
  const active = ordered[activeIndex];
  const selectedPhotos = ordered.filter((photo) => collageIds.includes(photo.id));

  useEffect(() => {
    if (!ordered.length) return;
    if (!ordered.some((photo) => photo.id === activeId))
      setActiveId(ordered.at(-1)!.id);
    setCollageIds((current) => {
      const retained = current.filter((id) => ordered.some((photo) => photo.id === id));
      if (retained.length >= 2) return retained;
      return ordered.length > 1 ? [ordered[0].id, ordered.at(-1)!.id] : [];
    });
  }, [activeId, ordered]);

  useEffect(() => {
    if (!playing || ordered.length < 2) return;
    const timer = setTimeout(() => {
      if (activeIndex >= ordered.length - 1) {
        setPlaying(false);
        return;
      }
      setActiveId(ordered[activeIndex + 1].id);
    }, photoFrameDurationMs(speed));
    return () => clearTimeout(timer);
  }, [activeIndex, ordered, playing, speed]);

  if (!ordered.length || !active) return null;

  function seekTo(offset: number) {
    const index = photoIndexAtOffset(offset, trackWidth, ordered.length);
    setPlaying(false);
    setActiveId(ordered[index].id);
  }

  function handleTrackLayout(event: LayoutChangeEvent) {
    setTrackWidth(event.nativeEvent.layout.width);
  }

  function chooseCollage(ids: string[]) {
    if (ids.length > MAX_COLLAGE_PHOTOS) {
      Alert.alert(
        "Choose fewer photos",
        `A collage can contain up to ${MAX_COLLAGE_PHOTOS} photos so it remains sharp and shareable.`,
      );
      return;
    }
    setCollageIds(ids);
  }

  async function exportCollage() {
    if (selectedPhotos.length < 2) return;
    try {
      if (Platform.OS !== "web") {
        const uri = await collageRef.current?.capture?.();
        if (!uri) throw new Error("The collage could not be rendered.");
        if (!(await Sharing.isAvailableAsync()))
          throw new Error("Sharing is not available on this device.");
        await Sharing.shareAsync(uri, {
          mimeType: "image/png",
          dialogTitle: "Save or share photo comparison",
        });
        return;
      }
      const columns = selectedPhotos.length === 2 ? 2 : Math.min(3, Math.ceil(Math.sqrt(selectedPhotos.length)));
      const rows = Math.ceil(selectedPhotos.length / columns);
      const canvas = document.createElement("canvas");
      canvas.width = 1_200;
      canvas.height = 88 + rows * 580;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas export is unavailable.");
      context.fillStyle = "#F5F7F2";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "#17211B";
      context.font = "700 32px sans-serif";
      context.textAlign = "left";
      context.fillText("HabHub photo comparison", 34, 52);
      const gap = 20;
      const cellWidth = (canvas.width - gap * (columns + 1)) / columns;
      for (let index = 0; index < selectedPhotos.length; index += 1) {
        const photo = selectedPhotos[index];
        const image = await loadWebImage(photo);
        const column = index % columns;
        const row = Math.floor(index / columns);
        const x = gap + column * (cellWidth + gap);
        const y = 78 + row * 580;
        drawCover(context, image, x, y, cellWidth, 430);
        context.textAlign = "center";
        context.fillStyle = "#17211B";
        context.font = "700 18px sans-serif";
        context.fillText(fullPhotoDate(photo.localDate, locale), x + cellWidth / 2, y + 464);
        const metadata = [
          photoWeightLabel(bodyEntries, userId, photo.localDate, locale),
          showBodyFat
            ? photoMeasurementLabel(bodyEntries, userId, photo.localDate, "body_fat", locale)?.compactLabel
            : undefined,
          showLeanMass
            ? photoMeasurementLabel(bodyEntries, userId, photo.localDate, "lean_body_mass", locale)?.compactLabel
            : undefined,
        ].filter(Boolean) as string[];
        if (metadata.length) {
          context.fillStyle = "#176B4D";
          context.font = "700 13px sans-serif";
          metadata.forEach((line, metadataIndex) =>
            context.fillText(
              line,
              x + cellWidth / 2,
              y + 493 + metadataIndex * 20,
            ),
          );
        }
      }
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (result) => result ? resolve(result) : reject(new Error("The collage could not be encoded.")),
          "image/png",
          1,
        ),
      );
      await deliverWebFile(blob, "habhub-photo-comparison.png", "HabHub photo comparison");
    } catch (error) {
      Alert.alert(
        "Could not export collage",
        error instanceof Error ? error.message : "Try again.",
      );
    }
  }

  async function exportVideo() {
    if (!webVideoAvailable() || ordered.length < 2 || exportingVideo) return;
    setExportingVideo(true);
    setVideoProgress(0);
    let stream: MediaStream | undefined;
    try {
      const mimeType = webVideoMimeType();
      if (!mimeType) throw new Error("This browser cannot encode a progress video.");
      const canvas = document.createElement("canvas");
      canvas.width = 720;
      canvas.height = 960;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas video export is unavailable.");
      stream = canvas.captureStream(30);
      const chunks: Blob[] = [];
      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: 1_800_000,
      });
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      const stopped = new Promise<Blob>((resolve, reject) => {
        recorder.onerror = () => reject(new Error("The browser stopped encoding the video."));
        recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
      });
      recorder.start(1_000);
      for (let index = 0; index < ordered.length; index += 1) {
        const photo = ordered[index];
        const image = await loadWebImage(photo);
        drawVideoFrame(
          context,
          canvas,
          image,
          photo,
          bodyEntries,
          userId,
          locale,
          showBodyFat,
          showLeanMass,
        );
        setVideoProgress((index + 1) / ordered.length);
        await sleep(photoFrameDurationMs(speed));
      }
      recorder.stop();
      const blob = await stopped;
      const extension = mimeType.startsWith("video/mp4") ? "mp4" : "webm";
      await deliverWebFile(
        blob,
        `habhub-photo-progress.${extension}`,
        "HabHub photo progress",
      );
    } catch (error) {
      Alert.alert(
        "Could not export video",
        error instanceof Error ? error.message : "Try again.",
      );
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
      setExportingVideo(false);
      setVideoProgress(0);
    }
  }

  const weight = photoWeightLabel(bodyEntries, userId, active.localDate, locale);
  const activeBodyFat = showBodyFat
    ? photoMeasurementLabel(bodyEntries, userId, active.localDate, "body_fat", locale)?.compactLabel
    : undefined;
  const activeLeanMass = showLeanMass
    ? photoMeasurementLabel(bodyEntries, userId, active.localDate, "lean_body_mass", locale)?.compactLabel
    : undefined;
  const timelineProgress = ordered.length > 1 ? activeIndex / (ordered.length - 1) : 0;
  const collageItems = ordered.map((photo) => ({
    id: photo.id,
    label: fullPhotoDate(photo.localDate, locale),
    sublabel: photoWeightLabel(bodyEntries, userId, photo.localDate, locale),
    icon: "image-outline" as const,
    color: accent,
  }));

  return (
    <Card style={styles.studio}>
      <View style={styles.heading}>
        <View style={[styles.headingIcon, { backgroundColor: colors.primarySoft }]}>
          <Ionicons name="images-outline" size={18} color={accent} />
        </View>
        <View style={styles.grow}>
          <Text style={[styles.title, { color: colors.ink }]}>Photo timeline</Text>
          <Text style={[styles.meta, { color: colors.muted }]}>
            {ordered.length} photo{ordered.length === 1 ? "" : "s"} · oldest to newest
          </Text>
        </View>
      </View>

      <ExpandableImage
        uri={active.uri}
        containerStyle={styles.heroFrame}
        thumbnailStyle={styles.heroImage}
        caption={[fullPhotoDate(active.localDate, locale), weight].filter(Boolean).join(" · ")}
      />
      <View style={styles.currentMeta}>
        <Text translate={false} style={[styles.currentDate, { color: colors.ink }]}>
          {fullPhotoDate(active.localDate, locale)}
        </Text>
        <View style={styles.currentMeasurements}>
          {[weight, activeBodyFat, activeLeanMass].filter(Boolean).map((label) => (
            <Text key={label} translate={false} style={[styles.currentWeight, { color: accent }]}>{label}</Text>
          ))}
        </View>
        <Pressable
          accessibilityLabel="Delete this photo"
          hitSlop={7}
          onPress={() =>
            Alert.alert(
              "Delete photo?",
              "This removes the photo from your timeline, collages, and video previews.",
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Delete",
                  style: "destructive",
                  onPress: () => onDeletePhoto(active.id),
                },
              ],
            )
          }
          style={[styles.deleteButton, { borderColor: `${palette.red}66` }]}
        >
          <Ionicons name="trash-outline" size={14} color={palette.red} />
        </Pressable>
      </View>

      <View
        accessibilityRole="adjustable"
        accessibilityLabel="Photo date"
        accessibilityValue={{ min: 1, max: ordered.length, now: activeIndex + 1 }}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === "increment" && activeIndex < ordered.length - 1)
            setActiveId(ordered[activeIndex + 1].id);
          if (event.nativeEvent.actionName === "decrement" && activeIndex > 0)
            setActiveId(ordered[activeIndex - 1].id);
        }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onLayout={handleTrackLayout}
        onStartShouldSetResponder={() => ordered.length > 1}
        onMoveShouldSetResponder={() => ordered.length > 1}
        onResponderGrant={(event) => seekTo(event.nativeEvent.locationX)}
        onResponderMove={(event) => seekTo(event.nativeEvent.locationX)}
        style={[styles.track, { backgroundColor: colors.border }]}
      >
        <View style={[styles.trackFill, { backgroundColor: accent, width: `${timelineProgress * 100}%` }]} />
        <View style={[styles.trackThumb, { backgroundColor: accent, left: `${timelineProgress * 100}%` }]} />
      </View>
      <View style={styles.rangeDates}>
        <Text translate={false} style={[styles.rangeDate, { color: colors.faint }]}>{fullPhotoDate(ordered[0].localDate, locale)}</Text>
        <Text translate={false} style={[styles.rangeDate, styles.rangeDateRight, { color: colors.faint }]}>{fullPhotoDate(ordered.at(-1)!.localDate, locale)}</Text>
      </View>

      <View style={styles.playbackRow}>
        <Pressable
          accessibilityLabel="Previous photo"
          disabled={activeIndex === 0}
          onPress={() => setActiveId(ordered[Math.max(0, activeIndex - 1)].id)}
          style={[styles.roundButton, { borderColor: colors.border }, activeIndex === 0 && styles.disabled]}
        >
          <Ionicons name="play-skip-back" size={16} color={accent} />
        </Pressable>
        <Pressable
          accessibilityLabel={playing ? "Pause slideshow" : "Play slideshow"}
          disabled={ordered.length < 2}
          onPress={() => {
            if (!playing && activeIndex >= ordered.length - 1) setActiveId(ordered[0].id);
            setPlaying((value) => !value);
          }}
          style={[styles.playButton, { backgroundColor: accent }, ordered.length < 2 && styles.disabled]}
        >
          <Ionicons name={playing ? "pause" : "play"} size={18} color={palette.white} />
        </Pressable>
        <Pressable
          accessibilityLabel="Next photo"
          disabled={activeIndex >= ordered.length - 1}
          onPress={() => setActiveId(ordered[Math.min(ordered.length - 1, activeIndex + 1)].id)}
          style={[styles.roundButton, { borderColor: colors.border }, activeIndex >= ordered.length - 1 && styles.disabled]}
        >
          <Ionicons name="play-skip-forward" size={16} color={accent} />
        </Pressable>
        <View style={styles.speedGroup}>
          {PHOTO_VIDEO_SPEEDS.map((choice) => (
            <Pressable
              key={choice}
              accessibilityRole="radio"
              accessibilityState={{ checked: speed === choice }}
              onPress={() => setSpeed(choice)}
              style={[
                styles.speedButton,
                { borderColor: speed === choice ? accent : colors.border },
                speed === choice && { backgroundColor: colors.primarySoft },
              ]}
            >
              <Text translate={false} style={[styles.speedText, { color: speed === choice ? accent : colors.muted }]}>{choice}×</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {ordered.length > 1 ? (
        <>
          <Pressable onPress={() => setCollageOpen((open) => !open)} style={[styles.sectionToggle, { borderTopColor: colors.border }]}>
            <View style={styles.toggleCopy}>
              <Ionicons name="grid-outline" size={16} color={accent} />
              <Text style={[styles.sectionTitle, { color: colors.ink }]}>Create photo collage</Text>
            </View>
            <Ionicons name={collageOpen ? "chevron-up" : "chevron-down"} size={16} color={colors.muted} />
          </Pressable>
          {collageOpen ? (
            <View style={styles.collageSection}>
              <SelectionMenu
                title="Photos in collage"
                items={collageItems}
                selectedIds={collageIds}
                onChange={chooseCollage}
                minimumSelected={2}
                emptyLabel="Choose at least two photos"
              />
              <View style={styles.measurementOptions}>
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: showBodyFat }}
                  onPress={() => setShowBodyFat((shown) => !shown)}
                  style={[styles.measurementOption, { borderColor: showBodyFat ? accent : colors.border }, showBodyFat && { backgroundColor: colors.primarySoft }]}
                >
                  <Ionicons name={showBodyFat ? "checkbox" : "square-outline"} size={14} color={showBodyFat ? accent : colors.muted} />
                  <Text style={[styles.measurementOptionText, { color: showBodyFat ? accent : colors.muted }]}>Body fat</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: showLeanMass }}
                  onPress={() => setShowLeanMass((shown) => !shown)}
                  style={[styles.measurementOption, { borderColor: showLeanMass ? accent : colors.border }, showLeanMass && { backgroundColor: colors.primarySoft }]}
                >
                  <Ionicons name={showLeanMass ? "checkbox" : "square-outline"} size={14} color={showLeanMass ? accent : colors.muted} />
                  <Text style={[styles.measurementOptionText, { color: showLeanMass ? accent : colors.muted }]}>Lean mass</Text>
                </Pressable>
              </View>
              <ViewShot ref={collageRef} options={{ format: "png", quality: 1 }} style={styles.capture}>
                <Text preserveColor style={styles.captureTitle}>HabHub photo comparison</Text>
                <View style={styles.collageGrid}>
                  {selectedPhotos.map((photo) => {
                    const itemWeight = photoWeightLabel(bodyEntries, userId, photo.localDate, locale);
                    const itemBodyFat = showBodyFat
                      ? photoMeasurementLabel(bodyEntries, userId, photo.localDate, "body_fat", locale)?.compactLabel
                      : undefined;
                    const itemLeanMass = showLeanMass
                      ? photoMeasurementLabel(bodyEntries, userId, photo.localDate, "lean_body_mass", locale)?.compactLabel
                      : undefined;
                    return (
                      <View key={photo.id} style={styles.collageCell}>
                        <Image source={typeof photo.uri === "string" ? { uri: photo.uri } : photo.uri} style={styles.collageImage} contentFit="cover" />
                        <Text preserveColor translate={false} style={styles.captureDate}>{fullPhotoDate(photo.localDate, locale)}</Text>
                        {[itemWeight, itemBodyFat, itemLeanMass].filter(Boolean).map((label) => (
                          <Text key={label} preserveColor translate={false} style={styles.captureWeight}>{label}</Text>
                        ))}
                      </View>
                    );
                  })}
                </View>
              </ViewShot>
              <Pressable onPress={exportCollage} style={[styles.exportButton, { borderColor: accent }]}>
                <Ionicons name="download-outline" size={16} color={accent} />
                <Text style={[styles.exportText, { color: accent }]}>Save or share collage</Text>
              </Pressable>
            </View>
          ) : null}

          {webVideoAvailable() ? (
            <Pressable disabled={exportingVideo} onPress={exportVideo} style={[styles.videoButton, { backgroundColor: accent }, exportingVideo && styles.disabled]}>
              <Ionicons name={exportingVideo ? "hourglass-outline" : "videocam-outline"} size={16} color={palette.white} />
              <Text preserveColor style={styles.videoText}>
                {exportingVideo ? `Creating video · ${Math.round(videoProgress * 100)}%` : "Save or share slideshow video"}
              </Text>
            </Pressable>
          ) : (
            <View style={[styles.videoNote, { backgroundColor: colors.primarySoft }]}>
              <Ionicons name="information-circle-outline" size={15} color={accent} />
              <Text style={[styles.videoNoteText, { color: colors.muted }]}>
                Live playback works here. Video export is available in a browser with built-in video encoding; MP4 is used when that browser supports it, otherwise WebM.
              </Text>
            </View>
          )}
        </>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  studio: { gap: 10 },
  heading: { flexDirection: "row", alignItems: "center", gap: 9 },
  headingIcon: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  grow: { flex: 1, minWidth: 0 },
  title: { fontSize: 13, fontWeight: "900" },
  meta: { fontSize: 8, marginTop: 2 },
  heroFrame: { alignSelf: "stretch", width: "100%", height: 280 },
  heroImage: { width: "100%", height: "100%", borderRadius: 14 },
  currentMeta: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  currentDate: { flex: 1, fontSize: 10, fontWeight: "900" },
  currentMeasurements: { alignItems: "flex-end", gap: 1, maxWidth: "58%" },
  currentWeight: { fontSize: 10, fontWeight: "900" },
  deleteButton: { width: 30, height: 30, borderWidth: 1, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  track: { height: 8, borderRadius: 999, position: "relative", marginHorizontal: 7, marginTop: 2 },
  trackFill: { height: 8, borderRadius: 999 },
  trackThumb: { position: "absolute", top: -5, marginLeft: -9, width: 18, height: 18, borderRadius: 9, borderWidth: 3, borderColor: palette.white },
  rangeDates: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  rangeDate: { flex: 1, fontSize: 6.5 },
  rangeDateRight: { textAlign: "right" },
  playbackRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  roundButton: { width: 34, height: 34, borderWidth: 1, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  playButton: { width: 38, height: 38, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  speedGroup: { marginLeft: "auto", flexDirection: "row", gap: 4 },
  speedButton: { minWidth: 32, height: 29, borderWidth: 1, borderRadius: 9, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 },
  speedText: { fontSize: 7.5, fontWeight: "900" },
  disabled: { opacity: 0.45 },
  sectionToggle: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  toggleCopy: { flexDirection: "row", alignItems: "center", gap: 7 },
  sectionTitle: { fontSize: 10, fontWeight: "900" },
  collageSection: { gap: 8 },
  measurementOptions: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  measurementOption: { minHeight: 30, borderWidth: 1, borderRadius: 10, paddingHorizontal: 8, flexDirection: "row", alignItems: "center", gap: 5 },
  measurementOptionText: { fontSize: 7.5, fontWeight: "900" },
  capture: { backgroundColor: "#F5F7F2", borderRadius: 12, padding: 8 },
  captureTitle: { color: "#17211B", fontSize: 12, fontWeight: "900", marginBottom: 7 },
  collageGrid: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  collageCell: { width: "48%", flexGrow: 1, minWidth: 110, alignItems: "center" },
  collageImage: { width: "100%", height: 150, borderRadius: 10, backgroundColor: palette.border },
  captureDate: { color: "#17211B", fontSize: 7, fontWeight: "800", marginTop: 4, textAlign: "center" },
  captureWeight: { color: "#176B4D", fontSize: 7, fontWeight: "900", marginTop: 1 },
  exportButton: { height: 38, borderWidth: 1, borderRadius: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  exportText: { fontSize: 9, fontWeight: "900" },
  videoButton: { minHeight: 40, borderRadius: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingHorizontal: 10 },
  videoText: { color: palette.white, fontSize: 9, fontWeight: "900" },
  videoNote: { borderRadius: 11, padding: 9, flexDirection: "row", alignItems: "flex-start", gap: 7 },
  videoNoteText: { flex: 1, fontSize: 7.5, lineHeight: 11 },
});
