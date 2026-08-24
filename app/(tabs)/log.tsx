import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { router, useLocalSearchParams } from "expo-router";
import { useNavigation } from "@react-navigation/native";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import {
  AppText as Text,
  AppTextInput as TextInput,
} from "@/src/components/AppText";
import { LocalizedAlert as Alert, useLocale } from "@/src/i18n";

import { Button, Card, Chip, PageHeader, Screen } from "@/src/components/ui";
import { MetricSelector } from "@/src/components/MetricSelector";
import { MonthCalendar } from "@/src/components/MonthCalendar";
import { TimeInput } from "@/src/components/TimeInput";
import { useWebBeforeUnload } from "@/src/components/useWebBeforeUnload";
import {
  TutorialTarget,
  useTutorial,
} from "@/src/components/TutorialSpotlight";
import { dateKey } from "@/src/domain/date";
import {
  FOOD_NUTRIENTS,
  parsePositiveFoodNutrientAmount,
} from "@/src/domain/food";
import { isInternalTracker } from "@/src/domain/trackerCatalog";
import {
  formatMetricValue,
  latestTextValue,
  safeMetricValue,
} from "@/src/domain/metrics";
import { useApp } from "@/src/state/AppProvider";
import { useTutorialSandboxActive } from "@/src/tutorial/TutorialSandboxContext";
import {
  palette,
  typography,
  useAppColors,
  useGroupAccent,
} from "@/src/theme";
import { NutritionDetails, Visibility } from "@/src/types";

type MealType = "breakfast" | "lunch" | "dinner" | "snack";

const EXISTING_FOOD_NUTRITION_KEYS = new Set<keyof NutritionDetails>([
  "proteinG",
  "fatG",
  "carbsG",
  "fiberG",
  "sodiumMg",
  "sugarG",
  "saturatedFatG",
  "cholesterolMg",
  "potassiumMg",
  "calciumMg",
  "ironMg",
  "magnesiumMg",
  "vitaminCMg",
  "vitaminDMcg",
  "vitaminB12Mcg",
]);

const SUPPLEMENTAL_FOOD_NUTRIENTS = FOOD_NUTRIENTS.filter(
  (nutrient) => !EXISTING_FOOD_NUTRITION_KEYS.has(nutrient.nutritionKey),
);

const EXTRA_NUTRITION_GROUPS = [
  {
    id: "Carbohydrates",
    label: "Carbohydrates & sugars",
    hint: "Sugars, sugar alcohols and starch",
  },
  {
    id: "Fats",
    label: "Fats & fatty acids",
    hint: "Saturated, trans, mono, poly and omegas",
  },
  {
    id: "Minerals",
    label: "Minerals & electrolytes",
    hint: "Sodium, potassium, calcium and trace minerals",
  },
  {
    id: "Vitamins",
    label: "Vitamins",
    hint: "A, B, C, D, E, K and related forms",
  },
  {
    id: "Other nutrients",
    label: "Other nutrients",
    hint: "Cholesterol, alcohol and caffeine",
  },
] as const;

type ExtraNutritionGroupId = (typeof EXTRA_NUTRITION_GROUPS)[number]["id"];

function parsedSupplementalNutrition(raw: string | undefined) {
  const values: Partial<Record<keyof NutritionDetails, string>> = {};
  if (!raw) return values;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const nutrient of SUPPLEMENTAL_FOOD_NUTRIENTS) {
      const value = parsed[nutrient.nutritionKey];
      const amount = parsePositiveFoodNutrientAmount(
        typeof value === "string" || typeof value === "number"
          ? value
          : undefined,
      );
      if (amount !== undefined)
        values[nutrient.nutritionKey] = String(amount);
    }
  } catch {
    // A malformed deep link must not prevent a manual food log.
  }
  return values;
}

const privacyOptions: {
  value: Visibility;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  { value: "private", label: "Only me", icon: "lock-closed-outline" },
  { value: "status", label: "Goal status", icon: "checkmark-circle-outline" },
  { value: "group", label: "Share with group", icon: "people-outline" },
];

