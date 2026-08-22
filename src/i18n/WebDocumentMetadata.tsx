import { useEffect } from "react";
import { Platform } from "react-native";

import { useLocalization } from "@/src/i18n";

function setMetaContent(selector: string, content: string) {
  const element = document.querySelector<HTMLMetaElement>(selector);
  if (element) element.content = content;
}

/** Keeps browser and assistive-technology metadata aligned with the app language. */
export function WebDocumentMetadata({ darkMode = false }: { darkMode?: boolean }) {
  const { language, locale, isRtl, t } = useLocalization();

  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;

    const direction = isRtl ? "rtl" : "ltr";
    const title = t("HabHub · Track anything. Progress together.");
    const description = t(
      "HabHub is a private, customizable tracker for you and your friends.",
    );
    const socialTitle = `${t("Join")} HabHub`;
    const tagline = t("Track anything. Progress together.");
    const logoDescription = t("HabHub logo");
    const shellBackground = darkMode ? "#071127" : "#F4F7FB";

    document.documentElement.lang = language;
    document.documentElement.dir = direction;
    document.documentElement.style.setProperty(
      "--habhub-shell-background",
      shellBackground,
    );
    document.documentElement.style.colorScheme = darkMode ? "dark" : "light";
    document.body?.setAttribute("dir", direction);
    document.title = title;
    setMetaContent('meta[name="theme-color"]', shellBackground);
    setMetaContent('meta[name="description"]', description);
    setMetaContent('meta[property="og:title"]', socialTitle);
    setMetaContent('meta[property="og:description"]', tagline);
    setMetaContent('meta[property="og:image:alt"]', logoDescription);
    setMetaContent('meta[property="og:locale"]', locale.replaceAll("-", "_"));
    setMetaContent('meta[name="twitter:title"]', socialTitle);
    setMetaContent('meta[name="twitter:description"]', tagline);
  }, [darkMode, isRtl, language, locale, t]);

  return null;
}
