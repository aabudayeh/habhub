import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import {
  AppText as Text,
  AppTextInput as TextInput,
} from "@/src/components/AppText";
import { LocalizedAlert as Alert, useTranslation } from "@/src/i18n";

import { Button, Card, Screen } from "@/src/components/ui";
import { useAuth } from "@/src/auth/AuthProvider";
import {
  useAppColors,
  useGroupAccent,
} from "@/src/theme";
import { rememberPendingInvite } from "@/src/domain/invites";
import { readableAuthError } from "@/src/domain/authErrors";

type Mode = "sign-in" | "sign-up" | "magic";

export default function SignInScreen() {
  const auth = useAuth();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const t = useTranslation();
  const params = useLocalSearchParams<{ invite?: string }>();
  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const lastEmailRequestAt = useRef(0);
  // Release posture: Apple OAuth stays disabled until account deletion can
  // revoke its provider token. Google is hidden on iOS so that build uses only
  // HabHub's email/password and magic-link account system.
  const showGoogleOAuth = Platform.OS !== "ios";

  useEffect(() => {
    void rememberPendingInvite(params.invite);
  }, [params.invite]);

  if (auth.status === "loading")
    return (
      <View style={[styles.loading, { backgroundColor: colors.canvas }]}>
        <ActivityIndicator color={accent} />
      </View>
    );
  if (auth.status === "signedIn" || auth.status === "demo")
    return (
      <Redirect
        href={
          params.invite
            ? `/join?code=${encodeURIComponent(params.invite)}`
            : "/"
        }
      />
    );

  const validEmail =
    /^[^\s@]+@[^\s@]+\.[a-z]{2,63}$/i.test(email.trim()) &&
    email.trim().length <= 254;
  async function run(label: string, action: () => Promise<void>) {
    if (busy) return;
    if (
      ["signup", "magic", "reset"].includes(label) &&
      Date.now() - lastEmailRequestAt.current < 60_000
    )
      return Alert.alert(
        "Email already requested",
        "Wait one minute before requesting another account email.",
      );
    setBusy(label);
    try {
      await action();
      if (["signup", "magic", "reset"].includes(label))
        lastEmailRequestAt.current = Date.now();
    } catch (error) {
      Alert.alert(
        "Could not continue",
        readableAuthError(error),
      );
    } finally {
      setBusy(null);
    }
  }

  async function submit() {
    if (!validEmail)
      return Alert.alert("Check your email", "Enter a valid email address.");
    if (mode !== "magic" && password.length < 8)
      return Alert.alert(
        "Password is too short",
        "Use at least 8 characters.",
      );
    if (mode === "magic") {
      await run("magic", async () => {
        await auth.sendMagicLink(email);
        Alert.alert(
          "Check your inbox",
          "Open the secure HabHub link on this device.",
        );
      });
      return;
    }
    if (mode === "sign-up") {
      await run("signup", async () => {
        const result = await auth.signUp(email, password);
        if (result === "verification-required")
          Alert.alert(
            "Verify your email",
            "Use the link we sent, then return to HabHub.",
          );
      });
      return;
    }
    await run("signin", () => auth.signInWithPassword(email, password));
  }

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: colors.canvas }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Screen
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.screen}
      >
        <View style={styles.brand}>
          <Image
            source={require("../assets/images/habhub-icon.png")}
            style={[styles.mark, { borderColor: colors.border }]}
            contentFit="cover"
            accessibilityLabel="HabHub logo"
          />
          <Text style={[styles.name, { color: colors.ink }]}>HabHub</Text>
          <Text style={[styles.tagline, { color: colors.muted }]}>
            Track anything. Progress together.
          </Text>
        </View>
        <Card style={styles.card}>
          <Text style={[styles.title, { color: colors.ink }]}>
            {mode === "sign-up"
              ? "Create your account"
              : mode === "magic"
                ? "Email sign-in link"
                : "Welcome back"}
          </Text>
          <Text style={[styles.subtitle, { color: colors.muted }]}>
            Your private data stays available offline and syncs securely when
            you sign in.
          </Text>
          <View style={[styles.tabs, { backgroundColor: colors.canvas }]}>
            <Tab
              label="Sign in"
              selected={mode === "sign-in"}
              onPress={() => setMode("sign-in")}
            />
            <Tab
              label="Create account"
              selected={mode === "sign-up"}
              onPress={() => setMode("sign-up")}
            />
            <Tab
              label="Magic link"
              selected={mode === "magic"}
              onPress={() => setMode("magic")}
            />
          </View>
          <Text style={[styles.label, { color: colors.muted }]}>Email</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            placeholder="you@example.com"
            placeholderTextColor={colors.faint}
            style={[
              styles.input,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                color: colors.ink,
              },
            ]}
          />
          {mode !== "magic" ? (
            <>
              <Text style={[styles.label, { color: colors.muted }]}>
                Password
              </Text>
              <TextInput
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                autoComplete={
                  mode === "sign-up" ? "new-password" : "current-password"
                }
                placeholder="At least 8 characters"
                placeholderTextColor={colors.faint}
                style={[
                  styles.input,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                    color: colors.ink,
                  },
                ]}
              />
            </>
          ) : null}
          <Button
            label={
              mode === "sign-up"
                ? "Create account"
                : mode === "magic"
                  ? "Send secure link"
                  : "Sign in"
            }
            icon={mode === "magic" ? "mail-outline" : "log-in-outline"}
            loading={
              busy !== null &&
              busy !== "reset" &&
              busy !== "google" &&
              busy !== "demo"
            }
            onPress={submit}
          />
          {mode === "sign-in" && validEmail ? (
            <Pressable
              onPress={() =>
                run("reset", async () => {
                  await auth.requestPasswordReset(email);
                  Alert.alert(
                    "Reset link sent",
                    "Check your inbox to choose a new password.",
                  );
                })
              }
              style={styles.forgot}
            >
              <Text style={[styles.forgotText, { color: accent }]}>
                {busy === "reset" ? "Sending…" : "Forgot password?"}
              </Text>
            </Pressable>
          ) : null}
          {showGoogleOAuth ? (
            <>
              <View style={styles.divider}>
                <View
                  style={[styles.line, { backgroundColor: colors.border }]}
                />
                <Text style={[styles.or, { color: colors.faint }]}>OR</Text>
                <View
                  style={[styles.line, { backgroundColor: colors.border }]}
                />
              </View>
              <View style={styles.providers}>
                <View style={styles.provider}>
                  <Button
                    label="Google"
                    variant="ghost"
                    icon="logo-google"
                    loading={busy === "google"}
                    onPress={() =>
                      run("google", () => auth.signInWithProvider("google"))
                    }
                  />
                </View>
              </View>
            </>
          ) : null}
          {auth.authError ? (
            <View
              accessibilityLiveRegion="polite"
              style={[
                styles.authError,
                {
                  backgroundColor: `${colors.red}14`,
                  borderColor: `${colors.red}55`,
                },
              ]}
            >
              <Ionicons name="alert-circle-outline" size={17} color={colors.red} />
              <Text style={[styles.authErrorText, { color: colors.ink }]}>
                {auth.authError}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Dismiss sign-in error"
                hitSlop={8}
                onPress={auth.clearAuthError}
              >
                <Ionicons name="close" size={17} color={colors.muted} />
              </Pressable>
            </View>
          ) : null}
        </Card>
        <Pressable
          onPress={() => run("demo", auth.continueInDemo)}
          style={[
            styles.demo,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Ionicons name="flask-outline" size={17} color={accent} />
          <View style={styles.demoCopy}>
            <Text style={[styles.demoTitle, { color: colors.ink }]}>
              Try the full demo first
            </Text>
            <Text style={[styles.demoText, { color: colors.muted }]}>
              No account or cloud project required.
            </Text>
          </View>
          <Ionicons
            name="chevron-forward"
            size={16}
            color={colors.faint}
          />
        </Pressable>
        <Text style={[styles.terms, { color: colors.faint }]}>
          By continuing, you agree to the Terms of Use and acknowledge the
          Privacy &amp; Health Data Policy.
        </Text>
        <View style={styles.legalLinks}>
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={t("Read Privacy & Health Data Policy")}
            onPress={() => router.push("/privacy" as never)}
            style={styles.policyLink}
          >
            <Text style={[styles.policyLinkText, { color: accent }]}>
              {t("Privacy & Health Data Policy")}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="link"
            accessibilityLabel="Read Terms of Use"
            onPress={() => router.push("/terms" as never)}
            style={styles.policyLink}
          >
            <Text translate={false} style={[styles.policyLinkText, { color: accent }]}>
              Terms of Use
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="link"
            accessibilityLabel="Open HabHub support"
            onPress={() => router.push("/support" as never)}
            style={styles.policyLink}
          >
            <Text translate={false} style={[styles.policyLinkText, { color: accent }]}>
              Support
            </Text>
          </Pressable>
        </View>
        <Pressable
          accessibilityRole="link"
          onPress={() => void Linking.openURL("https://platform.fatsecret.com")}
          style={styles.attribution}
        >
          <Text style={[styles.attributionText, { color: colors.faint }]}>
            Nutrition search may be powered by fatsecret Platform API
          </Text>
        </Pressable>
      </Screen>
    </KeyboardAvoidingView>
  );
}

