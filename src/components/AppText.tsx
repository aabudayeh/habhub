import React from "react";
import {
  StyleSheet,
  Text as NativeText,
  TextProps,
  TextStyle,
  TextInput as NativeTextInput,
  TextInputProps,
} from "react-native";

import { palette, useAppColors, useFontScale } from "@/src/theme";

type AppTextProps = TextProps & { preserveColor?: boolean };

function remapColor(color: TextStyle["color"], colors: ReturnType<typeof useAppColors>) {
  if (typeof color !== "string") return color;
  // Legacy green text follows the active group's theme in every color mode.
  if (color === palette.primary) return colors.primary;
  if (color === palette.primarySoft) return colors.primarySoft;
  if (!colors.isDark) return color;
  const replacements: Record<string, string> = {
    [palette.ink]: colors.ink,
    [palette.muted]: colors.muted,
    [palette.faint]: colors.faint,
    [palette.canvas]: colors.canvas,
    [palette.card]: colors.card,
    [palette.border]: colors.border,
  };
  return replacements[color] ?? color;
}

/** Keeps every opted-in screen on the same app-controlled text scale. */
export function AppText({ style, preserveColor = false, ...props }: AppTextProps) {
  const scale = useFontScale();
  const colors = useAppColors();
  const flattened = StyleSheet.flatten(style) as TextStyle | undefined;
  const fontSize = flattened?.fontSize ?? 14;
  const lineHeight = flattened?.lineHeight;
  return (
    <NativeText
      {...props}
      allowFontScaling={false}
      style={[
        style,
        preserveColor
          ? undefined
          : {
              color: remapColor(flattened?.color, colors),
              backgroundColor: remapColor(flattened?.backgroundColor, colors),
              borderColor: remapColor(flattened?.borderColor, colors),
            },
        scale === 1
          ? undefined
          : {
              fontSize: fontSize * scale,
              lineHeight: lineHeight ? lineHeight * scale : undefined,
            },
      ]}
    />
  );
}

export const AppTextInput = React.forwardRef<NativeTextInput, TextInputProps>(
function AppTextInput(
  {
    style,
    placeholderTextColor,
    ...props
  },
  ref,
) {
  const scale = useFontScale();
  const colors = useAppColors();
  const flattened = StyleSheet.flatten(style) as TextStyle | undefined;
  const fontSize = flattened?.fontSize ?? 14;
  return (
    <NativeTextInput
      ref={ref}
      {...props}
      allowFontScaling={false}
      placeholderTextColor={remapColor(placeholderTextColor, colors)}
      style={[
        style,
        {
          color: remapColor(flattened?.color, colors),
          backgroundColor: remapColor(flattened?.backgroundColor, colors),
          borderColor: remapColor(flattened?.borderColor, colors),
        },
        scale === 1 ? undefined : { fontSize: fontSize * scale },
      ]}
    />
  );
});
