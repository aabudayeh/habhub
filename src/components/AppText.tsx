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
import { useLocalization } from "@/src/i18n";

type AppTextProps = TextProps & {
  preserveColor?: boolean;
  /** Disable interface translation for user-authored or imported content. */
  translate?: boolean;
};

type AppTextInputProps = TextInputProps & {
  /** Disable interface translation for user-authored placeholder copy. */
  translate?: boolean;
};

function translateTextChildren(
  children: React.ReactNode,
  t: (source: string) => string,
): React.ReactNode {
  if (typeof children === "string") return t(children);
  if (Array.isArray(children)) {
    return children.map((child) => translateTextChildren(child, t));
  }
  return children;
}

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
export function AppText({
  style,
  preserveColor = false,
  translate = true,
  children,
  accessibilityLabel,
  accessibilityHint,
  ...props
}: AppTextProps) {
  const scale = useFontScale();
  const colors = useAppColors();
  const locale = useLocalization();
  const flattened = StyleSheet.flatten(style) as TextStyle | undefined;
  const fontSize = flattened?.fontSize ?? 14;
  const lineHeight = flattened?.lineHeight;
  // Translate each static string fragment. Values and nested elements remain
  // unchanged; user-authored/imported content opts out with translate={false}.
  const translatedChildren = translate
    ? translateTextChildren(children, locale.t)
    : children;
  return (
    <NativeText
      {...props}
      accessibilityLabel={
        translate && accessibilityLabel
          ? locale.t(accessibilityLabel)
          : accessibilityLabel
      }
      accessibilityHint={
        translate && accessibilityHint
          ? locale.t(accessibilityHint)
          : accessibilityHint
      }
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
        locale.isRtl
          ? {
              writingDirection: "rtl",
              textAlign: flattened?.textAlign ?? "right",
            }
          : undefined,
      ]}
    >
      {translatedChildren}
    </NativeText>
  );
}

export const AppTextInput = React.forwardRef<
  NativeTextInput,
  AppTextInputProps
>(
function AppTextInput(
  {
    style,
    placeholderTextColor,
    placeholder,
    accessibilityLabel,
    accessibilityHint,
    translate = true,
    ...props
  },
  ref,
) {
  const scale = useFontScale();
  const colors = useAppColors();
  const locale = useLocalization();
  const flattened = StyleSheet.flatten(style) as TextStyle | undefined;
  const fontSize = flattened?.fontSize ?? 14;
  return (
    <NativeTextInput
      ref={ref}
      {...props}
      placeholder={translate && placeholder ? locale.t(placeholder) : placeholder}
      accessibilityLabel={
        translate && accessibilityLabel
          ? locale.t(accessibilityLabel)
          : accessibilityLabel
      }
      accessibilityHint={
        translate && accessibilityHint
          ? locale.t(accessibilityHint)
          : accessibilityHint
      }
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
        locale.isRtl
          ? {
              writingDirection: "rtl",
              textAlign: flattened?.textAlign ?? "right",
            }
          : undefined,
      ]}
    />
  );
});
