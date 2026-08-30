import { AppLanguage, BanterTone } from '@/src/types';
import { translateDomainText } from '@/src/i18n/domain';

export type MessageCategory = 'cheer' | 'taunt' | 'reminder';

export type RecapShareAttachment = {
  kind: 'recap';
  scope: 'group' | 'personal';
  highlight?: string;
  anchor?: string;
  title?: string;
};

export type ChallengeShareAttachment = {
  kind: 'challenge';
  challengeId: string;
  title?: string;
  occurrenceDate?: string;
  groupId?: string;
  audience?: 'group' | 'public';
};

export type MetricLogShareAttachment = {
  kind: 'metric_log';
  entryId: string;
  metricId: string;
  localDate: string;
  memberId?: string;
  title?: string;
};

export type ChatShareAttachment =
  | RecapShareAttachment
  | ChallengeShareAttachment
  | MetricLogShareAttachment;

const recapSharePattern = /habhub:\/\/recap\?([^\s]+)/i;
const challengeSharePattern = /habhub:\/\/challenge\?([^\s]+)/i;
const metricLogSharePattern = /habhub:\/\/metric-log\?([^\s]+)/i;
const chatShareTransportPattern =
  /habhub:\/\/(?:recap|challenge|metric-log)\?[^\s]*/gi;

function isCalendarDate(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day;
}

/**
 * Recap shares remain compatible with existing persisted chat rows by using a
 * compact deep link inside the message content. Consumers must use this parser
 * so the transport link is never rendered as message or notification copy.
 */
export function parseRecapShareMessage(text: string) {
  const match = recapSharePattern.exec(text);
  if (!match) return undefined;
  const query = new URLSearchParams(match[1]);
  const scope = query.get('scope') === 'personal' ? 'personal' : 'group';
  const visibleText = `${text.slice(0, match.index)}${text.slice(match.index + match[0].length)}`.trim();
  return {
    attachment: {
      kind: 'recap',
      scope,
      highlight: query.get('highlight') ?? undefined,
      anchor: query.get('anchor') ?? undefined,
      title: query.get('title') ?? undefined,
    } satisfies RecapShareAttachment,
    text: visibleText,
  };
}

export function parseChallengeShareMessage(text: string) {
  const match = challengeSharePattern.exec(text);
  if (!match) return undefined;
  const query = new URLSearchParams(match[1]);
  const challengeId = query.get('challengeId')?.trim();
  if (!challengeId) return undefined;
  const visibleText = `${text.slice(0, match.index)}${text.slice(match.index + match[0].length)}`.trim();
  return {
    attachment: {
      kind: 'challenge',
      challengeId,
      title: query.get('title') ?? undefined,
      occurrenceDate: query.get('occurrenceDate') ?? undefined,
      groupId: query.get('groupId') ?? undefined,
      audience: query.get('audience') === 'public' ? 'public' : 'group',
    } satisfies ChallengeShareAttachment,
    text: visibleText,
  };
}

export function parseMetricLogShareMessage(text: string) {
  const match = metricLogSharePattern.exec(text);
  if (!match) return undefined;
  const query = new URLSearchParams(match[1]);
  const entryId = query.get('entryId')?.trim();
  const metricId = query.get('metricId')?.trim();
  const localDate = query.get('localDate')?.trim();
  const memberId = query.get('memberId')?.trim() || undefined;
  const title = query.get('title')?.trim() || undefined;
  if (
    !entryId ||
    entryId.length > 400 ||
    !metricId ||
    metricId.length > 200 ||
    !isCalendarDate(localDate) ||
    (memberId?.length ?? 0) > 200 ||
    (title?.length ?? 0) > 160
  )
    return undefined;
  const visibleText = `${text.slice(0, match.index)}${text.slice(match.index + match[0].length)}`.trim();
  return {
    attachment: {
      kind: 'metric_log',
      entryId,
      metricId,
      localDate: localDate!,
      memberId,
      title,
    } satisfies MetricLogShareAttachment,
    text: visibleText,
  };
}

export function parseChatShareMessage(text: string) {
  return parseRecapShareMessage(text) ??
    parseChallengeShareMessage(text) ??
    parseMetricLogShareMessage(text);
}

/**
 * Returns notification-safe chat copy while keeping the parsed attachment for
 * navigation. The defensive transport-link removal is deliberately separate
 * from attachment validation: an older or malformed deep link must never leak
 * into alert cards or push notification previews.
 */
export function chatSharePreview(text: string) {
  const shared = parseChatShareMessage(text);
  const transportLinks = text.match(chatShareTransportPattern) ?? [];
  return {
    attachment: shared?.attachment,
    text: (shared?.text ?? text.replace(chatShareTransportPattern, '')).trim(),
    hasAttachment: Boolean(shared || transportLinks.length),
  };
}

export function buildRecapShareMessage(
  attachment: RecapShareAttachment,
  userText = '',
) {
  const query = new URLSearchParams({ scope: attachment.scope });
  if (attachment.highlight) query.set('highlight', attachment.highlight);
  if (attachment.anchor) query.set('anchor', attachment.anchor);
  if (attachment.title) query.set('title', attachment.title.slice(0, 160));
  const link = `habhub://recap?${query.toString()}`;
  const copy = userText.trim();
  return copy ? `${copy}\n${link}` : link;
}

