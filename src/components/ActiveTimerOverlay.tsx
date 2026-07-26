import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "@/src/components/AppText";
import {
  activityTimerDisplaySeconds,
  formatActivityTimer,
} from "@/src/domain/activityTimer";
import { useApp } from "@/src/state/AppProvider";
import { useAppColors, useGroupAccent } from "@/src/theme";

const OVERLAY_WIDTH = 154;
const OVERLAY_HEIGHT = 46;

export function ActiveTimerOverlay({ hidden = false }: { hidden?: boolean }) {
  const { state } = useApp();
  const timer = state.activeTimer;
  const colors = useAppColors();
  const accent = useGroupAccent();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [now, setNow] = useState(Date.now());
  const position = useRef(new Animated.ValueXY()).current;
  const positionRef = useRef({ x: 0, y: 0 });
  const dragOrigin = useRef({ x: 0, y: 0 });
  const initialized = useRef(false);
  const metric = timer
    ? state.metrics.find((item) => item.id === timer.metricId)
    : undefined;
  const clamp = (x: number, y: number) => ({
    x: Math.max(8, Math.min(width - OVERLAY_WIDTH - 8, x)),
    y: Math.max(
      insets.top + 6,
      Math.min(height - OVERLAY_HEIGHT - insets.bottom - 76, y),
    ),
  });
  useEffect(() => {
    if (!timer || hidden) return;
    const interval = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(interval);
  }, [hidden, timer]);
  useEffect(() => {
    if (!timer || initialized.current) return;
    initialized.current = true;
    const initial = clamp(width - OVERLAY_WIDTH - 12, insets.top + 52);
    positionRef.current = initial;
    position.setValue(initial);
    // Position is intentionally initialized only when a timer first appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timer]);
  useEffect(() => {
    if (!timer) initialized.current = false;
  }, [timer]);
  useEffect(() => {
    if (!initialized.current) return;
    const next = clamp(positionRef.current.x, positionRef.current.y);
    positionRef.current = next;
    position.setValue(next);
    // Re-clamp only when the usable screen bounds change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height, insets.bottom, insets.top, width]);
  const responder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          Math.abs(gesture.dx) > 4 || Math.abs(gesture.dy) > 4,
        onPanResponderGrant: () => {
          dragOrigin.current = positionRef.current;
        },
        onPanResponderMove: (_event, gesture) => {
          const next = clamp(
            dragOrigin.current.x + gesture.dx,
            dragOrigin.current.y + gesture.dy,
          );
          position.setValue(next);
        },
        onPanResponderRelease: (_event, gesture) => {
          const next = clamp(
            dragOrigin.current.x + gesture.dx,
            dragOrigin.current.y + gesture.dy,
          );
          positionRef.current = next;
          Animated.spring(position, {
            toValue: next,
            damping: 22,
            stiffness: 230,
            useNativeDriver: false,
          }).start();
        },
        onPanResponderTerminate: () => {
          position.setValue(positionRef.current);
        },
      }),
    // Bounds are deliberately refreshed when the screen changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [height, insets.bottom, insets.top, position, width],
  );
  if (!timer || !metric || hidden) return null;
  const seconds = activityTimerDisplaySeconds(timer, now);
  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <Animated.View
        {...responder.panHandlers}
        style={[
          styles.position,
          position.getLayout(),
          {
            backgroundColor: colors.card,
            borderColor: timer.status === "paused" ? "#D24B4B" : accent,
          },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open ${metric.name} timer`}
          onPress={() => router.navigate("/timer" as never)}
          style={styles.pill}
        >
          <View
            style={[
              styles.icon,
              {
                backgroundColor:
                  timer.status === "paused"
                    ? "#D24B4B20"
                    : `${accent}20`,
              },
            ]}
          >
            <Ionicons
              name={timer.status === "paused" ? "pause" : "timer-outline"}
              size={16}
              color={timer.status === "paused" ? "#D24B4B" : accent}
            />
          </View>
          <View style={styles.copy}>
            <Text
              numberOfLines={1}
              style={[styles.name, { color: colors.muted }]}
            >
              {metric.name}
            </Text>
            <Text style={[styles.time, { color: colors.ink }]}>
              {formatActivityTimer(seconds)}
            </Text>
          </View>
          <Ionicons name="open-outline" size={14} color={colors.faint} />
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  position: {
    position: "absolute",
    width: OVERLAY_WIDTH,
    height: OVERLAY_HEIGHT,
    borderWidth: 1,
    borderRadius: 15,
    shadowColor: "#000000",
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 7,
  },
  pill: {
    flex: 1,
    paddingHorizontal: 7,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  icon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  copy: { flex: 1, minWidth: 0 },
  name: { fontSize: 7, fontWeight: "800" },
  time: { fontSize: 12, fontWeight: "900", letterSpacing: 0.4 },
});
