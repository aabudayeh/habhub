import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { AppText as Text } from "@/src/components/AppText";

import { Button, Card, Chip, PageHeader, Screen } from "@/src/components/ui";
import { MetricSelector } from "@/src/components/MetricSelector";
import { MonthCalendar } from "@/src/components/MonthCalendar";
import { dateKey } from "@/src/domain/date";
import {
  formatMetricValue,
  latestTextValue,
  safeMetricValue,
} from "@/src/domain/metrics";
import { useApp } from "@/src/state/AppProvider";
import { palette, useAppColors, useGroupAccent } from "@/src/theme";
import { Visibility } from "@/src/types";

const privacyOptions: {
  value: Visibility;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  { value: "private", label: "Only me", icon: "lock-closed-outline" },
  { value: "status", label: "Goal status", icon: "checkmark-circle-outline" },
  { value: "group", label: "Share with group", icon: "people-outline" },
];

export default function LogScreen() {
  const params = useLocalSearchParams<{
    metric?: string;
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
  }>();
  const { state, logMetric, addPhoto } = useApp();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const metrics = useMemo(() => {
    const secondary = new Set([
      "protein",
      "fat",
      "carbs",
      "fiber",
      "sodium",
      "sugar",
      "saturated_fat",
      "cholesterol",
      "potassium",
      "calcium",
      "iron",
      "magnesium",
      "vitamin_c",
      "vitamin_d",
      "vitamin_b12",
      "workout_duration",
      "workout_calories",
      "workout_distance",
      "blood_pressure_diastolic",
    ]);
    return [...state.metrics]
      .filter(
        (metric) =>
          metric.dataType !== "calculated" &&
          metric.id !== "steps" &&
          !(metric.id === "pulse" && state.metrics.some((item) => item.id === "blood_pressure_systolic")) &&
          metric.manualEntry !== false &&
          !secondary.has(metric.id),
      )
      .sort((a, b) => a.order - b.order);
  }, [state.metrics]);
  const [selectedId, setSelectedId] = useState(metrics[0]?.id ?? "");
  const selected =
    state.metrics.find((metric) => metric.id === selectedId) ?? metrics[0];
  const [value, setValue] = useState("");
  const [label, setLabel] = useState("");
  const [note, setNote] = useState("");
  const [visibility, setVisibility] = useState<Visibility>(
    selected?.defaultVisibility ?? "group",
  );
  const [entryImage, setEntryImage] = useState<string | null>(null);
  const now = new Date();
  const [logDate, setLogDate] = useState(dateKey());
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
  const [moreNutrition, setMoreNutrition] = useState(false);
  const [workoutDuration, setWorkoutDuration] = useState("");
  const [workoutCalories, setWorkoutCalories] = useState("");
  const [workoutDistance, setWorkoutDistance] = useState("");
  const [bpDiastolic, setBpDiastolic] = useState("");
  const [bpPulse, setBpPulse] = useState("");

  useEffect(() => {
    if (
      params.metric &&
      state.metrics.some(
        (metric) =>
          metric.id === params.metric && metric.dataType !== "calculated",
      )
    )
      setSelectedId(params.metric);
  }, [params.metric, state.metrics]);
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
    params.protein,
    params.saturatedFat,
    params.sodium,
    params.sugar,
  ]);
  useEffect(() => {
    if (selected) setVisibility(selected.defaultVisibility);
  }, [selected]);
  const numericToday = selected
    ? safeMetricValue(state, selected, state.currentUserId, logDate)
    : 0;
  const textToday =
    selected?.dataType === "text"
      ? latestTextValue(state, selected.id, state.currentUserId, logDate)
      : "";
  const replaceMode =
    selected?.id === "steps" || selected?.aggregation === "latest";

  async function pickImage(setter: (uri: string) => void) {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
      base64: Platform.OS === "web",
    });
    if (!result.canceled) {
      const asset = result.assets[0];
      setter(
        asset.base64
          ? `data:${asset.mimeType ?? "image/jpeg"};base64,${asset.base64}`
          : asset.uri,
      );
    }
  }
  function entryTimestamp(localDate = logDate, localTime = logTime) {
    const date = new Date(
      `${localDate}T${/^\d{2}:\d{2}$/.test(localTime) ? localTime : "12:00"}:00`,
    );
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  function clearEntry() {
    setValue("");
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
    setWorkoutDuration("");
    setWorkoutCalories("");
    setWorkoutDistance("");
    setBpDiastolic("");
    setBpPulse("");
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
  function saveEntry() {
    if (!selected) return;
    const recordedAt = entryTimestamp();
    if (!recordedAt)
      return Alert.alert(
        "Check the date",
        "Use YYYY-MM-DD and a 24-hour time such as 18:30.",
      );
    const nutrition = {
      proteinG: Number(protein) || undefined,
      fatG: Number(fat) || undefined,
      carbsG: Number(carbs) || undefined,
      fiberG: Number(fiber) || undefined,
      sodiumMg: Number(sodium) || undefined,
      sugarG: Number(sugar) || undefined,
      saturatedFatG: Number(saturatedFat) || undefined,
      cholesterolMg: Number(cholesterol) || undefined,
      potassiumMg: Number(potassium) || undefined,
      calciumMg: Number(calcium) || undefined,
      ironMg: Number(iron) || undefined,
      magnesiumMg: Number(magnesium) || undefined,
      vitaminCMg: Number(vitaminC) || undefined,
      vitaminDMcg: Number(vitaminD) || undefined,
      vitaminB12Mcg: Number(vitaminB12) || undefined,
    };
    const details = {
      label: label.trim() || undefined,
      note: note.trim() || undefined,
      imageUri: entryImage ?? undefined,
      localDate: logDate,
      recordedAt,
      nutrition: selected.id === "food" ? nutrition : undefined,
    };
    if (selected.dataType === "photo") {
      if (!entryImage)
        return Alert.alert(
          "Choose a photo",
          "Attach the progress photo you want to save.",
        );
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
      return;
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
      return;
    }
    if (selected.dataType === "text") {
      if (!value.trim())
        return Alert.alert(
          "Add some text",
          "Write the entry you want to save.",
        );
      logMetric(selected.id, value.trim(), visibility, "add", details);
      clearEntry();
      Alert.alert("Saved", `${selected.name} was added.`);
      return;
    }
    const number = Number(value.replace(",", "."));
    if (!Number.isFinite(number) || number < 0)
      return Alert.alert("Check the value", "Enter a positive number.");
    if (
      selected.id === "blood_pressure_systolic" &&
      (!Number.isFinite(Number(bpDiastolic.replace(",", "."))) ||
        Number(bpDiastolic.replace(",", ".")) <= 0)
    )
      return Alert.alert(
        "Add diastolic pressure",
        "A blood pressure reading needs both systolic and diastolic values.",
      );
    logMetric(
      selected.id,
      number,
      visibility,
      replaceMode ? "replace" : "add",
      details,
    );
    if (selected.id === "blood_pressure_systolic") {
      const companionValues = [
        ["blood_pressure_diastolic", bpDiastolic],
        ["pulse", bpPulse],
      ] as const;
      companionValues.forEach(([metricId, raw]) => {
        const amount = Number(raw.replace(",", "."));
        if (
          state.metrics.some((metric) => metric.id === metricId) &&
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
    if (selected.id === "food") {
      (
        [
          ["protein", protein],
          ["fat", fat],
          ["carbs", carbs],
          ["fiber", fiber],
          ["sodium", sodium],
          ["sugar", sugar],
          ["saturated_fat", saturatedFat],
          ["cholesterol", cholesterol],
          ["potassium", potassium],
          ["calcium", calcium],
          ["iron", iron],
          ["magnesium", magnesium],
          ["vitamin_c", vitaminC],
          ["vitamin_d", vitaminD],
          ["vitamin_b12", vitaminB12],
        ] as const
      ).forEach(([metricId, raw]) => {
        const amount = Number(raw.replace(",", "."));
        if (Number.isFinite(amount) && amount > 0)
          logMetric(metricId, amount, visibility, "add", {
            label: label.trim() || selected.name,
            note: note.trim() || undefined,
            localDate: logDate,
            recordedAt,
          });
      });
    }
    clearEntry();
    Alert.alert(
      "Saved",
      `${selected.name} was added to ${logDate === dateKey() ? "today" : logDate}.`,
    );
  }
  const privacyCopy =
    visibility === "private"
      ? "Only you can read this entry, its note, and image."
      : visibility === "status"
        ? "Friends see goal met / not met only—not the value, note, label, or image."
        : "Your group can see the exact value, note, label, and attached image.";

  return (
    <Screen
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingBottom: 14 }}
    >
      <PageHeader title="Log" />
      <View style={styles.selector}>
        <MetricSelector
          title="What are you adding?"
          items={metrics.map((metric) => ({
            id: metric.id,
            label: metric.name,
            icon: metric.icon as keyof typeof Ionicons.glyphMap,
            color: metric.color,
          }))}
          selectedIds={selected ? [selected.id] : []}
          onChange={(ids) => ids[0] && setSelectedId(ids[0])}
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
            <View
              style={[
                styles.defaultPill,
                { backgroundColor: colors.primarySoft },
              ]}
            >
              <Ionicons
                name={
                  selected.defaultVisibility === "private"
                    ? "lock-closed"
                    : selected.defaultVisibility === "status"
                      ? "shield-checkmark"
                      : "people"
                }
                size={12}
                color={accent}
              />
              <Text style={styles.defaultText}>Default</Text>
            </View>
          </View>
          <View style={styles.dateCard}>
            <View style={styles.dateRow}>
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
                <Text style={[styles.fieldLabel, { color: colors.muted }]}>
                  Time
                </Text>
                <TextInput
                  value={logTime}
                  onChangeText={setLogTime}
                  placeholder="HH:MM"
                  placeholderTextColor={palette.faint}
                  style={[
                    styles.dateInput,
                    { color: colors.ink, borderColor: colors.border },
                  ]}
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
          {selected.id === "food" ? (
            <>
              <Text style={[styles.fieldLabel, { color: colors.muted }]}>
                What did you eat?
              </Text>
              <View
                style={[styles.foodNameRow, { borderColor: colors.border }]}
              >
                <TextInput
                  value={label}
                  onChangeText={setLabel}
                  placeholder="Food, product, or brand"
                  placeholderTextColor={colors.faint}
                  style={[styles.foodNameInput, { color: colors.ink }]}
                />
                <Pressable
                  accessibilityLabel="Search foods"
                  onPress={() =>
                    router.navigate({
                      pathname: "/food-search",
                      params: { q: label },
                    })
                  }
                  style={[styles.foodSearchButton, { backgroundColor: accent }]}
                >
                  <Ionicons name="search" size={18} color={palette.white} />
                </Pressable>
                <Pressable
                  accessibilityLabel="Scan barcode"
                  onPress={() =>
                    router.navigate({
                      pathname: "/food-search",
                      params: { mode: "scan" },
                    })
                  }
                  style={[
                    styles.foodScanButton,
                    { backgroundColor: colors.primarySoft },
                  ]}
                >
                  <Ionicons name="barcode-outline" size={19} color={accent} />
                </Pressable>
              </View>
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
          ) : selected.dataType === "boolean" ? (
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
              <Text style={styles.fieldLabel}>Nutrition (optional)</Text>
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
                onPress={() => setMoreNutrition((open) => !open)}
                style={styles.moreNutrition}
              >
                <Text style={[styles.moreNutritionText, { color: accent }]}>
                  {moreNutrition
                    ? "Hide extra nutrients"
                    : "Add vitamins, minerals and more"}
                </Text>
                <Ionicons
                  name={moreNutrition ? "chevron-up" : "chevron-down"}
                  size={16}
                  color={accent}
                />
              </Pressable>
              {moreNutrition ? (
                <View style={styles.nutritionGrid}>
                  {[
                    { label: "Sugar", value: sugar, set: setSugar, unit: "g" },
                    {
                      label: "Sat. fat",
                      value: saturatedFat,
                      set: setSaturatedFat,
                      unit: "g",
                    },
                    {
                      label: "Sodium",
                      value: sodium,
                      set: setSodium,
                      unit: "mg",
                    },
                    {
                      label: "Cholesterol",
                      value: cholesterol,
                      set: setCholesterol,
                      unit: "mg",
                    },
                    {
                      label: "Potassium",
                      value: potassium,
                      set: setPotassium,
                      unit: "mg",
                    },
                    {
                      label: "Calcium",
                      value: calcium,
                      set: setCalcium,
                      unit: "mg",
                    },
                    { label: "Iron", value: iron, set: setIron, unit: "mg" },
                    {
                      label: "Magnesium",
                      value: magnesium,
                      set: setMagnesium,
                      unit: "mg",
                    },
                    {
                      label: "Vitamin C",
                      value: vitaminC,
                      set: setVitaminC,
                      unit: "mg",
                    },
                    {
                      label: "Vitamin D",
                      value: vitaminD,
                      set: setVitaminD,
                      unit: "mcg",
                    },
                    {
                      label: "Vitamin B12",
                      value: vitaminB12,
                      set: setVitaminB12,
                      unit: "mcg",
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
            <Ionicons name="image-outline" size={19} color={accent} />
            <Text style={[styles.attachText, { color: accent }]}>
              {entryImage ? "Change attached image" : "Attach an image"}
            </Text>
          </Pressable>
          <Text style={[styles.fieldLabel, { color: colors.muted }]}>
            Who can see it?
          </Text>
          <View style={styles.privacyRow}>
            {privacyOptions.map((option) => (
              <Chip
                key={option.value}
                label={option.label}
                icon={option.icon}
                selected={visibility === option.value}
                onPress={() => setVisibility(option.value)}
              />
            ))}
          </View>
          <View
            style={[
              styles.privacyBox,
              { backgroundColor: colors.primarySoft },
            ]}
          >
            <Ionicons
              name={
                visibility === "private"
                  ? "lock-closed"
                  : visibility === "status"
                    ? "shield-checkmark"
                    : "people"
              }
              size={16}
              color={accent}
            />
            <Text style={[styles.privacyText, { color: colors.muted }]}>
              {privacyCopy}
            </Text>
          </View>
          <Button
            label={
              replaceMode
                ? "Save today's total"
                : `Add ${selected.name.toLowerCase()}`
            }
            icon="checkmark"
            onPress={saveEntry}
            disabled={
              selected.dataType === "photo"
                ? !entryImage
                : selected.dataType !== "boolean" && !value.trim()
            }
          />
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  compactHeader: {
    height: 38,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  compactTitle: { fontSize: 13, fontWeight: "900", color: palette.ink },
  selector: { marginBottom: 8 },
  dateCard: { marginBottom: 8 },
  dateRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  calendarButton: {
    flex: 1.4,
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 12,
    paddingHorizontal: 10,
  },
  calendarText: {
    color: palette.ink,
    fontSize: 10,
    fontWeight: "900",
    marginTop: -5,
  },
  miniCalendar: {
    borderTopWidth: 1,
    borderTopColor: palette.border,
    paddingTop: 11,
    marginTop: 10,
  },
  timeField: { flex: 1 },
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
    height: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 9,
    borderRadius: 11,
    backgroundColor: palette.primarySoft,
  },
  nowText: { color: palette.primary, fontSize: 10, fontWeight: "800" },
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
  metricName: { color: palette.ink, fontSize: 14, fontWeight: "900" },
  currentValue: { color: palette.muted, fontSize: 9, marginTop: 2 },
  defaultPill: {
    flexDirection: "row",
    gap: 4,
    backgroundColor: palette.primarySoft,
    borderRadius: 10,
    padding: 6,
  },
  defaultText: { color: palette.primary, fontSize: 9, fontWeight: "800" },
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
    fontSize: 12,
    fontWeight: "800",
    paddingVertical: 9,
  },
  unit: { color: palette.muted, fontSize: 10, fontWeight: "700" },
  fieldLabel: {
    color: palette.ink,
    fontSize: 9,
    fontWeight: "900",
    marginBottom: 4,
    marginTop: 2,
  },
  fieldInput: {
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: palette.ink,
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
  foodNameInput: { flex: 1, paddingHorizontal: 10, fontSize: 11 },
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
  foodLookupTitle: { color: palette.primary, fontSize: 11, fontWeight: "900" },
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
  moreNutritionText: { fontSize: 11, fontWeight: "800" },
  nutritionField: { width: "31%", minWidth: 90 },
  nutritionLabel: {
    color: palette.muted,
    fontSize: 9,
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
    color: palette.ink,
    fontSize: 12,
    fontWeight: "800",
    paddingVertical: 8,
  },
  nutritionUnit: { color: palette.faint, fontSize: 8 },
  completion: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 16,
    backgroundColor: palette.canvas,
    marginBottom: 14,
  },
  completionTitle: { color: palette.ink, fontSize: 15, fontWeight: "800" },
  helper: { color: palette.muted, fontSize: 9, lineHeight: 13, marginTop: 2 },
  attachRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    alignSelf: "flex-start",
    paddingVertical: 8,
    marginBottom: 7,
  },
  attachText: { color: palette.primary, fontSize: 10, fontWeight: "800" },
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
  privacyRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
    marginBottom: 10,
  },
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
    fontSize: 10,
    lineHeight: 15,
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
  photoTitle: { color: palette.ink, fontSize: 15, fontWeight: "800" },
});
