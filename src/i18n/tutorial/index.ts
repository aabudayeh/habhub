import type { AppLanguage } from "@/src/types";
import type {
  TutorialGuide,
  TutorialSection,
  TutorialStep,
} from "@/src/tutorial/types";

import { tutorialArCatalog } from "./ar";
import { tutorialDeCatalog } from "./de";
import { tutorialEnCatalog } from "./en";
import { tutorialEsCatalog } from "./es";
import { tutorialFrCatalog } from "./fr";
import { tutorialRuCatalog } from "./ru";
import { tutorialSvCatalog } from "./sv";
import { tutorialZhHansCatalog } from "./zh-Hans";

export type TutorialTranslationKey = keyof typeof tutorialEnCatalog;

export const TUTORIAL_TRANSLATION_CATALOGS = {
  en: tutorialEnCatalog,
  ar: tutorialArCatalog,
  de: tutorialDeCatalog,
  es: tutorialEsCatalog,
  fr: tutorialFrCatalog,
  ru: tutorialRuCatalog,
  sv: tutorialSvCatalog,
  "zh-Hans": tutorialZhHansCatalog,
} as const satisfies Readonly<
  Record<AppLanguage, Readonly<Record<TutorialTranslationKey, string>>>
>;

function guideKey(
  guideId: string,
  field: "title" | "detail",
): TutorialTranslationKey {
  return `guide.${guideId}.${field}` as TutorialTranslationKey;
}

function sectionKey(
  sectionId: string,
  field: "title" | "detail",
): TutorialTranslationKey {
  return `section.${sectionId}.${field}` as TutorialTranslationKey;
}

function stepKey(
  stepId: string,
  field: "title" | "copy" | "primaryLabel" | "instruction",
): TutorialTranslationKey {
  return `step.${stepId}.${field}` as TutorialTranslationKey;
}

/**
 * Resolves a durable tutorial key. Secondary languages deliberately throw for
 * a missing key instead of silently leaking English into a translated guide.
 */
export function tutorialText(
  language: AppLanguage,
  key: TutorialTranslationKey,
) {
  const value = TUTORIAL_TRANSLATION_CATALOGS[language][key];
  if (typeof value !== "string" || !value.trim())
    throw new Error(`Missing ${language} tutorial translation: ${key}`);
  return value;
}

function localizedSection(
  section: TutorialSection,
  language: AppLanguage,
): TutorialSection {
  return {
    ...section,
    title: tutorialText(language, sectionKey(section.id, "title")),
    detail: section.detail
      ? tutorialText(language, sectionKey(section.id, "detail"))
      : undefined,
  };
}

function localizedStep(
  step: TutorialStep,
  language: AppLanguage,
): TutorialStep {
  return {
    ...step,
    title: tutorialText(language, stepKey(step.id, "title")),
    copy: tutorialText(language, stepKey(step.id, "copy")),
    primaryLabel: step.primaryLabel
      ? tutorialText(language, stepKey(step.id, "primaryLabel"))
      : undefined,
    interaction: step.interaction
      ? {
          ...step.interaction,
          instruction: step.interaction.instruction
            ? tutorialText(language, stepKey(step.id, "instruction"))
            : undefined,
        }
      : undefined,
  };
}

/** Returns a localized immutable view; route, target and action ids never change. */
export function localizedTutorialGuide(
  guide: TutorialGuide,
  language: AppLanguage,
): TutorialGuide {
  return {
    ...guide,
    title: tutorialText(language, guideKey(guide.id, "title")),
    detail: tutorialText(language, guideKey(guide.id, "detail")),
    sections: guide.sections?.map((section) =>
      localizedSection(section, language),
    ),
    steps: guide.steps.map((step) => localizedStep(step, language)),
  };
}

export function localizedTutorialGuides(
  guides: readonly TutorialGuide[],
  language: AppLanguage,
) {
  return guides.map((guide) => localizedTutorialGuide(guide, language));
}
