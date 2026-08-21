import { AppLanguage, BanterTone } from '@/src/types';
import { translateDomainText } from '@/src/i18n/domain';

export type MessageCategory = 'cheer' | 'taunt' | 'reminder';

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
