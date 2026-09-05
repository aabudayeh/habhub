import { Linking, View } from "react-native";

import {
  HABHUB_SUPPORT_EMAIL,
  LegalDocumentScreen,
  LegalRouteLink,
  LegalSection,
  legalDocumentStyles,
  supportMailto,
} from "@/src/components/LegalDocument";
import { Button } from "@/src/components/ui";
import { AppText as Text } from "@/src/components/AppText";
import { useAppColors } from "@/src/theme";

export default function SupportScreen() {
  const colors = useAppColors();
  return (
    <LegalDocumentScreen
      title="HabHub Support"
      subtitle="Product help, safety concerns, privacy, and account requests."
      badge="A direct, public way to reach the operator"
      badgeIcon="help-buoy-outline"
      updated="4 September 2026"
    >
      <LegalSection title="How to contact support">
        Email {HABHUB_SUPPORT_EMAIL}. Include the device platform, HabHub app
        version, what you expected, what happened, and the approximate time of
        the issue. Never send a password, one-time code, private health export,
        or an unredacted identity document by email.
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
          Contact
        </Text>
        <Text
          translate={false}
          selectable
          style={[legalDocumentStyles.email, { color: colors.ink }]}
        >
          {HABHUB_SUPPORT_EMAIL}
        </Text>
        <Text
          translate={false}
          style={[legalDocumentStyles.calloutBody, { color: colors.muted }]}
        >
          Support availability and response-time commitments must be finalized
          by the operator before public launch.
        </Text>
      </View>

      <View style={legalDocumentStyles.actions}>
        <Button
          label="Email support"
          translate={false}
          icon="mail-outline"
          onPress={() => void Linking.openURL(supportMailto("HabHub support request"))}
        />
      </View>

      <LegalSection title="Account and privacy help">
        Use the account-deletion page if you cannot access the installed app.
        For privacy requests, identify the email address used for the HabHub
        account so the operator can verify ownership before acting. Do not send
        health records in the first message.
      </LegalSection>

      <LegalSection title="Safety and community reports">
        Email support with the group name, approximate message time, and a short
        description of harmful conduct. Preserve only the minimum screenshot or
        evidence needed for review. In-app reporting and blocking are available
        from Chat, shared Feed updates/comments, and member profiles. Each cloud
        report enters the protected operator queue automatically, including
        reports about a sole group admin; email is the extra-context and appeal
        path. The operator must verify a monitored moderation owner and response
        process before enabling the public community release.
      </LegalSection>

      <LegalSection title="Not emergency or medical support">
        HabHub support cannot provide medical advice or emergency help. Contact
        local emergency services or a qualified health professional when needed.
      </LegalSection>

      <LegalRouteLink label="Community Guidelines" route="/community-guidelines" />
      <LegalRouteLink label="Privacy & Health Data Policy" route="/privacy" />
      <LegalRouteLink label="Terms of Use" route="/terms" />
      <LegalRouteLink label="Request account deletion" route="/delete-account" />
    </LegalDocumentScreen>
  );
}
