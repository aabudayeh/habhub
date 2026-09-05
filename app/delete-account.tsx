import { router } from "expo-router";
import { Linking, View } from "react-native";

import { useAuth } from "@/src/auth/AuthProvider";
import { AppText as Text } from "@/src/components/AppText";
import {
  HABHUB_SUPPORT_EMAIL,
  LegalDocumentScreen,
  LegalRouteLink,
  LegalSection,
  legalDocumentStyles,
  supportMailto,
} from "@/src/components/LegalDocument";
import { Button } from "@/src/components/ui";
import { useAppColors } from "@/src/theme";

const deletionMailto = supportMailto("HabHub account deletion request");

export default function DeleteAccountScreen() {
  const auth = useAuth();
  const colors = useAppColors();
  const signedIn = auth.status === "signedIn";

  return (
    <LegalDocumentScreen
      title="Delete your HabHub account"
      subtitle="A public path to permanent account and data deletion."
      badge="Deletion is available in-app and without the installed app"
      badgeIcon="trash-outline"
      updated="4 September 2026"
    >
      <LegalSection title="Fastest option">
        If you can sign in, open Settings, go to Data controls, and choose Delete
        cloud account and data. HabHub asks for confirmation and reports any
        deletion failure instead of silently claiming success.
      </LegalSection>

      <View style={legalDocumentStyles.actions}>
        {signedIn ? (
          <Button
            label="Open account settings"
            translate={false}
            icon="settings-outline"
            onPress={() => router.push("/settings" as never)}
          />
        ) : (
          <Button
            label="Sign in to delete now"
            translate={false}
            icon="log-in-outline"
            onPress={() => router.push("/sign-in" as never)}
          />
        )}
        <Button
          label="Request deletion by email"
          translate={false}
          icon="mail-outline"
          variant="ghost"
          onPress={() => void Linking.openURL(deletionMailto)}
        />
      </View>

      <LegalSection title="Request deletion without the app">
        Email {HABHUB_SUPPORT_EMAIL} from the address used for your HabHub
        account with the subject “HabHub account deletion request.” Support must
        verify account ownership before deletion. The operator must publish the
        expected manual-response timeline before store submission.
      </LegalSection>

      <View
        style={[
          legalDocumentStyles.callout,
          { backgroundColor: colors.canvas, borderColor: colors.border },
        ]}
      >
        <Text
          translate={false}
          accessibilityRole="header"
          style={[legalDocumentStyles.calloutTitle, { color: colors.ink }]}
        >
          What deletion covers
        </Text>
        <Text
          translate={false}
          style={[legalDocumentStyles.calloutBody, { color: colors.muted }]}
        >
          The current deletion service removes the account, cloud snapshot,
          uploaded media, sent chat messages, tracker entries, progress posts,
          comments and reactions, group to-dos and challenges, and templates
          authored by that account. Interactions attached to deleted content are
          also removed. Surviving challenge rosters and other members&apos; private
          sync snapshots are scrubbed of the deleted account identity. A report
          filed by the account is deleted after service-operator review. While
          review is still queued, its reporter account identifier is removed,
          but its reason, details, relevant evidence, status, and timestamps are
          retained in the service-operator review queue for the published safety
          retention period so unresolved abuse evidence cannot be erased.
          Reports filed by other people retain their reason and status but are
          stripped of the deleted subject&apos;s identity snapshot and copied
          message text. Google Health access is disconnected first. Existing groups can transfer to
          another active member. Processor backups expire under configured
          retention schedules; any legally required exception must be stated in
          the final reviewed privacy policy.
        </Text>
      </View>

      <LegalSection title="Before deleting">
        Export any data you want to keep from Settings. Deletion cannot be
        undone. Deleting the app from a device does not delete a cloud account,
        and disconnecting a health source alone does not delete the account.
      </LegalSection>

      <LegalSection title="If deletion does not complete">
        Keep the failure message, then contact support. Completed cleanup steps
        are not restored, and the remaining deletion can be retried. Do not
        assume the account is deleted until HabHub or support confirms
        completion.
      </LegalSection>

      <LegalRouteLink label="Privacy & Health Data Policy" route="/privacy" />
      <LegalRouteLink label="Terms of Use" route="/terms" />
      <LegalRouteLink label="Support" route="/support" />
    </LegalDocumentScreen>
  );
}
