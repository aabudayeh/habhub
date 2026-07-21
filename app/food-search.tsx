import { Ionicons } from "@expo/vector-icons";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { AppText as Text } from "@/src/components/AppText";

import {
  Button,
  Card,
  Chip,
  IconButton,
  PageHeader,
  Screen,
} from "@/src/components/ui";
import {
  foodByBarcode,
  FoodProduct,
  searchFoods,
} from "@/src/food/openFoodFacts";
import { palette, useAppColors, useGroupAccent } from "@/src/theme";

export default function FoodSearchScreen() {
  const params = useLocalSearchParams<{ q?: string; mode?: string }>();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const [mode, setMode] = useState<"search" | "scan">(
    params.mode === "scan" ? "scan" : "search",
  );
  const [permission, requestPermission] = useCameraPermissions();
  const [query, setQuery] = useState(params.q ?? "");
  const [results, setResults] = useState<FoodProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanned, setScanned] = useState(false);
  const [selected, setSelected] = useState<FoodProduct | null>(null);
  const [multiplier, setMultiplier] = useState("1");
  const scrollRef = useRef<ScrollView>(null);
  const searchedInitially = useRef(false);

  async function search(term = query) {
    if (term.trim().length < 2) return;
    setLoading(true);
    setError(null);
    try {
      const found = await searchFoods(term);
      setResults(found);
      if (!found.length)
        setError("No matching foods with usable nutrition were found.");
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Food search failed.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (
      !searchedInitially.current &&
      params.q?.trim().length &&
      mode === "search"
    ) {
      searchedInitially.current = true;
      setLoading(true);
      searchFoods(params.q)
        .then((found) => {
          setResults(found);
          if (!found.length)
            setError("No matching foods with usable nutrition were found.");
        })
        .catch((reason) =>
          setError(
            reason instanceof Error ? reason.message : "Food search failed.",
          ),
        )
        .finally(() => setLoading(false));
    }
  }, [mode, params.q]);

  function choose(product: FoodProduct) {
    setSelected(product);
    setMultiplier("1");
    requestAnimationFrame(() =>
      scrollRef.current?.scrollTo({ y: 0, animated: true }),
    );
  }

  async function lookupBarcode(code: string) {
    setScanned(true);
    setLoading(true);
    setError(null);
    try {
      const product = await foodByBarcode(code);
      if (product) choose(product);
      else
        setError(
          "That barcode is not in Open Food Facts. You can enter it manually.",
        );
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Food lookup failed.",
      );
    } finally {
      setLoading(false);
    }
  }

  function apply() {
    if (!selected) return;
    const factor = Math.max(0, Number(multiplier.replace(",", ".")) || 0);
    const scaled = (value?: number) =>
      optional(value === undefined ? undefined : value * factor);
    router.replace({
      pathname: "/(tabs)/log",
      params: {
        metric: "food",
        foodName: `${selected.name}${selected.brand ? ` · ${selected.brand}` : ""} (${factor}× ${selected.basis})`,
        calories: String(Math.round(selected.calories * factor)),
        protein: scaled(selected.proteinG),
        fat: scaled(selected.fatG),
        carbs: scaled(selected.carbsG),
        fiber: scaled(selected.fiberG),
        sodium: scaled(selected.sodiumMg),
        sugar: scaled(selected.sugarG),
        saturatedFat: scaled(selected.saturatedFatG),
        cholesterol: scaled(selected.cholesterolMg),
        potassium: scaled(selected.potassiumMg),
        calcium: scaled(selected.calciumMg),
        iron: scaled(selected.ironMg),
        magnesium: scaled(selected.magnesiumMg),
        vitaminC: scaled(selected.vitaminCMg),
        vitaminD: scaled(selected.vitaminDMcg),
        vitaminB12: scaled(selected.vitaminB12Mcg),
      },
    });
  }

  const factor = Math.max(0, Number(multiplier.replace(",", ".")) || 0);
  return (
    <Screen scrollRef={scrollRef} keyboardShouldPersistTaps="handled">
      <PageHeader
        title="Find food"
        subtitle="Complete, popular database results are shown first."
        showMenu={false}
        action={
          <IconButton
            icon="close"
            label="Close"
            onPress={() => router.back()}
          />
        }
      />
      <View style={styles.tabs}>
        <Chip
          label="Search"
          icon="search-outline"
          selected={mode === "search"}
          onPress={() => setMode("search")}
        />
        <Chip
          label="Scan barcode"
          icon="barcode-outline"
          selected={mode === "scan"}
          onPress={() => setMode("scan")}
        />
      </View>
      {selected ? (
        <Card style={styles.selection}>
          <Text style={[styles.name, { color: colors.ink }]}>
            {selected.name}
          </Text>
          <Text style={[styles.meta, { color: colors.muted }]}>
            {selected.brand ? `${selected.brand} · ` : ""}
            {selected.basis}
          </Text>
          <View style={styles.amountRow}>
            <Pressable
              onPress={() => setMultiplier(String(Math.max(0, factor - 0.5)))}
              style={[styles.step, { backgroundColor: colors.primarySoft }]}
            >
              <Ionicons name="remove" size={18} color={accent} />
            </Pressable>
            <TextInput
              value={multiplier}
              onChangeText={setMultiplier}
              keyboardType="decimal-pad"
              style={[
                styles.amount,
                { color: colors.ink, borderColor: colors.border },
              ]}
            />
            <Pressable
              onPress={() => setMultiplier(String(factor + 0.5))}
              style={[styles.step, { backgroundColor: colors.primarySoft }]}
            >
              <Ionicons name="add" size={18} color={accent} />
            </Pressable>
          </View>
          <FoodPreview
            product={selected}
            factor={factor}
            colors={colors}
            accent={accent}
          />
          <Button label="Use these values" onPress={apply} />
          <Button
            label="Choose another"
            variant="ghost"
            onPress={() => setSelected(null)}
          />
        </Card>
      ) : null}
      {mode === "search" ? (
        <Card style={styles.searchCard}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => search()}
            returnKeyType="search"
            autoFocus={!params.q}
            placeholder="Food, product, or brand"
            placeholderTextColor={colors.faint}
            style={[
              styles.searchInput,
              { color: colors.ink, borderColor: colors.border },
            ]}
          />
          <Pressable
            onPress={() => search()}
            style={[styles.searchButton, { backgroundColor: accent }]}
          >
            <Ionicons name="search" size={19} color={palette.white} />
          </Pressable>
        </Card>
      ) : (
        <Card style={styles.cameraCard}>
          {!permission?.granted ? (
            <View style={styles.permission}>
              <Ionicons name="camera-outline" size={31} color={accent} />
              <Text style={[styles.name, { color: colors.ink }]}>
                Camera access is needed to scan a barcode.
              </Text>
              <Button label="Allow camera" onPress={requestPermission} />
            </View>
          ) : (
            <>
              <CameraView
                style={styles.camera}
                facing="back"
                barcodeScannerSettings={{
                  barcodeTypes: ["ean13", "ean8", "upc_a", "upc_e"],
                }}
                onBarcodeScanned={
                  scanned ? undefined : ({ data }) => lookupBarcode(data)
                }
              />
              <View style={styles.permission}>
                <Text style={[styles.meta, { color: colors.muted }]}>
                  {loading
                    ? "Looking up product…"
                    : "Place the barcode inside the frame"}
                </Text>
                {scanned && !loading ? (
                  <Button
                    label="Scan another"
                    variant="secondary"
                    onPress={() => {
                      setScanned(false);
                      setError(null);
                    }}
                  />
                ) : null}
              </View>
            </>
          )}
        </Card>
      )}
      {loading ? (
        <ActivityIndicator style={styles.loading} color={accent} />
      ) : null}
      {error ? (
        <Card style={styles.notice}>
          <Ionicons
            name="information-circle-outline"
            size={20}
            color={palette.amber}
          />
          <Text style={[styles.meta, { color: colors.muted }]}>{error}</Text>
        </Card>
      ) : null}
      <View style={styles.results}>
        {results.map((product) => (
          <Pressable key={product.code} onPress={() => choose(product)}>
            <Card style={styles.result}>
              {product.imageUrl ? (
                <Image
                  source={{ uri: product.imageUrl }}
                  style={styles.image}
                  contentFit="contain"
                />
              ) : (
                <View
                  style={[
                    styles.image,
                    styles.placeholder,
                    { backgroundColor: colors.primarySoft },
                  ]}
                >
                  <Ionicons
                    name="restaurant-outline"
                    size={20}
                    color={accent}
                  />
                </View>
              )}
              <View style={styles.copy}>
                <View style={styles.nameLine}>
                  <Text
                    style={[styles.name, { color: colors.ink }]}
                    numberOfLines={2}
                  >
                    {product.name}
                  </Text>
                  {product.verified ? (
                    <Text
                      style={[
                        styles.complete,
                        { color: accent, backgroundColor: colors.primarySoft },
                      ]}
                    >
                      VERIFIED
                    </Text>
                  ) : null}
                </View>
                <Text style={[styles.meta, { color: colors.muted }]}>
                  {[product.brand, product.basis, product.source].filter(Boolean).join(" · ")}
                </Text>
                <Text style={[styles.nutrition, { color: accent }]}>
                  {product.calories} kcal
                  {product.proteinG !== undefined
                    ? ` · ${round(product.proteinG)}g protein`
                    : ""}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={17} color={colors.faint} />
            </Card>
          </Pressable>
        ))}
      </View>
      <Text style={[styles.attribution, { color: colors.faint }]}>
        Open Food Facts is community supplied; review the package label before
        saving.
      </Text>
    </Screen>
  );
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}
function optional(value?: number) {
  return value === undefined ? "" : String(round(value));
}
function FoodPreview({
  product,
  factor,
  colors,
  accent,
}: {
  product: FoodProduct;
  factor: number;
  colors: ReturnType<typeof useAppColors>;
  accent: string;
}) {
  const grams = (Number.parseFloat(product.basis) || 100) * factor;
  return (
    <View>
      <Text style={[styles.nutrition, { color: accent }]}>
        {Math.round(product.calories * factor)} kcal · {round(grams)} g
      </Text>
      <Text style={[styles.meta, { color: colors.muted }]}>
        {product.proteinG !== undefined
          ? `${round(product.proteinG * factor)}g protein · `
          : ""}
        {product.fatG !== undefined
          ? `${round(product.fatG * factor)}g fat · `
          : ""}
        {product.carbsG !== undefined
          ? `${round(product.carbsG * factor)}g carbs`
          : ""}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: "row", gap: 7, marginBottom: 9 },
  selection: { gap: 7, marginBottom: 9 },
  amountRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  step: {
    width: 38,
    height: 38,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  amount: {
    flex: 1,
    height: 40,
    borderWidth: 1,
    borderRadius: 11,
    textAlign: "center",
    fontSize: 12,
    fontWeight: "900",
  },
  searchCard: { flexDirection: "row", gap: 7, padding: 9 },
  searchInput: {
    flex: 1,
    height: 42,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 11,
    fontSize: 11,
  },
  searchButton: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  cameraCard: { padding: 0, overflow: "hidden" },
  camera: { width: "100%", aspectRatio: 1.3 },
  permission: { alignItems: "center", gap: 10, padding: 16 },
  loading: { marginVertical: 14 },
  notice: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },
  results: { gap: 7, marginTop: 9 },
  result: {
    minHeight: 72,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    padding: 9,
  },
  image: { width: 52, height: 52, borderRadius: 10 },
  placeholder: { alignItems: "center", justifyContent: "center" },
  copy: { flex: 1 },
  nameLine: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  name: { flex: 1, fontSize: 11, fontWeight: "900" },
  meta: { fontSize: 8, lineHeight: 12, marginTop: 2 },
  nutrition: { fontSize: 9, fontWeight: "900", marginTop: 3 },
  complete: {
    fontSize: 6,
    fontWeight: "900",
    paddingHorizontal: 5,
    paddingVertical: 3,
    borderRadius: 6,
  },
  attribution: { fontSize: 8, lineHeight: 12, textAlign: "center", margin: 14 },
});