function Tab({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const colors = useAppColors();
  const accent = useGroupAccent();
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.tab,
        { borderColor: selected ? colors.border : "transparent" },
        selected && { backgroundColor: colors.card },
      ]}
    >
      <Text
        style={[
          styles.tabText,
          { color: selected ? accent : colors.muted },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  screen: {
    flexGrow: 1,
    justifyContent: "center",
    paddingTop: 48,
    paddingBottom: 36,
  },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  brand: { alignItems: "center", marginBottom: 22 },
  mark: {
    width: 58,
    height: 58,
    borderRadius: 19,
    borderWidth: 1,
  },
  name: {
    fontSize: 25,
    fontWeight: "900",
    marginTop: 10,
    letterSpacing: -0.6,
  },
  tagline: { fontSize: 12, marginTop: 3 },
  card: { padding: 20 },
  title: { fontSize: 21, fontWeight: "900" },
  subtitle: { fontSize: 11, lineHeight: 17, marginTop: 4, marginBottom: 16 },
  tabs: {
    flexDirection: "row",
    borderRadius: 12,
    padding: 3,
    marginBottom: 16,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 8,
    borderRadius: 9,
    borderWidth: 1,
  },
  tabText: { fontSize: 9, fontWeight: "800" },
  label: {
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.5,
    marginBottom: 5,
    textTransform: "uppercase",
  },
  input: {
    borderWidth: 1,
    borderRadius: 13,
    paddingHorizontal: 13,
    paddingVertical: 12,
    marginBottom: 13,
  },
  forgot: { alignSelf: "center", padding: 10 },
  forgotText: { fontSize: 10, fontWeight: "800" },
  divider: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginVertical: 13,
  },
  line: { height: 1, flex: 1 },
  or: { fontSize: 8, fontWeight: "900" },
  providers: { flexDirection: "row", gap: 8 },
  provider: { flex: 1 },
  authError: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 12,
    paddingHorizontal: 11,
    paddingVertical: 10,
    borderWidth: 1,
    borderRadius: 12,
  },
  authErrorText: { flex: 1, fontSize: 10, lineHeight: 14, fontWeight: "700" },
  demo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    marginTop: 14,
    padding: 15,
    borderWidth: 1,
    borderRadius: 17,
  },
  demoCopy: { flex: 1 },
  demoTitle: { fontSize: 11, fontWeight: "900" },
  demoText: { fontSize: 9, marginTop: 2 },
  terms: {
    fontSize: 8,
    lineHeight: 13,
    textAlign: "center",
    marginHorizontal: 24,
    marginTop: 14,
  },
  legalLinks: {
    minHeight: 44,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
    columnGap: 18,
  },
  policyLink: { alignSelf: "center", minHeight: 44, justifyContent: "center" },
  policyLinkText: {
    fontSize: 9,
    lineHeight: 14,
    fontWeight: "900",
    textDecorationLine: "underline",
  },
  attribution: { alignSelf: "center", paddingHorizontal: 12, paddingVertical: 7 },
  attributionText: { fontSize: 8, textAlign: "center", textDecorationLine: "underline" },
});
