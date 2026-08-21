export type CachedAuthUser = {
  id: string;
  aud: string;
  role?: string;
  email?: string;
  phone?: string;
  app_metadata: Record<string, unknown>;
  user_metadata: Record<string, unknown>;
  created_at: string;
  updated_at?: string;
  confirmed_at?: string;
  last_sign_in_at?: string;
  identities?: unknown[];
  is_anonymous?: boolean;
};

type CachedAuthEnvelope = {
  version: 1;
  savedAt: string;
  user: CachedAuthUser;
};

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeCachedUser(value: unknown) {
  const source = record(value);
  const id = typeof source.id === "string" ? source.id : "";
  const createdAt =
    typeof source.created_at === "string" ? source.created_at : "";
  if (!UUID.test(id) || !Number.isFinite(new Date(createdAt).getTime()))
    return null;
  const optionalString = (key: string) =>
    typeof source[key] === "string" ? (source[key] as string) : undefined;
  return {
    id,
    aud: optionalString("aud") || "authenticated",
    role: optionalString("role"),
    email: optionalString("email"),
    phone: optionalString("phone"),
    app_metadata: record(source.app_metadata),
    user_metadata: record(source.user_metadata),
    created_at: createdAt,
    updated_at: optionalString("updated_at"),
    confirmed_at: optionalString("confirmed_at"),
    last_sign_in_at: optionalString("last_sign_in_at"),
    identities: Array.isArray(source.identities) ? source.identities : undefined,
    is_anonymous:
      typeof source.is_anonymous === "boolean"
        ? source.is_anonymous
        : undefined,
  } satisfies CachedAuthUser;
}

/**
 * Persist only the non-secret Supabase user identity. Access and refresh
 * tokens remain exclusively in Supabase's protected session storage.
 */
export function cachedAuthIdentityPayload(user: CachedAuthUser) {
  const envelope: CachedAuthEnvelope = {
    version: 1,
    savedAt: new Date().toISOString(),
    user: {
      id: user.id,
      aud: user.aud || "authenticated",
      role: user.role,
      email: user.email,
      phone: user.phone,
      app_metadata: record(user.app_metadata),
      user_metadata: record(user.user_metadata),
      created_at: user.created_at,
      updated_at: user.updated_at,
      confirmed_at: user.confirmed_at,
      last_sign_in_at: user.last_sign_in_at,
      identities: Array.isArray(user.identities) ? user.identities : undefined,
      is_anonymous: user.is_anonymous,
    },
  };
  return JSON.stringify(envelope);
}

/** Returns a display/cache identity only; it never authorizes network work. */
export function parseCachedAuthIdentity(raw: string | null | undefined) {
  if (!raw) return null;
  try {
    const envelope = JSON.parse(raw) as Partial<CachedAuthEnvelope>;
    return envelope.version === 1 ? normalizeCachedUser(envelope.user) : null;
  } catch {
    return null;
  }
}

/**
 * First-upgrade fallback: extract only the user from Supabase's own persisted
 * session envelope. The access and refresh tokens are never returned or copied.
 */
export function parseSupabaseStoredAuthUser(raw: string | null | undefined) {
  if (!raw) return null;
  try {
    const stored = record(JSON.parse(raw));
    const direct = normalizeCachedUser(stored.user);
    if (direct) return direct;
    return normalizeCachedUser(record(stored.currentSession).user);
  } catch {
    return null;
  }
}

export function supabaseAuthStorageKey(projectUrl: string | undefined) {
  if (!projectUrl) return null;
  try {
    const projectRef = new URL(projectUrl).hostname.split(".")[0]?.trim();
    return projectRef ? `sb-${projectRef}-auth-token` : null;
  } catch {
    return null;
  }
}
