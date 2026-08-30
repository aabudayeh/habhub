import type { ChatShareAttachment } from "@/src/domain/social";

type StagedImage = {
  uri: string;
  expiresAt: number;
};

const stagedImages = new Map<string, StagedImage>();
const STAGING_TTL_MS = 10 * 60 * 1000;
const MAX_STAGED_IMAGES = 24;

function attachmentIdentity(attachment: ChatShareAttachment) {
  if (attachment.kind === "metric_log")
    return [
      attachment.kind,
      attachment.memberId ?? "",
      attachment.metricId,
      attachment.localDate,
      attachment.entryId,
    ].join("\u0000");
  if (attachment.kind === "challenge")
    return [
      attachment.kind,
      attachment.groupId ?? "",
      attachment.challengeId,
      attachment.occurrenceDate ?? "",
    ].join("\u0000");
  return [
    attachment.kind,
    attachment.scope,
    attachment.anchor ?? "",
    attachment.highlight ?? "",
  ].join("\u0000");
}

function key(
  accountId: string,
  groupId: string,
  attachment: ChatShareAttachment,
) {
  return `${accountId}\u0000${groupId}\u0000${attachmentIdentity(attachment)}`;
}

function prune(now: number) {
  for (const [itemKey, item] of stagedImages) {
    if (item.expiresAt <= now) stagedImages.delete(itemKey);
  }
  while (stagedImages.size >= MAX_STAGED_IMAGES) {
    const oldest = stagedImages.keys().next().value as string | undefined;
    if (!oldest) break;
    stagedImages.delete(oldest);
  }
}

/**
 * Keeps an already-authorized image inside the current app process while a
 * share moves to Chat. Only the stable attachment identity enters navigation
 * or the habhub:// transport; signed/private media URLs never do.
 */
export function stageChatShareImage(
  accountId: string,
  groupId: string,
  attachment: ChatShareAttachment,
  uri: string | undefined,
) {
  const value = uri?.trim();
  if (!accountId || !groupId || !value) return;
  const now = Date.now();
  prune(now);
  const itemKey = key(accountId, groupId, attachment);
  stagedImages.delete(itemKey);
  stagedImages.set(itemKey, {
    uri: value,
    expiresAt: now + STAGING_TTL_MS,
  });
}

export function stagedChatShareImage(
  accountId: string,
  groupId: string,
  attachment: ChatShareAttachment,
) {
  const now = Date.now();
  prune(now);
  return stagedImages.get(key(accountId, groupId, attachment))?.uri;
}
