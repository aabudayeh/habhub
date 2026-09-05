import {
  ExternalLegalLink,
  LegalDocumentScreen,
  LegalRouteLink,
  LegalSection,
  supportMailto,
} from "@/src/components/LegalDocument";
import { CURRENT_TERMS_VERSION, policyVersionLabel } from "@/src/legal/policy";

export default function CommunityGuidelinesScreen() {
  return (
    <LegalDocumentScreen
      title="Community Guidelines"
      subtitle="The shared rules that keep HabHub supportive, private, and safe."
      badge="Progress without pressure or abuse"
      badgeIcon="people-circle-outline"
      updated={policyVersionLabel(CURRENT_TERMS_VERSION)}
      reviewRequired
    >
      <LegalSection title="Build people up">
        Encourage honest progress without harassment, threats, bullying,
        unwanted sexual content, hate, discrimination, humiliation, or pressure
        to reveal health information. Do not target someone because of their
        body, ability, identity, health, or performance.
      </LegalSection>

      <LegalSection title="Share only what belongs to you">
        Post only content you have permission to share. Do not impersonate
        another person, publish private or identifying information, expose
        another member&apos;s health data, or upload infringing material. Keep
        progress photos appropriate for a mixed community.
      </LegalSection>

      <LegalSection title="Keep challenges fair">
        Do not falsify results, manipulate leaderboards, coordinate abuse, spam
        groups, evade blocks, or use automation to gain an unfair advantage.
        Health and fitness achievements are personal; never pressure another
        member into unsafe behavior.
      </LegalSection>

      <LegalSection title="Report and block">
        Report a message, shared update, comment, or member from its in-app
        safety control.
        Choose the closest reason and add only the detail needed for review.
        Every cloud report is stored in a protected HabHub operator queue. An
        eligible group moderator may also act, but the reported account cannot
        see or decide its own report and a moderator cannot decide a report they
        filed, including when either conflict leaves no safe group reviewer.
        Blocking immediately hides that member&apos;s cached and future chat and
        Feed content for you and suppresses direct contact in both directions.
        For an appeal or extra context, contact HabHub support.
      </LegalSection>

      <LegalSection title="How enforcement works">
        Depending on context and severity, HabHub may remove content, restrict a
        feature, suspend or terminate an account, preserve a limited safety
        record, or refer credible imminent danger or unlawful conduct to the
        appropriate authority where legally required. Group moderators can act
        on eligible reports in their group queue; those decisions do not erase
        the independent operator record. Public community operation still
        requires the monitored safety owner and response process described in
        the release checklist.
      </LegalSection>

      <LegalSection title="Urgent situations">
        HabHub is not an emergency or medical service. If someone may be in
        immediate danger, contact local emergency services. Do not rely on an
        in-app report for urgent help.
      </LegalSection>

      <ExternalLegalLink
        label="Email a safety escalation"
        url={supportMailto("HabHub safety escalation")}
        icon="mail-outline"
      />
      <LegalRouteLink label="Terms of Use" route="/terms" />
      <LegalRouteLink label="Privacy & Health Data Policy" route="/privacy" />
      <LegalRouteLink label="Support" route="/support" />
    </LegalDocumentScreen>
  );
}
