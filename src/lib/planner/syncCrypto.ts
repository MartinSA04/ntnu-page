/**
 * Key derivation and envelope encryption for the opt-in account.
 *
 * Two keys come out of one PBKDF2: `authKey` is sent to the worker as the
 * write credential (which stores only its SHA-256), and `encKeyRaw` never
 * leaves the browser. So the server can prove who is writing and cannot read
 * what is written.
 *
 * The PBKDF2 salt is DERIVED FROM THE NAME, not random. A random salt would
 * have to be fetched before the student could log in — a round-trip that
 * reveals whether a name exists, plus a recovery problem if that record is
 * lost. Names are unique, so salts are unique; the per-name cost of a rainbow
 * table is what the iteration count and the worker's rate limiting are for.
 */
const ITERATIONS = 600_000;
const ENC = new TextEncoder();
const DEC = new TextDecoder();

function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// No explicit return type: the bare `Uint8Array` name defaults to the
// `ArrayBufferLike`-backed generic, which `crypto.subtle.importKey`'s
// `BufferSource` overload rejects — inference from `new Uint8Array(n)`
// gives the narrower `Uint8Array<ArrayBuffer>` that it wants.
function fromHex(hex: string) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export async function deriveKeys(
  navn: string,
  pin: string,
): Promise<{ authKey: string; encKeyRaw: string }> {
  // NUL between the fields so ("ab", "1") and ("a", "b1") cannot derive alike.
  const material = await crypto.subtle.importKey(
    "raw",
    ENC.encode(`${navn}\u0000${pin}`),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const master = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: ENC.encode(`np-sync-v1:${navn}`),
      iterations: ITERATIONS,
      hash: "SHA-256",
    },
    material,
    256,
  );
  const hkdf = await crypto.subtle.importKey("raw", master, "HKDF", false, ["deriveBits"]);
  const derive = (info: string): Promise<ArrayBuffer> =>
    crypto.subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: ENC.encode(info) },
      hkdf,
      256,
    );
  return { authKey: toHex(await derive("auth")), encKeyRaw: toHex(await derive("enc")) };
}

async function importEncKey(encKeyRaw: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", fromHex(encKeyRaw), "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

/** `base64(iv ‖ ciphertext)`. The IV is fresh per call — GCM fails catastrophically on reuse. */
export async function seal(encKeyRaw: string, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await importEncKey(encKeyRaw),
    ENC.encode(plaintext),
  );
  const joined = new Uint8Array(iv.length + cipher.byteLength);
  joined.set(iv, 0);
  joined.set(new Uint8Array(cipher), iv.length);
  return btoa(String.fromCharCode(...joined));
}

/** `null` for a wrong key or corrupt input — callers treat both as "not mine". */
export async function open(encKeyRaw: string, sealed: string): Promise<string | null> {
  try {
    const joined = Uint8Array.from(atob(sealed), (c) => c.charCodeAt(0));
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: joined.subarray(0, 12) },
      await importEncKey(encKeyRaw),
      joined.subarray(12),
    );
    return DEC.decode(plain);
  } catch {
    return null;
  }
}
