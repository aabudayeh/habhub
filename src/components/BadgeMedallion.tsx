import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, View } from "react-native";

import {
  badgeVisualSpec,
  type EarnedBadge,
} from "@/src/domain/badges";

/**
 * The shared badge artwork used by the cabinet, public showcase, and alerts.
 * Keeping the tracker glyph and award motif in one component prevents those
 * smaller surfaces from silently falling back to the legacy single icon.
 */
export function BadgeMedallion({
  badge,
  trackerIcon,
  size = 48,
}: {
  badge: EarnedBadge;
  trackerIcon?: EarnedBadge["icon"];
  size?: number;
}) {
  const spec = badgeVisualSpec(badge, trackerIcon);
  const innerSize = Math.round(size * 0.72);
  const iconSize = Math.round(size * 0.38);
  const accentSize = Math.max(10, Math.round(size * 0.22));
  return (
    <View
      accessibilityLabel={`${badge.title} badge`}
      style={[
        styles.medallion,
        spec.frame === "crest"
          ? styles.medallionCrest
          : spec.frame === "shield"
            ? styles.medallionShield
            : spec.frame === "burst"
              ? styles.medallionBurst
              : styles.medallionRound,
        {
          width: size,
          height: size,
          borderColor: `${badge.color}A8`,
          backgroundColor: `${badge.color}18`,
        },
      ]}
    >
      <View
        style={[
          styles.medallionInner,
          {
            width: innerSize,
            height: innerSize,
            borderRadius: spec.frame === "shield" ? 10 : innerSize / 2,
            borderColor: `${badge.color}70`,
            backgroundColor: `${badge.color}22`,
          },
        ]}
      >
        <Ionicons name={spec.primaryIcon} size={iconSize} color={badge.color} />
      </View>
      <View
        style={[
          styles.medallionAccent,
          {
            width: accentSize + 6,
            height: accentSize + 6,
            borderColor: `${badge.color}75`,
            backgroundColor: badge.color,
          },
        ]}
      >
        <Ionicons name={spec.accentIcon} size={accentSize} color="#FFFFFF" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  medallion: {
    position: "relative",
    flexShrink: 0,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  medallionCrest: { borderRadius: 15 },
  medallionShield: {
    borderTopLeftRadius: 15,
    borderTopRightRadius: 15,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
  },
  medallionBurst: { borderRadius: 24, borderStyle: "dashed" },
  medallionRound: { borderRadius: 24, borderWidth: 2 },
  medallionInner: {
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  medallionAccent: {
    position: "absolute",
    right: -4,
    bottom: -4,
    borderRadius: 99,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
});
