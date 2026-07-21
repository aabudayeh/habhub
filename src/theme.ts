import React, { PropsWithChildren, createContext, useContext } from "react";

export const palette = {
  ink: "#17211B",
  muted: "#68756D",
  faint: "#93A098",
  canvas: "#F5F7F2",
  card: "#FFFFFF",
  border: "#E2E8E1",
  primary: "#176B4D",
  primarySoft: "#DDF2E7",
  lime: "#B8E45C",
  amber: "#E9A23B",
  red: "#D95852",
  purple: "#7756D9",
  blue: "#3478D4",
  white: "#FFFFFF",
};

export const shadow = {
  shadowColor: "#17211B",
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.06,
  shadowRadius: 12,
  elevation: 2,
};

const GroupAccentContext = createContext(palette.primary);
const CompactModeContext = createContext(false);
const DarkModeContext = createContext(false);
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
  return useContext(GroupAccentContext);
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
export function useAppColors() {
  const dark = useDarkMode();
  const accent = useGroupAccent();
  return dark
    ? {
        ...palette,
        isDark: true,
        canvas: "#0F1411",
        card: "#18201B",
        border: "#2B3730",
        ink: "#F1F5F2",
        muted: "#AAB6AE",
        faint: "#7F8C84",
        primary: accent,
        primarySoft: `${accent}30`,
      }
    : {
        ...palette,
        isDark: false,
        primary: accent,
        primarySoft: `${accent}20`,
      };
}
