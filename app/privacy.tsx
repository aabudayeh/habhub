import {
  ExternalLegalLink as ExternalLink,
  HABHUB_SUPPORT_EMAIL,
  LegalDocumentScreen,
  LegalRouteLink,
  LegalSection,
  supportMailto,
} from "@/src/components/LegalDocument";
import { CURRENT_PRIVACY_VERSION, policyVersionLabel } from "@/src/legal/policy";

const GOOGLE_HEALTH_POLICY_URL =
  "https://developers.google.com/health/policies/health-api-developer-user-data-policy";
const GOOGLE_HEALTH_LIMITED_USE_URL = `${GOOGLE_HEALTH_POLICY_URL}#limited-use`;
const supportUrl =
  process.env.EXPO_PUBLIC_SUPPORT_URL?.trim() ||
  "mailto:ahmad.adayeh@gmail.com";

export default function PrivacyScreen() {
  return (
    <LegalDocumentScreen
      title="Privacy & Health Data Policy"
      subtitle="How HabHub handles account, tracker, device, and health data."
      badge="Privacy controls stay with you"
      badgeIcon="shield-checkmark-outline"
      updated={policyVersionLabel(CURRENT_PRIVACY_VERSION)}
      reviewRequired
    >
      <LegalSection title="Scope and operator">
        This policy covers HabHub&apos;s local demo, account, tracker, body
        profile, group, challenge, chat, journal, photo, workout, reminder,
        notification, screen-time, cloud-sync, AI, and connected-health
        features. HabHub is currently operated by Ahmad Adayeh. Privacy and
        deletion questions can be sent to {HABHUB_SUPPORT_EMAIL}. The operator
        identity, address, retention schedule, and region-specific notices must
        receive qualified legal review before public store submission.
      </LegalSection>

      <LegalSection title="Data you provide">
        HabHub stores account and profile details you provide, including name,
        email-linked account identifiers, body-profile inputs, tracker
        definitions, goals, entries, notes, food and workout records, schedules,
        reminders, photos, chat and challenge content, group activity,
        visibility choices, and settings. Local demo data remains on the device
        unless you sign in and choose an action that synchronizes it.
      </LegalSection>

      <LegalSection title="Connected health data">
        On supported devices, HabHub can read only the Apple Health or Android
        Health Connect categories you grant. The optional Google Health bridge
        can import only the read-only categories authorized through its consent
        flow. Depending on your choices, these categories cover activity and fitness, health measurements, nutrition, and sleep, and can include
        exercise, energy, body measurements, heart rate, hydration, blood
        pressure, blood glucose, and menstrual data. HabHub does not currently
        write data back to those health services.
      </LegalSection>

      <LegalSection title="How health data is used">
        Approved health data is used to populate your private trackers,
        dashboards, history, progress, and goals; reconcile later source
        updates or deletions; and synchronize signed-in HabHub data across your
        devices. Health data is not used for advertising, eligibility decisions,
        or unrelated profiling.
      </LegalSection>

      <LegalSection title="Android screen-time access">
        If you explicitly grant Android Usage Access, HabHub reads approximate
        app foreground time. A private daily total can be stored as a tracker
        entry and synchronized with your signed-in account. The app-by-app
        package breakdown and private app-limit settings remain on that Android
        device and are not uploaded by the current implementation. You can
        revoke Usage Access in Android settings.
      </LegalSection>

      <LegalSection title="Notifications and device data">
        If you enable notifications, HabHub processes a push subscription or
        device push token, platform, language, notification preferences, and
        delivery/routing metadata. Notification providers can process the title,
        message preview, sender label, and destination needed to deliver an
        alert. You can disable HabHub notifications in the app and in system or
        browser settings.
      </LegalSection>

      <LegalSection title="Food search and optional AI">
        Food queries or barcodes can be sent to configured food-data providers,
        including Open Food Facts, USDA FoodData Central, or FatSecret, so
        matching products can be returned. If you explicitly use a configured
        cloud AI action, its prompt and any selected image are sent through a
        HabHub server function to the configured AI provider. Provider keys are
        not stored in the app. Do not submit content you do not want processed
        for that request.
      </LegalSection>

      <LegalSection title="Visibility and sharing">
        Connected-health imports follow the current configured visibility of
        their HabHub tracker. You can change that visibility in the tracker&apos;s settings. Private data remains account-only. Group-visible
        tracker values, photos, messages, challenge activity, and their permitted
        source provenance are shared only with authorized members in group views, including leaderboards. Status visibility shares the permitted
        goal/status projection rather than the private raw value. Review a
        tracker&apos;s visibility before posting or importing sensitive
        information.
      </LegalSection>

      <LegalSection title="Processors, storage, and security">
        Supabase processes authentication, database and file storage, server
        functions, and account sync. Expo processes web hosting and, where used,
        app builds, updates, and push delivery. Apple Push Notification service,
        Firebase Cloud Messaging, browser push services, sign-in providers,
        connected-health providers, food databases, and any configured AI
        provider process only the information needed for the feature you choose.
        HabHub uses HTTPS in transit, encrypts stored Google authorization
        credentials, and applies per-account database access controls. Security
        and processor agreements still require launch review.
      </LegalSection>

      <LegalSection title="Device and browser caches">
        HabHub keeps local state and caches needed for offline use. Raw Google
        Health imports, identifiable Google-derived daily or group projections,
        provider-linked entry identifiers, and Google entry time or date choices
        are excluded from HabHub&apos;s plaintext device and browser activity
        caches, cloud merge-base cache, Android widget snapshot, and locally scheduled goal-notification projections. They remain available from the
        protected cloud account while signed in and in memory while the app is
        open. Consequently, a cold offline launch cannot display Google Health imports until HabHub reconnects. Editing an imported food time or date,
        or hiding a Google Health entry, requires an online, authenticated server confirmation; HabHub reports the change as saved only after that
        confirmation.
      </LegalSection>

      <LegalSection title="Retention and your controls">
        Account data remains until you delete individual content, disconnect or
        delete an eligible import, or delete the account, subject to the final
        published retention schedule. Disconnect Google Health stops future access, removes the active HabHub credential and sync state, and keeps
        entries already imported. Delete imported data stops access and removes
        entries and import records owned by that Google Health connection;
        manual entries and Apple Health or Health Connect imports made by the
        HabHub phone app remain. Delete account in Settings removes active Google
        access first, then explicitly removes uploaded media, sent messages,
        tracker entries, progress posts, social comments and reactions, group
        to-dos and challenges, templates, and the account&apos;s remaining cloud
        data. Social interactions attached to deleted content are also removed.
        The deleted account is removed from surviving challenge rosters, and
        other members&apos; private sync snapshots are scrubbed and revision-invalidated
        so an older offline copy cannot restore the deleted member identity.
        A report filed by the deleting account is normally removed after its
        service-operator review finishes. If review is still queued, HabHub
        removes the reporter account identifier but retains the report reason,
        details, relevant content evidence, moderation status, and timestamps
        in the service-operator review queue until the published safety-retention
        period ends. This limited exception prevents account deletion from
        erasing unresolved abuse evidence. A report filed by someone else can
        also retain its reason, details, moderation status, and timestamps for
        safety handling, but the deleted subject&apos;s identifier, display-name
        snapshot, message identifier, and copied message text are removed.
        Existing groups can transfer to another active member. If full
        deletion cannot finish, HabHub reports failure so the remaining work can be retried; completed deletion steps are not rolled back. If Google&apos;s
        remote revocation endpoint is temporarily unavailable, an
        account-detached encrypted revocation job is queued and retried.
        Processor backups age out under their configured retention and recovery
        schedules, which must be documented precisely before launch.
      </LegalSection>

      <LegalSection title="Uses HabHub prohibits">
        HabHub does not sell health data, use it for targeted advertising, share
        it with data brokers, use it to determine credit, insurance, employment,
        lending, or housing eligibility, or use it for research. HabHub does not
        combine Google Health data with unrelated advertising profiles.
      </LegalSection>

      <LegalSection title="Google Health Limited Use">
        The use of information received from Google Health API and/or Developer
        Tools will adhere to the Google Health API Developer and User Data
        Policy, including the Limited Use requirements.
      </LegalSection>
      <ExternalLink
        label="Google Health API Developer and User Data Policy"
        url={GOOGLE_HEALTH_POLICY_URL}
      />
      <ExternalLink
        label="Google Health Limited Use requirements"
        url={GOOGLE_HEALTH_LIMITED_USE_URL}
      />

      <LegalSection title="Contact and deletion help">
        For privacy questions, access/export requests, or help disconnecting a
        health source, deleting imported data, or deleting your HabHub account,
        contact {HABHUB_SUPPORT_EMAIL}. Signed-in users can initiate account
        deletion directly in Settings; the public deletion page provides an
        option when the installed app is unavailable.
      </LegalSection>
      <ExternalLink label="Contact HabHub support" url={supportUrl} icon="mail-outline" />
      <ExternalLink
        label="Email privacy support"
        url={supportMailto("HabHub privacy request")}
        icon="mail-outline"
      />
      <LegalRouteLink label="Terms of Use" route="/terms" />
      <LegalRouteLink label="Support" route="/support" />
      <LegalRouteLink label="Account deletion" route="/delete-account" />
    </LegalDocumentScreen>
  );
}
