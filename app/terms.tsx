import {
  ExternalLegalLink,
  HABHUB_SUPPORT_EMAIL,
  LegalDocumentScreen,
  LegalRouteLink,
  LegalSection,
  supportMailto,
} from "@/src/components/LegalDocument";
import { CURRENT_TERMS_VERSION, policyVersionLabel } from "@/src/legal/policy";

export default function TermsScreen() {
  return (
    <LegalDocumentScreen
      title="Terms of Use"
      subtitle="The rules for using HabHub and its shared spaces."
      badge="Clear expectations for a respectful community"
      badgeIcon="reader-outline"
      updated={policyVersionLabel(CURRENT_TERMS_VERSION)}
      reviewRequired
    >
      <LegalSection title="Who these terms are for">
        These terms apply when you use HabHub, including its local demo,
        signed-in cloud account, connected-health, group, challenge, chat,
        photo, journal, reminder, workout, widget, and optional AI features. If
        you do not accept the final published terms, do not create an account
        or continue using the service.
      </LegalSection>

      <LegalSection title="Health and fitness information">
        HabHub is a self-tracking and accountability tool. It is not a medical
        device, diagnostic service, treatment, emergency service, or substitute
        for advice from a qualified professional. Metrics, estimates, nutrition
        records, body-profile visuals, scores, streaks, and AI-assisted results
        can be incomplete or inaccurate. Seek appropriate professional help for
        health decisions or emergencies.
      </LegalSection>

      <LegalSection title="Your account and security">
        Keep your sign-in method and devices secure, provide accurate account
        information, and tell support promptly if you believe someone accessed
        your account without permission. You are responsible for activity from
        your account until access is secured or the account is deleted.
      </LegalSection>

      <LegalSection title="Your content and sharing choices">
        You retain responsibility for content you add, including tracker data,
        notes, photos, chat messages, and challenge content. You give HabHub the
        limited permission needed to store, process, synchronize, display, and
        deliver that content according to the visibility and group choices you
        make. Do not share another person&apos;s sensitive information without
        permission.
      </LegalSection>

      <LegalSection title="Community conduct">
        Do not use HabHub to harass, threaten, impersonate, exploit, or deceive
        others; publish illegal, hateful, sexually exploitative, or infringing
        material; distribute malware or spam; evade access controls; or misuse
        health information. Use the in-app report and block controls for harmful
        content or conduct, or contact support for account-level escalation and
        appeals. Every cloud report enters a protected operator queue, and the
        reported account cannot decide its own report. Public community
        operation also requires the monitored moderation ownership and response
        process listed in the release checklist.
      </LegalSection>

      <LegalSection title="Connected services">
        Apple Health, Android Health Connect, Google Health, notification
        providers, authentication providers, food databases, and any configured
        AI provider have their own terms and availability. You choose whether
        to connect optional services and may need to grant or revoke permissions
        in platform settings. HabHub cannot guarantee that a third-party service
        will always be available or complete.
      </LegalSection>

      <LegalSection title="Acceptable technical use">
        Do not probe or bypass security, scrape private data, overload the
        service, interfere with other accounts, reverse engineer protected
        service components where prohibited by law, or use automated access
        outside interfaces HabHub intentionally provides.
      </LegalSection>

      <LegalSection title="Availability and changes">
        Features may change as the product evolves. HabHub should communicate
        material changes before they take effect where required. No promise of
        uninterrupted availability is made, and you should keep exports of data
        you cannot afford to lose.
      </LegalSection>

      <LegalSection title="Ending use and deleting data">
        You may stop using HabHub at any time. Signed-in users can initiate
        permanent account deletion in Settings. The public deletion page also
        explains how to request deletion without the installed app. Deletion
        and any legally required retention are described in the Privacy &amp;
        Health Data Policy.
      </LegalSection>

      <LegalSection title="Terms that must be finalized before launch">
        The operator must obtain qualified legal review and finalize the legal
        entity and address, eligible age and guardian rules, governing law,
        dispute process, warranty and liability language, availability regions,
        consumer cancellation rights, and an effective-date/change-notice
        process before asking public store users to accept these terms.
      </LegalSection>

      <LegalSection title="Contact">
        Questions about these terms can be sent to {HABHUB_SUPPORT_EMAIL}.
      </LegalSection>

      <ExternalLegalLink
        label="Email HabHub support"
        url={supportMailto("HabHub terms question")}
        icon="mail-outline"
      />
      <LegalRouteLink label="Community Guidelines" route="/community-guidelines" />
      <LegalRouteLink label="Privacy & Health Data Policy" route="/privacy" />
      <LegalRouteLink label="Support" route="/support" />
      <LegalRouteLink label="Account deletion" route="/delete-account" />
    </LegalDocumentScreen>
  );
}
