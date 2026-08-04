type AccountIdentity = {
  id?: string;
  user_metadata?: Record<string, unknown>;
};

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

/** Prefer the identity-provider name; otherwise create a stable friendly alias. */
export function suggestedAccountName(identity?: AccountIdentity | null) {
  const metadata = identity?.user_metadata;
  const providerName =
    metadata?.display_name ??
    metadata?.full_name ??
    metadata?.name ??
    metadata?.given_name;
  if (typeof providerName === "string" && providerName.trim())
    return providerName.trim().replace(/\s+/g, " ").slice(0, 40);
  const seed = hash(identity?.id ?? `${Date.now()}-${Math.random()}`);
  return `${ADJECTIVES[seed % ADJECTIVES.length]} ${
    ANIMALS[Math.floor(seed / ADJECTIVES.length) % ANIMALS.length]
  }`;
}
