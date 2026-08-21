import React, { PropsWithChildren, createContext, useContext } from "react";
import { accessibleThemeAccent } from "@/src/domain/colors";

export const palette = {
  ink: "#081B49",
  muted: "#61708A",
  faint: "#8B98AB",
  canvas: "#F4F7FB",
  card: "#FFFFFF",
  border: "#DFE6F0",
  primary: "#081B49",
  primarySoft: "#E0E8F7",
  lime: "#B8E45C",
  amber: "#E9A23B",
  red: "#FF5750",
  purple: "#7756D9",
  blue: "#3478D4",
  white: "#FFFFFF",
};

export const shadow = {
  shadowColor: "#081B49",
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.06,
  shadowRadius: 12,
  elevation: 2,
};

/**
 * Shared semantic type scale. Screens may still opt into a display number,
 * but ordinary page titles, section headings, body copy and supporting copy
 * should use these tokens so navigation no longer changes the perceived text
 * scale from page to page.
 */
export const typography = {
  pageTitle: { fontSize: 20, lineHeight: 24, fontWeight: "900" as const },
  sectionTitle: { fontSize: 14, lineHeight: 18, fontWeight: "900" as const },
  cardTitle: { fontSize: 12, lineHeight: 16, fontWeight: "900" as const },
  body: { fontSize: 11, lineHeight: 16, fontWeight: "600" as const },
  supporting: { fontSize: 9, lineHeight: 13, fontWeight: "700" as const },
  eyebrow: {
    fontSize: 9,
    lineHeight: 12,
    fontWeight: "900" as const,
    letterSpacing: 1.1,
  },
};

const GroupAccentContext = createContext(palette.primary);
const CompactModeContext = createContext(false);
const DarkModeContext = createContext(false);
const FontScaleContext = createContext(1);
export function GroupAccentProvider({
  color,
  children,
}: PropsWithChildren<{ color?: string }>) {
  return React.createElement(
    GroupAccentContext.Provider,
    { value: color ?? palette.primary },
    children,
  );
}
export function useGroupAccent() {
  const accent = useContext(GroupAccentContext);
  const dark = useContext(DarkModeContext);
  return accessibleThemeAccent(accent, dark);
}
export function CompactModeProvider({
  compact,
  children,
}: PropsWithChildren<{ compact: boolean }>) {
  return React.createElement(
    CompactModeContext.Provider,
    { value: compact },
    children,
  );
}
export function useCompactMode() {
  return useContext(CompactModeContext);
}
export function DarkModeProvider({
  dark,
  children,
}: PropsWithChildren<{ dark: boolean }>) {
  return React.createElement(
    DarkModeContext.Provider,
    { value: dark },
    children,
  );
}
export function useDarkMode() {
  return useContext(DarkModeContext);
}
export function FontScaleProvider({
  scale,
  children,
}: PropsWithChildren<{ scale: number }>) {
  return React.createElement(
    FontScaleContext.Provider,
    { value: scale },
    children,
  );
}
export function useFontScale() {
  return useContext(FontScaleContext);
}
export function useAppColors() {
  const dark = useDarkMode();
  const accent = useGroupAccent();
  // Color tokens are consumed by virtually every screen. A stable object
  // prevents unrelated data updates from invalidating memoized styles and
  // navigator options throughout the retained navigation tree.
  return React.useMemo(
    () =>
      dark
        ? {
            ...palette,
            isDark: true,
            canvas: "#071127",
            card: "#101D39",
            border: "#283654",
            ink: "#F5F8FF",
            muted: "#B1BED2",
            faint: "#8090AA",
            primary: accent,
            primarySoft: `${accent}30`,
          }
        : {
            ...palette,
            isDark: false,
            primary: accent,
            primarySoft: `${accent}20`,
          },
    [accent, dark],
  );
}
