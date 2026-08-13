type AccountIdentity = {
  id?: string;
  user_metadata?: Record<string, unknown>;
};

/** Keep the compact, conversational name used during first-run setup. */
export function firstDisplayName(value: string, maxLength = 40) {
  return (
    value.trim().replace(/\s+/g, " ").split(" ")[0]?.slice(0, maxLength) ?? ""
  );
}

const ADJECTIVES = [
  "Brave",
  "Bright",
  "Cheery",
  "Clever",
  "Cozy",
  "Happy",
  "Mighty",
  "Sunny",
  "Swift",
  "Witty",
];

const ANIMALS = [
  "Badger",
  "Bear",
  "Fox",
  "Koala",
  "Otter",
  "Panda",
  "Penguin",
  "Raccoon",
  "Tiger",
  "Turtle",
];

function hash(value: string) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

/** Return the real provider name when one exists, normalized for first-run UI. */
export function providerFirstDisplayName(identity?: AccountIdentity | null) {
  const metadata = identity?.user_metadata;
  const providerName =
    metadata?.display_name ??
    metadata?.full_name ??
    metadata?.name ??
    metadata?.given_name;
  if (typeof providerName !== "string" || !providerName.trim()) return undefined;
  const normalized = providerName.trim().replace(/\s+/g, " ").slice(0, 40);
  // Onboarding stores the fallback alias as account metadata. It still is not a
  // person's full name, so recognize the deterministic value on later logins.
  if (
    identity?.id &&
    normalized === friendlyAccountAlias({ id: identity.id })
  )
    return undefined;
  return firstDisplayName(normalized);
}

/** Stable two-word alias for an account whose provider has no real name. */
export function friendlyAccountAlias(identity?: AccountIdentity | null) {
  const seed = hash(identity?.id ?? `${Date.now()}-${Math.random()}`);
  return `${ADJECTIVES[seed % ADJECTIVES.length]} ${
    ANIMALS[Math.floor(seed / ADJECTIVES.length) % ANIMALS.length]
  }`;
}

/** Prefer the identity-provider first name; otherwise create a friendly alias. */
export function suggestedAccountName(identity?: AccountIdentity | null) {
  return providerFirstDisplayName(identity) ?? friendlyAccountAlias(identity);
}
