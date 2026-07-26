import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useState } from "react";
import {
  LayoutChangeEvent,
  Pressable,
  StyleSheet,
  View,
} from "react-native";

import { AppText as Text } from "@/src/components/AppText";
import {
  isAllowedThemeColor,
  THEME_COLOR_CHOICES,
} from "@/src/domain/colors";
import { useAppColors } from "@/src/theme";

function hex(channel: number) {
  return Math.round(Math.max(0, Math.min(255, channel)))
    .toString(16)
    .padStart(2, "0");
}

function hueRgb(hue: number) {
  const h = ((hue % 360) + 360) % 360;
  const x = 1 - Math.abs(((h / 60) % 2) - 1);
  const [r, g, b] =
    h < 60
      ? [1, x, 0]
      : h < 120
        ? [x, 1, 0]
        : h < 180
          ? [0, 1, x]
          : h < 240
            ? [0, x, 1]
            : h < 300
              ? [x, 0, 1]
              : [1, 0, x];
  return [r * 255, g * 255, b * 255] as const;
}

function spectrumColor(xRatio: number, yRatio: number) {
  const base = hueRgb(xRatio * 360);
  const mix = yRatio < 0.5 ? 1 - yRatio * 2 : (yRatio - 0.5) * 2;
  const toward = yRatio < 0.5 ? 255 : 0;
  const channels = base.map((value) => value * (1 - mix) + toward * mix);
  return `#${channels.map(hex).join("")}`.toUpperCase();
}

function spectrumPoint(
  color: string,
  size: { width: number; height: number },
) {
  const normalized = color.replace("#", "");
  if (!/^[0-9A-Fa-f]{6}$/.test(normalized))
    return { x: size.width / 2, y: size.height / 2 };
  const [r, g, b] = [0, 2, 4].map((index) =>
    Number.parseInt(normalized.slice(index, index + 2), 16),
  );
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let hue = 0;
  if (delta) {
    if (max === r) hue = 60 * (((g - b) / delta) % 6);
    else if (max === g) hue = 60 * ((b - r) / delta + 2);
    else hue = 60 * ((r - g) / delta + 4);
  }
  if (hue < 0) hue += 360;
  const y =
    min > 0
      ? ((1 - min / 255) * size.height) / 2
      : size.height / 2 + ((1 - max / 255) * size.height) / 2;
  return { x: (hue / 360) * size.width, y };
}

export function ColorSpectrumPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (color: string) => void;
  disabled?: boolean;
}) {
  const colors = useAppColors();
  const [size, setSize] = useState({ width: 1, height: 1 });
  const [cursor, setCursor] = useState({ x: size.width / 2, y: size.height / 2 });
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    setCursor(spectrumPoint(value, size));
  }, [size, value]);

  function layout(event: LayoutChangeEvent) {
    const next = event.nativeEvent.layout;
    setSize({ width: Math.max(1, next.width), height: Math.max(1, next.height) });
  }

  function select(x: number, y: number) {
    if (disabled) return;
    const clamped = {
      x: Math.max(0, Math.min(size.width, x)),
      y: Math.max(0, Math.min(size.height, y)),
    };
    const next = spectrumColor(
      clamped.x / size.width,
      clamped.y / size.height,
    );
    setCursor(clamped);
    const unavailable = !isAllowedThemeColor(next);
    setBlocked(unavailable);
    if (!unavailable) onChange(next);
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.swatches}>
        {THEME_COLOR_CHOICES.map((color) => (
          <Pressable
            key={color}
            disabled={disabled}
            accessibilityLabel={`Choose ${color}`}
            onPress={() => {
              setBlocked(false);
              onChange(color);
            }}
            style={[
              styles.swatch,
              { backgroundColor: color },
              value.toUpperCase() === color && {
                borderColor: colors.ink,
                transform: [{ scale: 1.08 }],
              },
            ]}
          >
            {value.toUpperCase() === color ? (
              <Ionicons name="checkmark" size={15} color="#FFFFFF" />
            ) : null}
          </Pressable>
        ))}
      </View>
      <View
        onLayout={layout}
        onStartShouldSetResponder={() => !disabled}
        onMoveShouldSetResponder={() => !disabled}
        onResponderGrant={(event) =>
          select(event.nativeEvent.locationX, event.nativeEvent.locationY)
        }
        onResponderMove={(event) =>
          select(event.nativeEvent.locationX, event.nativeEvent.locationY)
        }
        style={[styles.spectrum, disabled && styles.disabled]}
      >
        <LinearGradient
          colors={[
            "#FF0000",
            "#FFFF00",
            "#00FF00",
            "#00FFFF",
            "#0000FF",
            "#FF00FF",
            "#FF0000",
          ]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={StyleSheet.absoluteFill}
        />
        <LinearGradient
          colors={["rgba(255,255,255,1)", "rgba(255,255,255,0)", "rgba(0,0,0,1)"]}
          locations={[0, 0.5, 1]}
          style={StyleSheet.absoluteFill}
        />
        <View
          pointerEvents="none"
          style={[
            styles.cursor,
            {
              left: cursor.x - 10,
              top: cursor.y - 10,
              backgroundColor: blocked ? "#D24B4B" : value,
            },
          ]}
        >
          {blocked ? (
            <Ionicons name="lock-closed" size={10} color="#FFFFFF" />
          ) : null}
        </View>
      </View>
      <View style={styles.footer}>
        <View style={[styles.preview, { backgroundColor: value }]} />
        <Text style={[styles.help, { color: blocked ? "#D24B4B" : colors.muted }]}>
          {blocked
            ? "Lime and gold are reserved for completed goals."
            : `${value.toUpperCase()} · drag anywhere in the palette`}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 9 },
  swatches: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  swatch: {
    width: 31,
    height: 31,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
  },
  spectrum: {
    height: 126,
    overflow: "hidden",
    borderRadius: 15,
  },
  disabled: { opacity: 0.45 },
  cursor: {
    position: "absolute",
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000000",
    shadowOpacity: 0.24,
    shadowRadius: 3,
    elevation: 3,
  },
  footer: { flexDirection: "row", alignItems: "center", gap: 8 },
  preview: { width: 20, height: 20, borderRadius: 7 },
  help: { flex: 1, fontSize: 8, lineHeight: 12 },
});
