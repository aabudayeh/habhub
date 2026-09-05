export type ChatContentDecision =
  | { allowed: true }
  | {
      allowed: false;
      code: "targeted-threat" | "sexual-exploitation" | "severe-slur";
      message: string;
    };

function normalizedChatText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("en")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

const TARGETED_THREATS = [
  /(^| )(?:kys|kill yourself|go kill yourself)( |$)/u,
  /(^| )(?:i will kill you|i ll kill you|i am going to kill you|rape you)( |$)/u,
  /bring dich um/u,
  /(^| )matate( |$)/u,
  /tue toi/u,
  /убеи себя/u,
  /ta livet av dig/u,
  /去死/u,
  /اقتل نفسك/u,
];

const SEXUAL_EXPLOITATION = [
  /(^| )(?:child porn|underage nudes)( |$)/u,
];

const SEVERE_SLURS = [/(^| )(?:nigger|niggers|faggot|faggots)( |$)/u];

/**
 * A deliberately high-confidence preflight for private, invited group chat.
 * It blocks a small set of unequivocal abuse while report and block controls
 * handle context, images, obfuscation, and multilingual edge cases.
 */
export function moderateChatContent(value: string): ChatContentDecision {
  const normalized = normalizedChatText(value);
  if (!normalized) return { allowed: true };
  if (SEXUAL_EXPLOITATION.some((pattern) => pattern.test(normalized)))
    return {
      allowed: false,
      code: "sexual-exploitation",
      message: "This message contains sexual content involving a minor and cannot be sent.",
    };
  if (TARGETED_THREATS.some((pattern) => pattern.test(normalized)))
    return {
      allowed: false,
      code: "targeted-threat",
      message: "This message contains a severe threat or self-harm abuse and cannot be sent.",
    };
  if (SEVERE_SLURS.some((pattern) => pattern.test(normalized)))
    return {
      allowed: false,
      code: "severe-slur",
      message: "This message contains a severe slur and cannot be sent.",
    };
  return { allowed: true };
}