function LogScreen() {
  const tutorialSandbox = useTutorialSandboxActive();
  const tutorial = useTutorial();
  const params = useLocalSearchParams<{
    metric?: string;
    date?: string;
    value?: string;
    note?: string;
    foodName?: string;
    calories?: string;
    protein?: string;
    fat?: string;
    carbs?: string;
    fiber?: string;
    sodium?: string;
    sugar?: string;
    saturatedFat?: string;
    cholesterol?: string;
    potassium?: string;
    calcium?: string;
    iron?: string;
    magnesium?: string;
    vitaminC?: string;
    vitaminD?: string;
    vitaminB12?: string;
    nutritionDetails?: string;
  }>();
  const { state, logMetric, addPhoto, updateMetric } = useApp();
  const navigation = useNavigation();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const locale = useLocale();
  const metrics = useMemo(() => {
    return [...state.metrics]
      .filter(
        (metric) =>
          metric.dataType !== "calculated" &&
          metric.id !== "screen_time" &&
          !metric.fastingSettings &&
          metric.id !== "blood_pressure_diastolic" &&
          !(metric.id === "pulse" && state.metrics.some((item) => item.id === "blood_pressure_systolic")) &&
          (metric.manualEntry !== false || metric.id === "steps"),
      )
      .sort((a, b) => a.order - b.order);
  }, [state.metrics]);
  const trackerChoices = useMemo(
    () =>
      [...state.metrics]
        .filter(
          (metric) =>
            !isInternalTracker(metric) &&
            !metric.fastingSettings,
        )
        .sort((a, b) => a.order - b.order),
    [state.metrics],
  );
  const [selectedId, setSelectedId] = useState(metrics[0]?.id ?? "");
  const selected =
    metrics.find((metric) => metric.id === selectedId) ?? metrics[0];
  const submetricVisibleCount = selected?.submetricDisplay?.collapsible
    ? Math.min(
        selected.submetrics?.length ?? 0,
        Math.max(
          1,
          selected.submetricDisplay.visibleInputCount ??
            selected.submetrics?.filter((item) => item.showProgressBar).length ??
            1,
        ),
      )
    : (selected?.submetrics?.length ?? 0);
  const visibleSubmetrics =
    selected?.submetrics?.slice(0, submetricVisibleCount) ?? [];
  const collapsedSubmetrics =
    selected?.submetrics?.slice(submetricVisibleCount) ?? [];
  const mainValueEnabled =
    !selected?.submetrics?.length ||
    selected.submetricDisplay?.mainValueEnabled !== false;
  const [value, setValue] = useState("");
  const [waterTouched, setWaterTouched] = useState(false);
  const [label, setLabel] = useState("");
  const [note, setNote] = useState("");
  const [visibility, setVisibility] = useState<Visibility>(
    selected?.defaultVisibility ?? "group",
  );
  const [privacyMenuOpen, setPrivacyMenuOpen] = useState(false);
  const [entryImage, setEntryImage] = useState<string | null>(null);
  const now = new Date();
  const [logDate, setLogDate] = useState(params.date ?? dateKey());
  const [logCalendarOpen, setLogCalendarOpen] = useState(false);
  const [logTime, setLogTime] = useState(
    `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`,
  );
  const [protein, setProtein] = useState("");
  const [fat, setFat] = useState("");
  const [carbs, setCarbs] = useState("");
  const [fiber, setFiber] = useState("");
  const [sodium, setSodium] = useState("");
  const [sugar, setSugar] = useState("");
  const [saturatedFat, setSaturatedFat] = useState("");
  const [cholesterol, setCholesterol] = useState("");
  const [potassium, setPotassium] = useState("");
  const [calcium, setCalcium] = useState("");
  const [iron, setIron] = useState("");
  const [magnesium, setMagnesium] = useState("");
  const [vitaminC, setVitaminC] = useState("");
  const [vitaminD, setVitaminD] = useState("");
  const [vitaminB12, setVitaminB12] = useState("");
  const [supplementalNutrition, setSupplementalNutrition] = useState<
    Partial<Record<keyof NutritionDetails, string>>
  >({});
  const [nutritionOpen, setNutritionOpen] = useState(false);
  const [moreNutrition, setMoreNutrition] = useState(false);
  const [openNutritionGroups, setOpenNutritionGroups] = useState<
    ExtraNutritionGroupId[]
  >([]);
  const [workoutDuration, setWorkoutDuration] = useState("");
  const [workoutCalories, setWorkoutCalories] = useState("");
  const [workoutDistance, setWorkoutDistance] = useState("");
  const [bpDiastolic, setBpDiastolic] = useState("");
  const [bpPulse, setBpPulse] = useState("");
  const [submetricValues, setSubmetricValues] = useState<
    Record<string, string>
  >({});
  const [extraSubmetricsOpen, setExtraSubmetricsOpen] = useState(false);
  const [mealType, setMealType] = useState<MealType>(
    now.getHours() < 11
      ? "breakfast"
      : now.getHours() < 16
        ? "lunch"
        : now.getHours() < 21
          ? "dinner"
          : "snack",
  );
  const extraNutritionFields = [
    {
      id: "sugar",
      label: "Sugar",
      group: "Carbohydrates" as const,
      value: sugar,
      set: setSugar,
      unit: "g",
    },
    {
      id: "saturated_fat",
      label: "Saturated fat",
      group: "Fats" as const,
      value: saturatedFat,
      set: setSaturatedFat,
      unit: "g",
    },
    {
      id: "sodium",
      label: "Sodium",
      group: "Minerals" as const,
      value: sodium,
      set: setSodium,
      unit: "mg",
    },
    {
      id: "cholesterol",
      label: "Cholesterol",
      group: "Other nutrients" as const,
      value: cholesterol,
      set: setCholesterol,
      unit: "mg",
    },
    {
      id: "potassium",
      label: "Potassium",
      group: "Minerals" as const,
      value: potassium,
      set: setPotassium,
      unit: "mg",
    },
    {
      id: "calcium",
      label: "Calcium",
      group: "Minerals" as const,
      value: calcium,
      set: setCalcium,
      unit: "mg",
    },
    {
      id: "iron",
      label: "Iron",
      group: "Minerals" as const,
      value: iron,
      set: setIron,
      unit: "mg",
    },
    {
      id: "magnesium",
      label: "Magnesium",
      group: "Minerals" as const,
      value: magnesium,
      set: setMagnesium,
      unit: "mg",
    },
    {
      id: "vitamin_c",
      label: "Vitamin C",
      group: "Vitamins" as const,
      value: vitaminC,
      set: setVitaminC,
      unit: "mg",
    },
    {
      id: "vitamin_d",
      label: "Vitamin D",
      group: "Vitamins" as const,
      value: vitaminD,
      set: setVitaminD,
      unit: "µg",
    },
    {
      id: "vitamin_b12",
      label: "Vitamin B12",
      group: "Vitamins" as const,
      value: vitaminB12,
      set: setVitaminB12,
      unit: "µg",
    },
    ...SUPPLEMENTAL_FOOD_NUTRIENTS.map((nutrient) => ({
      id: nutrient.id,
      label: nutrient.label,
      group: nutrient.group as ExtraNutritionGroupId,
      value: supplementalNutrition[nutrient.nutritionKey] ?? "",
      set: (next: string) =>
        setSupplementalNutrition((current) => ({
          ...current,
          [nutrient.nutritionKey]: next,
        })),
      unit: nutrient.unit === "mcg" ? "µg" : nutrient.unit,
    })),
  ];
  const hasDraft = Boolean(
    (value.trim() && (selected?.id !== "water" || waterTouched)) ||
      label.trim() ||
      note.trim() ||
      entryImage ||
      protein ||
      fat ||
      carbs ||
      fiber ||
      sodium ||
      sugar ||
      saturatedFat ||
      cholesterol ||
      potassium ||
      calcium ||
      iron ||
      magnesium ||
      vitaminC ||
      vitaminD ||
      vitaminB12 ||
      Object.values(supplementalNutrition).some((raw) => raw?.trim()) ||
      workoutDuration ||
      workoutCalories ||
      workoutDistance ||
      bpDiastolic ||
      bpPulse ||
      Object.values(submetricValues).some((raw) => raw.trim()),
  );
  const hasDraftRef = useRef(hasDraft);
  const allowLeaveRef = useRef(false);
  const internalNavigationRef = useRef(false);
  const promptOpenRef = useRef(false);
  const clearEntryRef = useRef<() => void>(() => undefined);
  const saveEntryRef = useRef<(afterSave?: () => void) => boolean>(
    () => false,
  );
  hasDraftRef.current = hasDraft;
  useWebBeforeUnload(
    () => hasDraftRef.current && !allowLeaveRef.current,
  );

  function openLogChild(work: () => void) {
    internalNavigationRef.current = true;
    work();
    setTimeout(() => {
      internalNavigationRef.current = false;
    }, 800);
  }

  useEffect(() => {
    if (params.metric && metrics.some((metric) => metric.id === params.metric))
      setSelectedId(params.metric);
  }, [metrics, params.metric]);
  useEffect(() => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(params.date ?? ""))
      setLogDate(params.date!);
  }, [params.date]);
  useEffect(() => {
    if (params.value !== undefined) setValue(params.value);
    if (params.note !== undefined) setNote(params.note);
  }, [params.note, params.value]);
  useEffect(() => {
    if (!params.foodName) return;
    setSelectedId("food");
    setLabel(params.foodName);
    setValue(params.calories ?? "");
    setProtein(params.protein ?? "");
    setFat(params.fat ?? "");
    setCarbs(params.carbs ?? "");
    setFiber(params.fiber ?? "");
    setSodium(params.sodium ?? "");
    setSugar(params.sugar ?? "");
    setSaturatedFat(params.saturatedFat ?? "");
    setCholesterol(params.cholesterol ?? "");
    setPotassium(params.potassium ?? "");
    setCalcium(params.calcium ?? "");
    setIron(params.iron ?? "");
    setMagnesium(params.magnesium ?? "");
    setVitaminC(params.vitaminC ?? "");
    setVitaminD(params.vitaminD ?? "");
    setVitaminB12(params.vitaminB12 ?? "");
    setSupplementalNutrition(
      parsedSupplementalNutrition(params.nutritionDetails),
    );
    // Search and barcode results should be immediately reviewable. Manually
    // opened food logs keep nutrition tucked away until the user asks for it.
    setNutritionOpen(true);
  }, [
    params.calories,
    params.carbs,
    params.cholesterol,
    params.fat,
    params.fiber,
    params.foodName,
    params.potassium,
    params.calcium,
    params.iron,
    params.magnesium,
    params.vitaminC,
    params.vitaminD,
    params.vitaminB12,
    params.nutritionDetails,
    params.protein,
    params.saturatedFat,
    params.sodium,
    params.sugar,
  ]);
  useEffect(() => {
    if (selected) setVisibility(selected.defaultVisibility);
    setSubmetricValues({});
    setExtraSubmetricsOpen(false);
  }, [selected]);
  useEffect(() => {
    if (selected?.id !== "water") return;
    const parameterValue =
      params.metric === "water" && params.value !== undefined
        ? params.value
        : undefined;
    setValue(parameterValue || "0.25");
    setWaterTouched(Boolean(parameterValue));
  }, [params.metric, params.value, selected?.id]);
  const numericToday = selected
    ? safeMetricValue(state, selected, state.currentUserId, logDate)
    : 0;
  const textToday =
    selected?.dataType === "text"
      ? latestTextValue(state, selected.id, state.currentUserId, logDate)
      : "";
  const replaceMode =
    selected?.id === "steps" || selected?.aggregation === "latest";

  function storePickedImage(
    result: ImagePicker.ImagePickerResult,
    setter: (uri: string) => void,
  ) {
    if (result.canceled) return;
    const asset = result.assets[0];
    setter(
      asset.base64
        ? `data:${asset.mimeType ?? "image/jpeg"};base64,${asset.base64}`
        : asset.uri,
    );
  }
  async function takeImage(setter: (uri: string) => void) {
    if (tutorialSandbox) return;
    if (Platform.OS !== "web") {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(
          "Camera permission needed",
          "Allow camera access to take a photo for this log.",
        );
        return;
      }
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      quality: 0.8,
      base64: Platform.OS === "web",
    });
    storePickedImage(result, setter);
  }
  async function chooseImage(setter: (uri: string) => void) {
    if (tutorialSandbox) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
      base64: Platform.OS === "web",
    });
    storePickedImage(result, setter);
  }
  function pickImage(setter: (uri: string) => void) {
    if (tutorialSandbox) return;
    Alert.alert("Attach a photo", "Choose how to add it.", [
      {
        text: "Camera",
        onPress: () => void takeImage(setter),
      },
      {
        text: "Photo library",
        onPress: () => void chooseImage(setter),
      },
      { text: "Cancel", style: "cancel" },
    ]);
  }
  function entryTimestamp(localDate = logDate, localTime = logTime) {
    const date = new Date(
      `${localDate}T${/^\d{2}:\d{2}$/.test(localTime) ? localTime : "12:00"}:00`,
    );
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  function clearEntry() {
    setValue(selected?.id === "water" ? "0.25" : "");
    setWaterTouched(false);
    setLabel("");
    setNote("");
    setEntryImage(null);
    setProtein("");
    setFat("");
    setCarbs("");
    setFiber("");
    setSodium("");
    setSugar("");
    setSaturatedFat("");
    setCholesterol("");
    setPotassium("");
    setCalcium("");
    setIron("");
    setMagnesium("");
    setVitaminC("");
    setVitaminD("");
    setVitaminB12("");
    setSupplementalNutrition({});
    setNutritionOpen(false);
    setMoreNutrition(false);
    setOpenNutritionGroups([]);
    setWorkoutDuration("");
    setWorkoutCalories("");
    setWorkoutDistance("");
    setBpDiastolic("");
    setBpPulse("");
    setSubmetricValues({});
  }
  const waterLiters =
    selected?.id === "water" ? Number(value.replace(",", ".")) : Number.NaN;
  const waterCups = Number.isFinite(waterLiters) ? waterLiters * 4 : 1;
  function adjustWaterCups(change: -1 | 1) {
    const current = Number.isFinite(waterCups) ? Math.round(waterCups) : 1;
    const next = Math.max(1, Math.min(40, current + change));
    setValue(String(next / 4));
    setWaterTouched(true);
  }
  function toggleBoolean() {
    if (!selected) return;
    const recordedAt = entryTimestamp();
    if (!recordedAt) return;
    logMetric(selected.id, numericToday <= 0, visibility, "replace", {
      note: note.trim() || undefined,
      localDate: logDate,
      recordedAt,
    });
  }
  function saveEntry(afterSave?: () => void): boolean {
    if (!selected) return false;
    const recordedAt = entryTimestamp();
    if (!recordedAt) {
      Alert.alert(
        "Check the date",
        "Use YYYY-MM-DD and a 24-hour time such as 18:30.",
      );
      return false;
    }
    const nutrition: NutritionDetails = {
      mealType,
      proteinG: parsePositiveFoodNutrientAmount(protein),
      fatG: parsePositiveFoodNutrientAmount(fat),
      carbsG: parsePositiveFoodNutrientAmount(carbs),
      fiberG: parsePositiveFoodNutrientAmount(fiber),
      sodiumMg: parsePositiveFoodNutrientAmount(sodium),
      sugarG: parsePositiveFoodNutrientAmount(sugar),
      saturatedFatG: parsePositiveFoodNutrientAmount(saturatedFat),
      cholesterolMg: parsePositiveFoodNutrientAmount(cholesterol),
      potassiumMg: parsePositiveFoodNutrientAmount(potassium),
      calciumMg: parsePositiveFoodNutrientAmount(calcium),
      ironMg: parsePositiveFoodNutrientAmount(iron),
      magnesiumMg: parsePositiveFoodNutrientAmount(magnesium),
      vitaminCMg: parsePositiveFoodNutrientAmount(vitaminC),
      vitaminDMcg: parsePositiveFoodNutrientAmount(vitaminD),
      vitaminB12Mcg: parsePositiveFoodNutrientAmount(vitaminB12),
    };
    for (const nutrient of SUPPLEMENTAL_FOOD_NUTRIENTS) {
      const raw = supplementalNutrition[nutrient.nutritionKey] ?? "";
      const amount = parsePositiveFoodNutrientAmount(raw);
      if (amount !== undefined)
        nutrition[nutrient.nutritionKey] = amount;
    }
    const details = {
      label: label.trim() || undefined,
      note: note.trim() || undefined,
      imageUri: entryImage ?? undefined,
      localDate: logDate,
      recordedAt,
      nutrition: selected.id === "food" ? nutrition : undefined,
      submetricValues:
        selected.id === "blood_pressure_systolic"
          ? Object.fromEntries(
              [
                ["systolic", value],
                ["diastolic", bpDiastolic],
                ["pulse", bpPulse],
              ]
                .map(([id, raw]) =>
                  [id, Number(raw.replace(",", "."))] as const,
                )
                .filter(([, amount]) => Number.isFinite(amount)),
            )
          : Object.fromEntries(
              Object.entries(submetricValues)
                .map(([id, raw]) =>
                  [id, Number(raw.replace(",", "."))] as const,
                )
                .filter(([, amount]) => Number.isFinite(amount)),
            ),
    };
    if (selected.dataType === "photo") {
      if (!entryImage) {
        Alert.alert(
          "Choose a photo",
          "Attach the progress photo you want to save.",
        );
        return false;
      }
      addPhoto(
        entryImage,
        label.trim() || note.trim(),
        visibility === "status" ? "private" : visibility,
        logDate,
        recordedAt,
      );
      const weight = Number(value.replace(",", "."));
      if (Number.isFinite(weight) && weight > 0)
        logMetric(
          "weight",
          weight,
          visibility === "group" ? "group" : "private",
          "replace",
          { localDate: logDate, recordedAt, label: "Progress photo weight" },
        );
      clearEntry();
      Alert.alert(
        "Photo saved",
        weight > 0
          ? "The photo and matching weight were saved."
          : "The progress photo was saved.",
      );
      afterSave?.();
      return true;
    }
    if (selected.dataType === "boolean") {
      logMetric(selected.id, true, visibility, "replace", details);
      if (selected.id === "workout")
        (
          [
            ["workout_duration", workoutDuration],
            ["exercise", workoutCalories],
            ["workout_distance", workoutDistance],
          ] as const
        ).forEach(([metricId, raw]) => {
          const amount = Number(raw.replace(",", "."));
          if (Number.isFinite(amount) && amount > 0)
            logMetric(metricId, amount, visibility, "add", details);
        });
      clearEntry();
      Alert.alert("Logged", `${selected.name} marked complete.`);
      afterSave?.();
      return true;
    }
    if (selected.dataType === "text") {
      if (!value.trim()) {
        Alert.alert(
          "Add some text",
          "Write the entry you want to save.",
        );
        return false;
      }
      logMetric(selected.id, value.trim(), visibility, "add", details);
      clearEntry();
      Alert.alert("Saved", `${selected.name} was added.`);
      afterSave?.();
      return true;
    }
    const derivedMainValue = selected.submetrics
      ?.map((submetric) =>
        Number((submetricValues[submetric.id] ?? "").replace(",", ".")),
      )
      .find((amount) => Number.isFinite(amount));
    const number = selected.id === "blood_pressure_systolic"
      ? Number(value.replace(",", "."))
      : mainValueEnabled
      ? Number(value.replace(",", "."))
      : (derivedMainValue ?? Number.NaN);
    if (!Number.isFinite(number) || number < 0) {
      Alert.alert("Check the value", "Enter a positive number.");
      return false;
    }
    if (
      selected.id === "water" &&
      (number <= 0 || Math.abs(number * 4 - Math.round(number * 4)) > 0.000001)
    ) {
      Alert.alert(
        "Check the value",
        "Use whole 250 ml cups.",
      );
      return false;
    }
    if (
      selected.id === "blood_pressure_systolic" &&
      (!Number.isFinite(Number(bpDiastolic.replace(",", "."))) ||
        Number(bpDiastolic.replace(",", ".")) <= 0)
    ) {
      Alert.alert(
        "Add diastolic pressure",
        "A blood pressure reading needs both systolic and diastolic values.",
      );
      return false;
    }
    logMetric(
      selected.id,
      number,
      visibility,
      replaceMode ? "replace" : "add",
      details,
      selected.id === "steps"
        ? { source: "log-ui", deviceOwnedMetric: "steps" }
        : undefined,
    );
    if (
      selected.id !== "food" &&
      selected.id !== "blood_pressure_systolic"
    )
      (selected.submetrics ?? []).forEach((submetric) => {
        if (!submetric.linkedMetricId) return;
        const amount = Number(
          (submetricValues[submetric.id] ?? "").replace(",", "."),
        );
        if (!Number.isFinite(amount)) return;
        logMetric(submetric.linkedMetricId, amount, visibility, "add", {
          label: `${selected.name} · ${submetric.name}`,
          note: note.trim() || undefined,
          localDate: logDate,
          recordedAt,
        });
      });
    if (selected.id === "blood_pressure_systolic") {
      const companionValues = [
        ["blood_pressure_diastolic", bpDiastolic],
        ["pulse", bpPulse],
      ] as const;
      companionValues.forEach(([metricId, raw]) => {
        const amount = Number(raw.replace(",", "."));
        if (
          Number.isFinite(amount) &&
          amount > 0
        )
          logMetric(metricId, amount, visibility, "add", {
            ...details,
            label: "Blood pressure reading",
          });
      });
    }
    if (selected.id === "weight" && entryImage)
      addPhoto(
        entryImage,
        label.trim() || `Weight check-in · ${number} ${selected.unit}`,
        visibility === "status" ? "private" : visibility,
        logDate,
        recordedAt,
      );
    clearEntry();
    Alert.alert(
      "Saved",
      `${selected.name} was added to ${logDate === dateKey() ? "today" : logDate}.`,
    );
    afterSave?.();
    return true;
  }
  clearEntryRef.current = clearEntry;
  saveEntryRef.current = saveEntry;

  useEffect(
    () =>
      navigation.addListener("beforeRemove", (event) => {
        if (
          allowLeaveRef.current ||
          promptOpenRef.current ||
          !hasDraftRef.current
        )
          return;
        event.preventDefault();
        promptOpenRef.current = true;
        const leave = () => {
          allowLeaveRef.current = true;
          promptOpenRef.current = false;
          navigation.dispatch(event.data.action);
          setTimeout(() => {
            allowLeaveRef.current = false;
          }, 0);
        };
        Alert.alert(
          "Keep this log?",
          "You have data that has not been saved yet.",
          [
            {
              text: "Continue editing",
              style: "cancel",
              onPress: () => {
                promptOpenRef.current = false;
              },
            },
            {
              text: "Discard",
              style: "destructive",
              onPress: () => {
                clearEntryRef.current();
                leave();
              },
            },
            {
              text: "Save & leave",
              onPress: () => {
                if (!saveEntryRef.current(leave))
                  promptOpenRef.current = false;
              },
            },
          ],
        );
      }),
    [navigation],
  );
  useEffect(
    () =>
      navigation.addListener("blur", () => {
        if (
          allowLeaveRef.current ||
          internalNavigationRef.current ||
          promptOpenRef.current ||
          !hasDraftRef.current
        )
          return;
        promptOpenRef.current = true;
        const continueEditing = () => {
          promptOpenRef.current = false;
          router.navigate("/log" as never);
        };
        Alert.alert(
          "Keep this log?",
          "You have data that has not been saved yet.",
          [
            {
              text: "Continue editing",
              style: "cancel",
              onPress: continueEditing,
            },
            {
              text: "Discard",
              style: "destructive",
              onPress: () => {
                clearEntryRef.current();
                promptOpenRef.current = false;
              },
            },
            {
              text: "Save",
              onPress: () => {
                const saved = saveEntryRef.current(() => {
                  promptOpenRef.current = false;
                });
                if (!saved) promptOpenRef.current = false;
              },
            },
          ],
        );
      }),
    [navigation],
  );
  const selectedPrivacyOption =
    privacyOptions.find((option) => option.value === visibility) ??
    privacyOptions[0];

  return (
    <Screen
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingBottom: 14 }}
    >
      <PageHeader
        title="Log"
        tutorialId="log-header"
        action={
          <Pressable
            onPress={() =>
              openLogChild(() => router.navigate("/timer" as never))
            }
            style={[styles.timerShortcut, { borderColor: accent }]}
          >
            <Ionicons name="timer-outline" size={17} color={accent} />
            <Text style={[styles.timerShortcutText, { color: accent }]}>
              Timer
            </Text>
          </Pressable>
        }
      />
      <View style={styles.selector}>
        <MetricSelector
          title="What are you adding?"
          items={trackerChoices.map((metric) => ({
            id: metric.id,
            label: metric.name,
            icon: metric.icon as keyof typeof Ionicons.glyphMap,
            color: metric.color,
            sublabel: metrics.some((candidate) => candidate.id === metric.id)
              ? "Ready to log"
              : "Synced or calculated · view history",
          }))}
          selectedIds={selected ? [selected.id] : []}
          onChange={(ids) => {
            const next = ids[0];
            if (!next) return;
            if (metrics.some((metric) => metric.id === next))
              setSelectedId(next);
            else
              openLogChild(() =>
                router.navigate({
                  pathname: "/metric-detail",
                  params: { metric: next, date: logDate },
                } as never),
              );
          }}
          multiple={false}
        />
      </View>
      {selected ? (
        <Card style={styles.logCard}>
          <View style={styles.heading}>
            <View
              style={[
                styles.metricIcon,
                { backgroundColor: `${selected.color}18` },
              ]}
            >
              <Ionicons
                name={selected.icon as keyof typeof Ionicons.glyphMap}
                size={25}
                color={selected.color}
              />
            </View>
            <View style={styles.grow}>
              <Text style={[styles.metricName, { color: colors.ink }]}>
                {selected.name}
              </Text>
              <Text style={[styles.currentValue, { color: colors.muted }]}>
                {logDate === dateKey() ? "Today" : logDate}:{" "}
                {selected.dataType === "text"
                  ? textToday || "No entry yet"
                  : formatMetricValue(selected, numericToday)}
              </Text>
            </View>
            <TutorialTarget id="log-visibility">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Who can see it?"
                accessibilityValue={{ text: selectedPrivacyOption.label }}
                accessibilityState={{ expanded: privacyMenuOpen }}
                onPress={() => setPrivacyMenuOpen((open) => !open)}
                style={[
                  styles.defaultPill,
                  { backgroundColor: colors.primarySoft },
                ]}
              >
                <Ionicons
                  name={selectedPrivacyOption.icon}
                  size={13}
                  color={accent}
                />
                <Text style={styles.defaultText}>Default</Text>
                <Ionicons
                  name={privacyMenuOpen ? "chevron-up" : "chevron-down"}
                  size={13}
                  color={accent}
                />
              </Pressable>
            </TutorialTarget>
          </View>
          {privacyMenuOpen ? (
            <View
              style={[
                styles.headingPrivacyMenu,
                { borderColor: colors.border, backgroundColor: colors.card },
              ]}
            >
              {privacyOptions.map((option) => {
                const selectedOption = visibility === option.value;
                return (
                  <Pressable
                    key={option.value}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selectedOption }}
                    onPress={() => {
                      setVisibility(option.value);
                      // This control is the tracker-wide default, not a
                      // one-off entry override. AppProvider applies it to
                      // existing rows too; later manual and health imports
                      // inherit the same backend-enforced disclosure choice.
                      updateMetric(selected.id, {
                        defaultVisibility: option.value,
                      });
                      setPrivacyMenuOpen(false);
                      if (option.value === "status")
                        tutorial.reportEvent({
                          actionId: "tutorial.log.visibility",
                          scope: "isolated-preview",
                        });
                    }}
                    style={[
                      styles.privacyMenuOption,
                      selectedOption && { backgroundColor: colors.primarySoft },
                    ]}
                  >
                    <Ionicons
                      name={option.icon}
                      size={16}
                      color={selectedOption ? accent : colors.muted}
                    />
                    <Text
                      style={[styles.privacyMenuOptionText, { color: colors.ink }]}
                    >
                      {option.label}
                    </Text>
                    {selectedOption ? (
                      <Ionicons name="checkmark" size={16} color={accent} />
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          ) : null}
          <TutorialTarget id="log-date-time">
          <View style={styles.dateCard}>
            <View style={styles.dateTopRow}>
              <Pressable
                onPress={() => setLogCalendarOpen((open) => !open)}
                style={styles.calendarButton}
              >
                <Ionicons
                  name="calendar-outline"
                  size={18}
                  color={accent}
                />
                <View style={styles.grow}>
                  <Text style={[styles.fieldLabel, { color: colors.muted }]}>
                    Date
                  </Text>
                  <Text style={[styles.calendarText, { color: colors.ink }]}>
                    {logDate}
                  </Text>
                </View>
                <Ionicons
                  name={logCalendarOpen ? "chevron-up" : "chevron-down"}
                  size={16}
                  color={colors.muted}
                />
              </Pressable>
              <View style={styles.timeField}>
                <TimeInput
                  value={logTime}
                  onChange={setLogTime}
                  label="Time"
                  wheelPicker
                />
              </View>
              <Pressable
                onPress={() => {
                  const current = new Date();
                  setLogDate(dateKey());
                  setLogTime(
                    `${String(current.getHours()).padStart(2, "0")}:${String(current.getMinutes()).padStart(2, "0")}`,
                  );
                  setLogCalendarOpen(false);
                }}
                style={[
                  styles.nowButton,
                  { backgroundColor: colors.primarySoft },
                ]}
              >
                <Ionicons
                  name="time-outline"
                  size={17}
                  color={accent}
                />
                <Text style={styles.nowText}>Now</Text>
              </Pressable>
            </View>
            {logCalendarOpen ? (
              <View style={styles.miniCalendar}>
                <MonthCalendar
                  monthDate={logDate}
                  selectedDate={logDate}
                  onMonthChange={setLogDate}
                  onSelect={(date) => {
                    setLogDate(date);
                    setLogCalendarOpen(false);
                  }}
                />
              </View>
            ) : null}
          </View>
          </TutorialTarget>
          {selected.id === "food" ? (
            <>
              <Text style={[styles.fieldLabel, { color: colors.muted }]}>Meal</Text>
              <View style={styles.mealTypes}>
                {(["breakfast", "lunch", "dinner", "snack"] as MealType[]).map((item) => (
                  <Chip
                    key={item}
                    label={item[0].toUpperCase() + item.slice(1)}
                    selected={mealType === item}
                    onPress={() => setMealType(item)}
                  />
                ))}
              </View>
              <Text style={[styles.fieldLabel, { color: colors.muted }]}>
                What did you eat?
              </Text>
              <TutorialTarget id="log-food-search">
              <View
                style={[styles.foodNameRow, { borderColor: colors.border }]}
              >
                <TextInput
                  value={label}
                  onChangeText={setLabel}
                  enterKeyHint="search"
                  returnKeyType="search"
                  submitBehavior="submit"
                  onSubmitEditing={() =>
                    openLogChild(() =>
                      router.navigate({
                        pathname: "/food-search",
                        params: { q: label },
                      }),
                    )
                  }
                  placeholder="Food, product, or brand"
                  placeholderTextColor={colors.faint}
                  style={[styles.foodNameInput, { color: colors.ink }]}
                />
                <Pressable
                  accessibilityLabel="Search foods"
                  onPress={() =>
                    openLogChild(() =>
                      router.navigate({
                        pathname: "/food-search",
                        params: { q: label },
                      }),
                    )
                  }
                  style={[styles.foodSearchButton, { backgroundColor: accent }]}
                >
                  <Ionicons name="search" size={18} color={palette.white} />
                </Pressable>
                <Pressable
                  accessibilityLabel="Scan barcode"
                  onPress={() =>
                    openLogChild(() =>
                      router.navigate({
                        pathname: "/food-search",
                        params: { mode: "scan" },
                      }),
                    )
                  }
                  style={[
                    styles.foodScanButton,
                    { backgroundColor: colors.primarySoft },
                  ]}
                >
                  <Ionicons name="barcode-outline" size={19} color={accent} />
                </Pressable>
              </View>
              </TutorialTarget>
              <Text style={[styles.fieldLabel, { color: colors.muted }]}>
                Calories
              </Text>
            </>
          ) : null}
          {selected.dataType === "photo" ? (
            <>
              <Text style={styles.fieldLabel}>
                Weight on this date (optional)
              </Text>
              <View style={styles.numberWrap}>
                <TextInput
                  value={value}
                  onChangeText={setValue}
                  keyboardType="decimal-pad"
                  placeholder="e.g. 82.4"
                  placeholderTextColor={palette.faint}
                  style={styles.numberInput}
                />
                <Text style={styles.unit}>kg</Text>
              </View>
              <Text style={styles.fieldLabel}>Caption (optional)</Text>
              <TextInput
                value={label}
                onChangeText={setLabel}
                placeholder="A short note about this photo"
                placeholderTextColor={palette.faint}
                style={styles.fieldInput}
              />
            </>
          ) : selected.dataType === "boolean" && selected.id !== "workout" ? (
            <Pressable
              onPress={toggleBoolean}
              style={[styles.completion, { backgroundColor: colors.canvas }]}
            >
              <Ionicons
                name={numericToday > 0 ? "checkmark-circle" : "ellipse-outline"}
                size={32}
                color={numericToday > 0 ? accent : colors.faint}
              />
              <View>
                <Text style={styles.completionTitle}>
                  {numericToday > 0 ? "Completed" : "Mark as complete"}
                </Text>
                <Text style={styles.helper}>Tap to toggle this date</Text>
              </View>
            </Pressable>
          ) : selected.dataType === "text" ? (
            <TextInput
              value={value}
              onChangeText={setValue}
              placeholder={`Write this ${selected.name.toLowerCase()}…`}
              placeholderTextColor={palette.faint}
              style={[styles.fieldInput, styles.textArea]}
              multiline
            />
          ) : selected.id === "blood_pressure_systolic" ? (
            <>
              <Text style={[styles.fieldLabel, { color: colors.muted }]}>Blood pressure reading</Text>
              <View style={styles.nutritionGrid}>
                {[
                  { label: "Systolic", value, set: setValue, unit: "mmHg" },
                  { label: "Diastolic", value: bpDiastolic, set: setBpDiastolic, unit: "mmHg" },
                  { label: "Pulse", value: bpPulse, set: setBpPulse, unit: "bpm" },
                ].map((item) => (
                  <View key={item.label} style={styles.nutritionField}>
                    <Text style={[styles.nutritionLabel, { color: colors.muted }]}>{item.label}</Text>
                    <View style={[styles.nutritionInput, { borderColor: colors.border }]}>
                      <TextInput
                        value={item.value}
                        onChangeText={item.set}
                        keyboardType="decimal-pad"
                        placeholder="0"
                        placeholderTextColor={colors.faint}
                        style={[styles.nutritionText, { color: colors.ink }]}
                      />
                      <Text style={[styles.nutritionUnit, { color: colors.muted }]}>{item.unit}</Text>
                    </View>
                  </View>
                ))}
              </View>
            </>
          ) : mainValueEnabled ? (
            <>
              {selected.id === "water" ? (
                <>
                  <View style={styles.waterStepper}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Remove 250 millilitres"
                      disabled={waterCups <= 1}
                      onPress={() => adjustWaterCups(-1)}
                      style={[
                        styles.waterStepButton,
                        { backgroundColor: colors.primarySoft },
                        waterCups <= 1 && styles.waterStepDisabled,
                      ]}
                    >
                      <Ionicons name="remove" size={20} color={accent} />
                    </Pressable>
                    <View
                      style={[
                        styles.waterInputWrap,
                        { borderColor: colors.border },
                      ]}
                    >
                      <TextInput
                        accessibilityLabel="Water amount in litres"
                        keyboardType="decimal-pad"
                        value={value}
                        onChangeText={(next) => {
                          setValue(next);
                          setWaterTouched(true);
                        }}
                        selectTextOnFocus
                        style={[styles.waterInput, { color: colors.ink }]}
                      />
                      <Text style={[styles.unit, { color: colors.muted }]}>L</Text>
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Add 250 millilitres"
                      onPress={() => adjustWaterCups(1)}
                      style={[
                        styles.waterStepButton,
                        { backgroundColor: colors.primarySoft },
                      ]}
                    >
                      <Ionicons name="add" size={20} color={accent} />
                    </Pressable>
                  </View>
                  <Text
                    translate={false}
                    style={[styles.waterEquivalent, { color: colors.muted }]}
                  >
                    {Number.isFinite(waterLiters)
                      ? `${Math.round(waterLiters * 1000).toLocaleString(locale)} ml · ${waterCups.toLocaleString(locale, { maximumFractionDigits: 2 })} ${Math.abs(waterCups - 1) < 0.001 ? "cup" : "cups"}`
                      : "250 ml · 1 cup"}
                  </Text>
                </>
              ) : (
                <View style={styles.numberWrap}>
                  <TextInput
                    accessibilityLabel={`${selected.name} value`}
                    keyboardType="decimal-pad"
                    value={value}
                    onChangeText={setValue}
                    placeholder={replaceMode ? "Day's total" : "Amount to add"}
                    placeholderTextColor={palette.faint}
                    style={[styles.numberInput, { color: colors.ink }]}
                  />
                  <Text style={styles.unit}>{selected.unit}</Text>
                </View>
              )}
            </>
          ) : null}
          {selected.submetrics?.length &&
          selected.id !== "food" &&
          selected.id !== "blood_pressure_systolic" ? (
            <>
              {visibleSubmetrics.map((submetric) => (
                <View key={submetric.id} style={styles.nutritionField}>
                  <Text style={[styles.nutritionLabel, { color: colors.muted }]}>
                    {submetric.name}
                  </Text>
                  <View
                    style={[
                      styles.nutritionInput,
                      { borderColor: colors.border },
                    ]}
                  >
                    <TextInput
                      value={submetricValues[submetric.id] ?? ""}
                      onChangeText={(raw) =>
                        setSubmetricValues((current) => ({
                          ...current,
                          [submetric.id]: raw,
                        }))
                      }
                      keyboardType="decimal-pad"
                      placeholder="0"
                      placeholderTextColor={colors.faint}
                      style={[styles.nutritionText, { color: colors.ink }]}
                    />
                    <Text style={[styles.nutritionUnit, { color: colors.muted }]}>
                      {submetric.unit}
                    </Text>
                  </View>
                </View>
              ))}
              {selected.submetricDisplay?.collapsible &&
              collapsedSubmetrics.length ? (
                <>
                  <Pressable
                    onPress={() => setExtraSubmetricsOpen((open) => !open)}
                    style={styles.moreNutrition}
                  >
                    <Text style={[styles.moreNutritionText, { color: accent }]}>
                      {selected.submetricDisplay.collapsibleLabel ??
                        "More fields"}
                    </Text>
                    <Ionicons
                      name={
                        extraSubmetricsOpen ? "chevron-up" : "chevron-down"
                      }
                      size={16}
                      color={accent}
                    />
                  </Pressable>
                  {extraSubmetricsOpen ? (
                    <View style={styles.nutritionGrid}>
                      {collapsedSubmetrics.map((submetric) => (
                          <View
                            key={submetric.id}
                            style={styles.nutritionField}
                          >
                            <Text
                              style={[
                                styles.nutritionLabel,
                                { color: colors.muted },
                              ]}
                            >
                              {submetric.name}
                            </Text>
                            <View
                              style={[
                                styles.nutritionInput,
                                { borderColor: colors.border },
                              ]}
                            >
                              <TextInput
                                value={submetricValues[submetric.id] ?? ""}
                                onChangeText={(raw) =>
                                  setSubmetricValues((current) => ({
                                    ...current,
                                    [submetric.id]: raw,
                                  }))
                                }
                                keyboardType="decimal-pad"
                                placeholder="0"
                                placeholderTextColor={colors.faint}
                                style={[
                                  styles.nutritionText,
                                  { color: colors.ink },
                                ]}
                              />
                              <Text
                                style={[
                                  styles.nutritionUnit,
                                  { color: colors.muted },
                                ]}
                              >
                                {submetric.unit}
                              </Text>
                            </View>
                          </View>
                        ))}
                    </View>
                  ) : null}
                </>
              ) : null}
            </>
          ) : null}
          {selected.id === "food" ? (
            <>
              {false ? (
                <>
                  <Pressable
                    onPress={() => router.push("/food-search")}
                    style={[
                      styles.foodLookup,
                      { backgroundColor: colors.primarySoft },
                    ]}
                  >
                    <Ionicons name="barcode-outline" size={20} color={accent} />
                    <View style={styles.grow}>
                      <Text style={[styles.foodLookupTitle, { color: accent }]}>
                        Scan barcode or search foods
                      </Text>
                      <Text style={styles.helper}>
                        Fill nutrition, then review it.
                      </Text>
                    </View>
                    <Ionicons
                      name="chevron-forward"
                      size={17}
                      color={colors.faint}
                    />
                  </Pressable>
                  <Text style={styles.fieldLabel}>What did you eat?</Text>
                  <TextInput
                    value={label}
                    onChangeText={setLabel}
                    placeholder="e.g. Chicken rice bowl"
                    placeholderTextColor={palette.faint}
                    style={styles.fieldInput}
                  />
                </>
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: nutritionOpen }}
                onPress={() => setNutritionOpen((open) => !open)}
                style={[
                  styles.nutritionDisclosure,
                  {
                    borderColor: colors.border,
                    backgroundColor: "transparent",
                  },
                ]}
              >
                <View style={styles.nutritionDisclosureCopy}>
                  <Text style={[styles.nutritionDisclosureTitle, { color: colors.ink }]}>
                    Nutrition (optional)
                  </Text>
                  <Text style={[styles.nutritionDisclosureHint, { color: colors.muted }]}>
                    Protein, carbs, fat, vitamins and minerals
                  </Text>
                </View>
                <Ionicons
                  name={nutritionOpen ? "chevron-up" : "chevron-down"}
                  size={16}
                  color={colors.muted}
                />
              </Pressable>
              {nutritionOpen ? (
                <View style={styles.nutritionDetails}>
                  <View style={styles.nutritionGrid}>
                    {[
                      {
                        label: "Protein",
                        value: protein,
                        set: setProtein,
                        unit: "g",
                      },
                      { label: "Fat", value: fat, set: setFat, unit: "g" },
                      { label: "Carbs", value: carbs, set: setCarbs, unit: "g" },
                      { label: "Fiber", value: fiber, set: setFiber, unit: "g" },
                    ].map((item) => (
                      <View key={item.label} style={styles.nutritionField}>
                        <Text style={styles.nutritionLabel}>{item.label}</Text>
                        <View style={styles.nutritionInput}>
                          <TextInput
                            value={item.value}
                            onChangeText={item.set}
                            keyboardType="decimal-pad"
                            placeholder="0"
                            placeholderTextColor={palette.faint}
                            style={styles.nutritionText}
                          />
                          <Text style={styles.nutritionUnit}>{item.unit}</Text>
                        </View>
                      </View>
                    ))}
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ expanded: moreNutrition }}
                    onPress={() => setMoreNutrition((open) => !open)}
                    style={styles.moreNutrition}
                  >
                    <Text style={[styles.moreNutritionText, { color: accent }]}>
                      Add vitamins, minerals and more
                    </Text>
                    <Ionicons
                      name={moreNutrition ? "chevron-up" : "chevron-down"}
                      size={16}
                      color={accent}
                    />
                  </Pressable>
                  {moreNutrition ? (
                    <View style={styles.nutritionGroups}>
                      {EXTRA_NUTRITION_GROUPS.map((group) => {
                        const fields = extraNutritionFields.filter(
                          (field) => field.group === group.id,
                        );
                        if (!fields.length) return null;
                        const expanded = openNutritionGroups.includes(group.id);
                        const entered = fields.filter(
                          (field) =>
                            parsePositiveFoodNutrientAmount(field.value) !==
                            undefined,
                        ).length;
                        return (
                          <View
                            key={group.id}
                            style={[
                              styles.nutritionGroup,
                              { borderColor: colors.border },
                            ]}
                          >
                            <Pressable
                              accessibilityRole="button"
                              accessibilityState={{ expanded }}
                              onPress={() =>
                                setOpenNutritionGroups((current) =>
                                  current.includes(group.id)
                                    ? current.filter((id) => id !== group.id)
                                    : [...current, group.id],
                                )
                              }
                              style={styles.nutritionGroupHeader}
                            >
                              <View style={styles.grow}>
                                <Text
                                  style={[
                                    styles.nutritionGroupTitle,
                                    { color: colors.ink },
                                  ]}
                                >
                                  {group.label}
                                </Text>
                                <Text
                                  style={[
                                    styles.nutritionGroupHint,
                                    { color: colors.muted },
                                  ]}
                                >
                                  {entered
                                    ? `${entered} added · ${group.hint}`
                                    : group.hint}
                                </Text>
                              </View>
                              <Ionicons
                                name={expanded ? "chevron-up" : "chevron-down"}
                                size={16}
                                color={accent}
                              />
                            </Pressable>
                            {expanded ? (
                              <View
                                style={[
                                  styles.nutritionGroupFields,
                                  { borderTopColor: colors.border },
                                ]}
                              >
                                <View style={styles.nutritionGrid}>
                                  {fields.map((item) => (
                                    <View
                                      key={item.id}
                                      style={styles.nutritionField}
                                    >
                                      <Text style={styles.nutritionLabel}>
                                        {item.label}
                                      </Text>
                                      <View style={styles.nutritionInput}>
                                        <TextInput
                                          value={item.value}
                                          onChangeText={item.set}
                                          keyboardType="decimal-pad"
                                          placeholder="0"
                                          placeholderTextColor={palette.faint}
                                          style={styles.nutritionText}
                                        />
                                        <Text style={styles.nutritionUnit}>
                                          {item.unit}
                                        </Text>
                                      </View>
                                    </View>
                                  ))}
                                </View>
                              </View>
                            ) : null}
                          </View>
                        );
                      })}
                    </View>
                  ) : null}
                </View>
              ) : null}
            </>
          ) : null}
          {selected.id === "workout" ? (
            <>
              <Text style={styles.fieldLabel}>Workout type</Text>
              <TextInput
                value={label}
                onChangeText={setLabel}
                placeholder="e.g. Walk, strength training, cycling"
                placeholderTextColor={palette.faint}
                style={styles.fieldInput}
              />
              <Text style={styles.fieldLabel}>Workout details</Text>
              <View style={styles.nutritionGrid}>
                {[
                  {
                    label: "Duration",
                    value: workoutDuration,
                    set: setWorkoutDuration,
                    unit: "min",
                  },
                  {
                    label: "Calories",
                    value: workoutCalories,
                    set: setWorkoutCalories,
                    unit: "kcal",
                  },
                  {
                    label: "Distance",
                    value: workoutDistance,
                    set: setWorkoutDistance,
                    unit: "km",
                  },
                ].map((item) => (
                  <View key={item.label} style={styles.nutritionField}>
                    <Text style={styles.nutritionLabel}>{item.label}</Text>
                    <View style={styles.nutritionInput}>
                      <TextInput
                        value={item.value}
                        onChangeText={item.set}
                        keyboardType="decimal-pad"
                        placeholder="0"
                        placeholderTextColor={palette.faint}
                        style={styles.nutritionText}
                      />
                      <Text style={styles.nutritionUnit}>{item.unit}</Text>
                    </View>
                  </View>
                ))}
              </View>
            </>
          ) : null}
          <Text style={[styles.fieldLabel, { color: colors.muted }]}>
            Note (optional)
          </Text>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="Context, how it felt, where it came from…"
            placeholderTextColor={palette.faint}
            style={[
              styles.fieldInput,
              styles.noteInput,
              { color: colors.ink, borderColor: colors.border },
            ]}
            multiline
          />
          {entryImage ? (
            <View style={styles.entryImageWrap}>
              <Image
                source={{ uri: entryImage }}
                style={styles.entryImage}
                contentFit="cover"
              />
              <Pressable
                onPress={() => setEntryImage(null)}
                style={styles.removeImage}
              >
                <Ionicons name="close" size={16} color={palette.white} />
              </Pressable>
            </View>
          ) : null}
          <Pressable
            onPress={() => pickImage(setEntryImage)}
            style={styles.attachRow}
          >
            <Ionicons name="camera-outline" size={19} color={accent} />
            <Text style={[styles.attachText, { color: accent }]}>
              {entryImage ? "Change attached photo" : "Attach a photo"}
            </Text>
          </Pressable>
          <Button
            label={
              replaceMode
                ? "Save today's total"
                : `Add ${selected.name.toLowerCase()}`
            }
            icon="checkmark"
            onPress={() => saveEntry()}
            disabled={
              selected.dataType === "photo"
                ? !entryImage
                : selected.id === "blood_pressure_systolic"
                  ? !value.trim() || !bpDiastolic.trim()
                : selected.dataType !== "boolean" &&
                  mainValueEnabled &&
                  !value.trim()
                  ? true
                  : selected.dataType !== "boolean" &&
                      !mainValueEnabled &&
                      !Object.values(submetricValues).some((raw) =>
                        Number.isFinite(Number(raw.replace(",", "."))),
                      )
            }
          />
        </Card>
      ) : null}
    </Screen>
  );
}

