// RSA PKCS#1 v1.5 encryption, just enough to hand the home Wi‑Fi password to the air
// conditioner during setup (docs/protocol-wifi-setup.md §2.5). Uses BigInt; no dependencies.

export type RsaKey = { n: bigint; e: bigint; size: number };

const big = (b: number[]) => b.reduce((acc, x) => (acc << 8n) | BigInt(x), 0n);

/** One DER element at `i`: content range and where the next element starts. */
function tlv(b: number[], i: number) {
  let len = b[i + 1];
  let start = i + 2;
  if (len & 0x80) {
    const count = len & 0x7f;
    len = 0;
    for (let k = 0; k < count; k++) len = len * 256 + b[start++];
  }
  return { tag: b[i], start, end: start + len };
}

/** X.509 SubjectPublicKeyInfo (what the unit sends) or a bare PKCS#1 RSAPublicKey. */
export function parsePublicKey(der: number[]): RsaKey {
  let seq = tlv(der, 0);
  const first = tlv(der, seq.start);
  if (first.tag !== 0x02) {
    const bits = tlv(der, first.end); // BIT STRING after the algorithm identifier
    seq = tlv(der, bits.start + 1); // skip the "unused bits" byte
  }
  const n = tlv(der, seq.start);
  const e = tlv(der, n.end);
  const nBytes = der.slice(n.start, n.end);
  while (nBytes[0] === 0) nBytes.shift();
  return { n: big(nBytes), e: big(der.slice(e.start, e.end)), size: nBytes.length };
}

function modPow(base: bigint, exp: bigint, mod: bigint) {
  let result = 1n;
  base %= mod;
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % mod;
    base = (base * base) % mod;
    exp >>= 1n;
  }
  return result;
}

/** `randomBytes(n)` must return n cryptographically random bytes. */
export function encryptPkcs1(key: RsaKey, message: number[], randomBytes: (n: number) => number[]): number[] {
  const k = key.size;
  if (message.length > k - 11) throw new Error('Wi‑Fi details are too long');
  const pad: number[] = [];
  while (pad.length < k - 3 - message.length) pad.push(...randomBytes(k).filter((x) => x !== 0));
  const block = [0x00, 0x02, ...pad.slice(0, k - 3 - message.length), 0x00, ...message];
  const c = modPow(big(block), key.e, key.n);
  const out: number[] = [];
  for (let v = c, i = 0; i < k; i++, v >>= 8n) out.unshift(Number(v & 0xffn));
  return out;
}
