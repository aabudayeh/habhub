import { base64UrlDecode, base64UrlEncode } from "./google-health-crypto.ts";
import { fetchWithTimeout } from "./google-health-http.ts";

const KEYSET_URL = "https://www.gstatic.com/googlehealthapi/webhooks/webhooks_public_keyset.json";
const CACHE_MS = 6 * 60 * 60_000;

type TinkKey = {
  keyId?: number;
  status?: string;
  outputPrefixType?: string;
  keyData?: { typeUrl?: string; value?: string };
};

let cache: { expiresAt: number; keys: TinkKey[] } | undefined;

function ownedBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function readVarint(bytes: Uint8Array, cursor: { value: number }) {
  let value = 0;
  let shift = 0;
  while (cursor.value < bytes.length && shift <= 49) {
    const byte = bytes[cursor.value++];
    value += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) return value;
    shift += 7;
  }
  throw new Error("Invalid protobuf varint");
}

function parseEcdsaCoordinates(bytes: Uint8Array) {
  const cursor = { value: 0 };
  let x: Uint8Array | undefined;
  let y: Uint8Array | undefined;
  while (cursor.value < bytes.length) {
    const tag = readVarint(bytes, cursor);
    const field = tag >>> 3;
    const wire = tag & 7;
    if (wire === 0) {
      readVarint(bytes, cursor);
      continue;
    }
    if (wire !== 2) throw new Error("Unsupported public-key protobuf field");
    const length = readVarint(bytes, cursor);
    if (length < 0 || cursor.value + length > bytes.length)
      throw new Error("Invalid public-key protobuf length");
    const value = bytes.slice(cursor.value, cursor.value + length);
    cursor.value += length;
    if (field === 3) x = value;
    if (field === 4) y = value;
  }
  if (!x || !y) throw new Error("Google Health public key is incomplete");
  const coordinate = (value: Uint8Array) => {
    let normalized = value;
    while (normalized.length > 32 && normalized[0] === 0) normalized = normalized.slice(1);
    if (normalized.length > 32) throw new Error("Invalid P-256 coordinate");
    const padded = new Uint8Array(32);
    padded.set(normalized, 32 - normalized.length);
    return padded;
  };
  return { x: coordinate(x), y: coordinate(y) };
}

function derToRaw(signature: Uint8Array) {
  let cursor = 0;
  const readLength = () => {
    const first = signature[cursor++];
    if (first < 0x80) return first;
    const bytes = first & 0x7f;
    if (bytes < 1 || bytes > 2 || cursor + bytes > signature.length)
      throw new Error("Invalid DER signature length");
    let length = 0;
    for (let index = 0; index < bytes; index += 1) length = length * 256 + signature[cursor++];
    return length;
  };
  if (signature[cursor++] !== 0x30) throw new Error("Invalid DER signature");
  const sequenceLength = readLength();
  if (cursor + sequenceLength !== signature.length) throw new Error("Invalid DER sequence");
  const integer = () => {
    if (signature[cursor++] !== 0x02) throw new Error("Invalid DER integer");
    const length = readLength();
    let value = signature.slice(cursor, cursor + length);
    cursor += length;
    while (value.length > 32 && value[0] === 0) value = value.slice(1);
    if (!value.length || value.length > 32) throw new Error("Invalid ECDSA integer");
    const output = new Uint8Array(32);
    output.set(value, 32 - value.length);
    return output;
  };
  const r = integer();
  const s = integer();
  if (cursor !== signature.length) throw new Error("Trailing DER signature data");
  const raw = new Uint8Array(64);
  raw.set(r, 0);
  raw.set(s, 32);
  return raw;
}

async function publicKeys(forceRefresh = false) {
  if (!forceRefresh && cache && cache.expiresAt > Date.now()) return cache.keys;
  const response = await fetchWithTimeout(KEYSET_URL, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error("Google Health webhook keyset unavailable");
  const payload = await response.json() as { key?: TinkKey[] };
  const keys = Array.isArray(payload.key) ? payload.key : [];
  if (!keys.length) throw new Error("Google Health webhook keyset is empty");
  cache = { expiresAt: Date.now() + CACHE_MS, keys };
  return keys;
}

export async function verifyGoogleHealthWebhookSignature(
  body: Uint8Array,
  encodedSignature: string,
) {
  let signature: Uint8Array;
  try {
    signature = base64UrlDecode(encodedSignature.trim());
  } catch {
    return false;
  }
  if (signature.length < 14 || signature[0] !== 0x01) return false;
  const keyId = new DataView(signature.buffer, signature.byteOffset + 1, 4).getUint32(0, false);
  const findKey = (keys: TinkKey[]) => keys.find((candidate) =>
    Number(candidate.keyId) === keyId &&
    candidate.status === "ENABLED" &&
    candidate.outputPrefixType === "TINK" &&
    candidate.keyData?.typeUrl?.endsWith("google.crypto.tink.EcdsaPublicKey") &&
    candidate.keyData.value);
  let key = findKey(await publicKeys());
  // Key IDs rotate. Refetch once immediately instead of rejecting every
  // delivery until the ordinary six-hour cache expires.
  if (!key) key = findKey(await publicKeys(true));
  if (!key?.keyData?.value) return false;
  const coordinates = parseEcdsaCoordinates(base64UrlDecode(key.keyData.value));
  const publicKey = await crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      x: base64UrlEncode(coordinates.x),
      y: base64UrlEncode(coordinates.y),
      ext: true,
      key_ops: ["verify"],
    },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  const der = signature.slice(5);
  let raw: Uint8Array;
  try {
    raw = derToRaw(der);
  } catch {
    return false;
  }
  if (await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    publicKey,
    ownedBuffer(raw),
    ownedBuffer(body),
  ))
    return true;
  // Some WebCrypto-compatible runtimes accept ASN.1 DER rather than the
  // specification's IEEE-P1363 representation. Keep that safe compatibility
  // path without weakening key, curve, or digest validation.
  try {
    return await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      publicKey,
      ownedBuffer(der),
      ownedBuffer(body),
    );
  } catch {
    return false;
  }
}
