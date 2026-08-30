import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { StyleSheet, View } from "react-native";

import type { ChallengeVisualIcon, GroupChallenge } from "@/src/types";

export const CHALLENGE_VISUAL_ICONS: readonly ChallengeVisualIcon[] = [
  "trophy-outline",
  "flag-outline",
  "ribbon-outline",
  "star-outline",
  "flame-outline",
  "flash-outline",
  "walk-outline",
  "fitness-outline",
  "bicycle-outline",
  "nutrition-outline",
];

export function challengeVisualIcon(
  challenge: Pick<GroupChallenge, "audience" | "visualIcon">,
): keyof typeof Ionicons.glyphMap {
  return (
    challenge.visualIcon ??
    (challenge.audience === "public" ? "earth-outline" : "trophy-outline")
  );
}

export function ChallengeVisual({
  challenge,
  color,
  size = 40,
  imageUri = challenge.visualImageUri,
  icon = challengeVisualIcon(challenge),
}: {
  challenge: Pick<
    GroupChallenge,
    "audience" | "visualIcon" | "visualImageUri"
  >;
  color: string;
  size?: number;
  imageUri?: string;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  const radius = Math.max(10, Math.round(size * 0.34));
  return (
    <View
      style={[
        styles.shell,
        {
          width: size,
          height: size,
          borderRadius: radius,
          backgroundColor: `${color}1F`,
        },
      ]}
    >
      {imageUri ? (
        <Image
          source={{ uri: imageUri }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={100}
        />
      ) : (
        <Ionicons name={icon} size={Math.round(size * 0.48)} color={color} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
});
