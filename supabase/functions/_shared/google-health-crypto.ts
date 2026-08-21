export type EncryptedSecret = {
  ciphertext: string;
  iv: string;
  keyVersion: number;
};

export type SecretBinding = {
  purpose: "oauth-state" | "refresh-token";
  userId: string;
  context?: string;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function ownedBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function base64UrlEncode(bytes: Uint8Array) {
  return bytesToBase64(bytes)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function base64UrlDecode(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  return base64ToBytes(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
}

export function randomBase64Url(byteLength = 32) {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(byteLength)));
}

export async function sha256Bytes(value: string | Uint8Array) {
  const bytes = typeof value === "string" ? encoder.encode(value) : value;
  return new Uint8Array(await crypto.subtle.digest("SHA-256", ownedBuffer(bytes)));
}

export async function sha256Hex(value: string | Uint8Array) {
  return [...await sha256Bytes(value)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function configuredKeyMaterial() {
  const currentVersion = Number(Deno.env.get("GOOGLE_HEALTH_TOKEN_ENCRYPTION_KEY_VERSION")?.trim() || "1");
  if (!Number.isInteger(currentVersion) || currentVersion < 1 || currentVersion > 32_767)
    throw new Error("GOOGLE_HEALTH_TOKEN_ENCRYPTION_KEY_VERSION must be a positive integer");
  const keyring = new Map<number, string>();
  const legacy = Deno.env.get("GOOGLE_HEALTH_TOKEN_ENCRYPTION_KEY")?.trim();
  if (legacy) keyring.set(currentVersion, legacy);
  const rawKeyring = Deno.env.get("GOOGLE_HEALTH_TOKEN_ENCRYPTION_KEYS")?.trim();
  if (rawKeyring) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawKeyring);
    } catch {
      throw new Error("GOOGLE_HEALTH_TOKEN_ENCRYPTION_KEYS must be a JSON object");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("GOOGLE_HEALTH_TOKEN_ENCRYPTION_KEYS must be a JSON object");
    for (const [versionText, value] of Object.entries(parsed as Record<string, unknown>)) {
      const version = Number(versionText);
      if (!Number.isInteger(version) || version < 1 || typeof value !== "string")
        throw new Error("GOOGLE_HEALTH_TOKEN_ENCRYPTION_KEYS contains an invalid version");
      keyring.set(version, value.trim());
    }
  }
  if (!keyring.has(currentVersion))
    throw new Error("No Google Health encryption key exists for the current version");
  return { currentVersion, keyring };
}

async function encryptionKey(version: number) {
  const { keyring } = configuredKeyMaterial();
  const configured = keyring.get(version);
  if (!configured)
    throw new Error(`Google Health encryption key version ${version} is unavailable`);
  let raw: Uint8Array;
  try {
    raw = base64ToBytes(configured);
  } catch {
    throw new Error("GOOGLE_HEALTH_TOKEN_ENCRYPTION_KEY must be base64");
  }
  if (raw.length !== 32)
    throw new Error("GOOGLE_HEALTH_TOKEN_ENCRYPTION_KEY must decode to 32 bytes");
  return crypto.subtle.importKey("raw", ownedBuffer(raw), "AES-GCM", false, ["encrypt", "decrypt"]);
}

function additionalData(binding: SecretBinding) {
  if (!binding.userId || /[\r\n|]/.test(binding.userId + (binding.context ?? "")))
    throw new Error("Invalid Google Health secret binding");
  return encoder.encode(
    `google-health|1|${binding.purpose}|${binding.userId}|${binding.context ?? ""}`,
  );
}

export async function encryptSecret(
  value: string,
  binding: SecretBinding,
): Promise<EncryptedSecret> {
  const { currentVersion } = configuredKeyMaterial();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: ownedBuffer(iv),
      additionalData: ownedBuffer(additionalData(binding)),
    },
    await encryptionKey(currentVersion),
    ownedBuffer(encoder.encode(value)),
  );
  return {
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    iv: bytesToBase64(iv),
    keyVersion: currentVersion,
  };
}

export async function decryptSecret(secret: EncryptedSecret, binding: SecretBinding) {
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: ownedBuffer(base64ToBytes(secret.iv)),
      additionalData: ownedBuffer(additionalData(binding)),
    },
    await encryptionKey(secret.keyVersion),
    ownedBuffer(base64ToBytes(secret.ciphertext)),
  );
  return decoder.decode(plaintext);
}

export async function constantTimeEqual(left: string, right: string) {
  const [a, b] = await Promise.all([sha256Bytes(left), sha256Bytes(right)]);
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1)
    difference |= a[index] ^ b[index];
  return difference === 0;
}
