import React from "react";
import {
  StyleSheet,
  Text as NativeText,
  TextProps,
  TextStyle,
  TextInput as NativeTextInput,
  TextInputProps,
} from "react-native";

import { useFontScale } from "@/src/theme";

/** Keeps every opted-in screen on the same app-controlled text scale. */
export function AppText({ style, ...props }: TextProps) {
  const scale = useFontScale();
  const flattened = StyleSheet.flatten(style) as TextStyle | undefined;
  const fontSize = flattened?.fontSize ?? 14;
  const lineHeight = flattened?.lineHeight;
  return (
    <NativeText
      {...props}
      allowFontScaling={false}
      style={[
        style,
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

export function AppTextInput({ style, ...props }: TextInputProps) {
  const scale = useFontScale();
  const flattened = StyleSheet.flatten(style) as TextStyle | undefined;
  const fontSize = flattened?.fontSize ?? 14;
  return (
    <NativeTextInput
      {...props}
      allowFontScaling={false}
      style={[style, scale === 1 ? undefined : { fontSize: fontSize * scale }]}
    />
  );
}