export function buildChallengeShareMessage(
  attachment: ChallengeShareAttachment,
  userText = '',
) {
  const query = new URLSearchParams({ challengeId: attachment.challengeId });
  if (attachment.title) query.set('title', attachment.title.slice(0, 160));
  if (attachment.occurrenceDate)
    query.set('occurrenceDate', attachment.occurrenceDate);
  if (attachment.groupId) query.set('groupId', attachment.groupId);
  if (attachment.audience) query.set('audience', attachment.audience);
  const link = `habhub://challenge?${query.toString()}`;
  const copy = userText.trim();
  return copy ? `${copy}\n${link}` : link;
}

export function buildMetricLogShareMessage(
  attachment: MetricLogShareAttachment,
  userText = '',
) {
  const query = new URLSearchParams({
    entryId: attachment.entryId,
    metricId: attachment.metricId,
    localDate: attachment.localDate,
  });
  if (attachment.memberId) query.set('memberId', attachment.memberId);
  if (attachment.title) query.set('title', attachment.title.slice(0, 160));
  const link = `habhub://metric-log?${query.toString()}`;
  const copy = userText.trim();
  return copy ? `${copy}\n${link}` : link;
}

export function buildChatShareMessage(
  attachment: ChatShareAttachment,
  userText = '',
) {
  if (attachment.kind === 'recap')
    return buildRecapShareMessage(attachment, userText);
  if (attachment.kind === 'challenge')
    return buildChallengeShareMessage(attachment, userText);
  return buildMetricLogShareMessage(attachment, userText);
}

const parts: Record<MessageCategory, { openings: string[]; bodies: string[]; endings: string[] }> = {
  cheer: {
    openings: ['Nice work!', 'That is momentum.', 'Big win!', 'You showed up.', 'Strong move!', 'Look at you go!'],
    bodies: [
      'One more step toward the goal',
      'Consistency is doing its thing',
      'The group noticed that effort',
      'Today just got better',
      'That goal is getting nervous',
      'Keep stacking the small wins',
    ],
    endings: ['Keep going 💚', 'We are cheering for you.', 'Onward!', 'That counts.', 'Proud of you!'],
  },
  taunt: {
    openings: ['Friendly warning:', 'Leaderboard update:', 'No pressure, but', 'Just checking:', 'Breaking news:', 'Tiny challenge:'],
    bodies: [
      'your spot is not reserved',
      'the group is moving while you read this',
      'someone is eyeing your rank',
      'your step counter looks a little too relaxed',
      'the comeback window is officially open',
      'the podium would like a word',
    ],
    endings: ['Your move 😄', 'Time to answer.', 'Show us what you have.', 'Catch us if you can.', 'Game on.'],
  },
  reminder: {
    openings: ['Quick check-in:', 'Gentle nudge:', 'When you have a moment:', 'Today is still open:', 'Small reminder:', 'Before the day gets away:'],
    bodies: [
      'add the numbers you want to remember',
      'your daily log is waiting',
      'a ten-second update keeps the trend useful',
      'record the win while it is fresh',
      'check your goals and log what matters',
      'your future chart will thank you',
    ],
    endings: ['No rush.', 'You have got this.', 'One tap is enough.', 'Keep it simple.', 'Done is better than perfect.'],
  },
};

export function messageLibrary(
  category: MessageCategory,
  tone: BanterTone,
  language: AppLanguage = 'en',
): string[] {
  const source = parts[category];
  const messages: string[] = [];
  for (const opening of source.openings) {
    for (const body of source.bodies) {
      for (const ending of source.endings) messages.push(`${opening} ${body}. ${ending}`);
    }
  }
  let toned = messages;
  if (tone === 'supportive' && category === 'taunt') {
    toned = messages.map((message) => message.replace('Catch us if you can.', 'We know you can catch up.').replace('Game on.', 'We believe in you.'));
  }
  if (tone === 'supportive' && category === 'cheer') toned = messages.map((message) => `${message} Be proud of the effort.`);
  if (tone === 'supportive' && category === 'reminder') toned = messages.map((message) => `${message} No guilt if today is busy.`);
  if (tone === 'ruthless' && category === 'taunt') {
    toned = messages.map((message) => `${message} The excuses leaderboard is already full.`);
  }
  if (tone === 'ruthless' && category === 'cheer') toned = messages.map((message) => `${message} Now defend that rank.`);
  if (tone === 'ruthless' && category === 'reminder') toned = messages.map((message) => `${message} The clock and leaderboard are both moving.`);
  return language === 'en'
    ? toned
    : toned.map((message) => translateDomainText(language, message));
}

export function randomMessage(
  category: MessageCategory,
  tone: BanterTone,
  custom?: string,
  language: AppLanguage = 'en',
): string {
  const library = messageLibrary(category, tone, language);
  const candidates = custom?.trim() ? [custom.trim(), ...library] : library;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

export function directConversationId(firstUserId: string, secondUserId: string): string {
  return `dm:${[firstUserId, secondUserId].sort().join(':')}`;
}