export default LogScreen;

const styles = StyleSheet.create({
  timerShortcut: {
    minHeight: 34,
    borderWidth: 1,
    borderRadius: 11,
    paddingHorizontal: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  timerShortcutText: { ...typography.supporting, fontWeight: "900" },
  mealTypes: { flexDirection: "row", flexWrap: "wrap", gap: 5, marginBottom: 8 },
  compactHeader: {
    height: 38,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  compactTitle: { fontSize: 13, fontWeight: "900", color: palette.ink },
  selector: { marginBottom: 8 },
  dateCard: { marginBottom: 8 },
  dateTopRow: { flexDirection: "row", alignItems: "flex-end", gap: 5 },
  calendarButton: {
    flex: 1.45,
    minWidth: 0,
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 12,
    paddingHorizontal: 8,
  },
  calendarText: {
    color: palette.ink,
    ...typography.body,
    fontWeight: "900",
    marginTop: -5,
  },
  miniCalendar: {
    borderTopWidth: 1,
    borderTopColor: palette.border,
    paddingTop: 11,
    marginTop: 10,
  },
  timeField: { flex: 1, minWidth: 0 },
  dateInput: {
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 11,
    paddingHorizontal: 10,
    paddingVertical: 7,
    color: palette.ink,
    fontSize: 10,
    fontWeight: "700",
  },
  nowButton: {
    height: 42,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 7,
    borderRadius: 11,
    backgroundColor: palette.primarySoft,
  },
  nowText: { color: palette.primary, ...typography.body, fontWeight: "800" },
  logCard: { marginBottom: 12, paddingVertical: 10 },
  heading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    marginBottom: 9,
  },
  metricIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  grow: { flex: 1 },
  metricName: { color: palette.ink, ...typography.sectionTitle },
  currentValue: { color: palette.muted, ...typography.supporting, marginTop: 2 },
  defaultPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: palette.primarySoft,
    borderRadius: 10,
    padding: 6,
  },
  defaultText: { color: palette.primary, ...typography.supporting, fontWeight: "800" },
  headingPrivacyMenu: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 4,
    marginTop: -3,
    marginBottom: 9,
  },
  numberWrap: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: palette.border,
    borderRadius: 13,
    paddingHorizontal: 11,
    marginBottom: 8,
  },
  numberInput: {
    flex: 1,
    color: palette.ink,
    ...typography.cardTitle,
    fontWeight: "800",
    paddingVertical: 9,
  },
  unit: { color: palette.muted, ...typography.supporting },
  fieldLabel: {
    color: palette.ink,
    ...typography.cardTitle,
    marginBottom: 4,
    marginTop: 2,
  },
  fieldLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    alignSelf: "flex-start",
  },
  fieldInput: {
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: palette.ink,
    ...typography.body,
    marginBottom: 8,
  },
  textArea: { minHeight: 68, textAlignVertical: "top" },
  noteInput: { minHeight: 46, textAlignVertical: "top" },
  foodNameRow: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 12,
    marginBottom: 7,
    overflow: "hidden",
  },
  foodNameInput: { flex: 1, paddingHorizontal: 10, ...typography.body },
  foodSearchButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  foodScanButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  foodLookup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    backgroundColor: palette.primarySoft,
    borderRadius: 14,
    padding: 11,
    marginBottom: 14,
  },
  foodLookupTitle: { color: palette.primary, ...typography.cardTitle },
  nutritionDisclosure: {
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 11,
    paddingVertical: 8,
    marginBottom: 8,
  },
  waterAmounts: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 5,
    marginBottom: 7,
  },
  waterStepper: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
  },
  waterStepButton: {
    width: 42,
    height: 42,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  waterStepDisabled: { opacity: 0.4 },
  waterInputWrap: {
    flex: 1,
    height: 42,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1.5,
    borderRadius: 13,
    paddingHorizontal: 11,
  },
  waterInput: {
    flex: 1,
    minWidth: 0,
    textAlign: "center",
    ...typography.cardTitle,
    fontWeight: "900",
    paddingVertical: 8,
  },
  waterEquivalent: {
    ...typography.supporting,
    fontWeight: "800",
    textAlign: "center",
    marginBottom: 8,
  },
  nutritionDisclosureCopy: { flex: 1 },
  nutritionDisclosureTitle: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    fontWeight: "400",
  },
  nutritionDisclosureHint: { ...typography.supporting, marginTop: 1 },
  nutritionDetails: { marginBottom: 2 },
  nutritionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 12,
  },
  moreNutrition: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 9,
    marginBottom: 8,
  },
  moreNutritionText: { ...typography.body, fontWeight: "800" },
  nutritionGroups: { gap: 8, marginBottom: 12 },
  nutritionGroup: { borderWidth: 1, borderRadius: 12, overflow: "hidden" },
  nutritionGroupHeader: {
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  nutritionGroupTitle: { ...typography.body, fontWeight: "900" },
  nutritionGroupHint: { ...typography.supporting, marginTop: 1 },
  nutritionGroupFields: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingTop: 10,
  },
  nutritionField: { flexBasis: "47%", flexGrow: 1, minWidth: 112 },
  nutritionLabel: {
    color: palette.muted,
    ...typography.supporting,
    fontWeight: "800",
    marginBottom: 4,
  },
  nutritionInput: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 10,
    paddingHorizontal: 8,
  },
  nutritionText: {
    flex: 1,
    minWidth: 0,
    color: palette.ink,
    ...typography.cardTitle,
    fontWeight: "800",
    paddingVertical: 8,
    paddingRight: 4,
  },
  nutritionUnit: {
    flexShrink: 0,
    marginLeft: 2,
    color: palette.faint,
    ...typography.supporting,
  },
  completion: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 16,
    backgroundColor: palette.canvas,
    marginBottom: 14,
  },
  completionTitle: { color: palette.ink, ...typography.sectionTitle, fontWeight: "800" },
  helper: { color: palette.muted, ...typography.supporting, marginTop: 2 },
  attachRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    alignSelf: "flex-start",
    paddingVertical: 8,
    marginBottom: 7,
  },
  attachText: { color: palette.primary, ...typography.body, fontWeight: "800" },
  entryImageWrap: { width: 120, height: 92, position: "relative" },
  entryImage: { width: 120, height: 92, borderRadius: 13 },
  removeImage: {
    position: "absolute",
    right: -5,
    top: -5,
    width: 23,
    height: 23,
    borderRadius: 12,
    backgroundColor: palette.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  privacyMenu: { borderWidth: 1, borderRadius: 13, marginBottom: 10, overflow: "hidden" },
  privacyMenuButton: {
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 11,
  },
  privacyMenuValue: { flex: 1, ...typography.body, fontWeight: "800" },
  privacyMenuList: { borderTopWidth: 1, padding: 5, gap: 2 },
  privacyMenuOption: {
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 9,
    paddingHorizontal: 8,
  },
  privacyMenuOptionText: { flex: 1, ...typography.body, fontWeight: "700" },
  privacyBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: palette.primarySoft,
    borderRadius: 13,
    padding: 10,
    marginBottom: 14,
  },
  privacyText: {
    flex: 1,
    color: palette.primary,
    ...typography.body,
    fontWeight: "700",
  },
  photoPreview: {
    width: "100%",
    aspectRatio: 1.5,
    borderRadius: 16,
    marginBottom: 14,
  },
  photoActions: { flexDirection: "row", gap: 9 },
  photoEmpty: { flexDirection: "row", alignItems: "center", gap: 12 },
  photoIcon: {
    width: 49,
    height: 49,
    borderRadius: 16,
    backgroundColor: palette.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  photoTitle: { color: palette.ink, ...typography.sectionTitle, fontWeight: "800" },
});
