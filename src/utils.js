export const formatTime = (time) => {
  if (time === null || Number.isNaN(time)) {
    return "—";
  }
  const totalMs = Math.max(0, Math.round(time * 1000));
  const hours = Math.floor(totalMs / 3600000);
  const minutes = Math.floor((totalMs % 3600000) / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const ms = Math.floor(totalMs % 1000)
    .toString()
    .padStart(3, "0");
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds
      .toString()
      .padStart(2, "0")}.${ms}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, "0")}.${ms}`;
};

export const toHex = (buffer) =>
  Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

// -----------------------------------------------------------------------------
// Streaming SHA-256 (incremental)
//
// WebCrypto does not provide an incremental SHA-256 interface, and using
// file.arrayBuffer() on large videos can allocate huge RAM.
// This implementation hashes a File/Blob in chunks.

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (x, n) => (x >>> n) | (x << (32 - n));
const ch = (x, y, z) => (x & y) ^ (~x & z);
const maj = (x, y, z) => (x & y) ^ (x & z) ^ (y & z);
const s0 = (x) => rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3);
const s1 = (x) => rotr(x, 17) ^ rotr(x, 19) ^ (x >>> 10);
const S0 = (x) => rotr(x, 2) ^ rotr(x, 13) ^ rotr(x, 22);
const S1 = (x) => rotr(x, 6) ^ rotr(x, 11) ^ rotr(x, 25);

class Sha256 {
  constructor() {
    this.h0 = 0x6a09e667;
    this.h1 = 0xbb67ae85;
    this.h2 = 0x3c6ef372;
    this.h3 = 0xa54ff53a;
    this.h4 = 0x510e527f;
    this.h5 = 0x9b05688c;
    this.h6 = 0x1f83d9ab;
    this.h7 = 0x5be0cd19;
    this.buffer = new Uint8Array(64);
    this.bufferLength = 0;
    this.bytesHashed = 0;
    this.finished = false;
    this.temp = new Uint32Array(64);
  }

  update(data) {
    if (this.finished) throw new Error('Sha256: update after digest');
    let pos = 0;
    const len = data.length;
    this.bytesHashed += len;
    while (pos < len) {
      const take = Math.min(len - pos, 64 - this.bufferLength);
      this.buffer.set(data.subarray(pos, pos + take), this.bufferLength);
      this.bufferLength += take;
      pos += take;
      if (this.bufferLength === 64) {
        this._compress(this.buffer);
        this.bufferLength = 0;
      }
    }
  }

  _compress(chunk) {
    const w = this.temp;
    for (let i = 0; i < 16; i++) {
      const j = i * 4;
      w[i] = ((chunk[j] << 24) | (chunk[j + 1] << 16) | (chunk[j + 2] << 8) | chunk[j + 3]) >>> 0;
    }
    for (let i = 16; i < 64; i++) {
      w[i] = (s1(w[i - 2]) + w[i - 7] + s0(w[i - 15]) + w[i - 16]) >>> 0;
    }

    let a = this.h0;
    let b = this.h1;
    let c = this.h2;
    let d = this.h3;
    let e = this.h4;
    let f = this.h5;
    let g = this.h6;
    let h = this.h7;

    for (let i = 0; i < 64; i++) {
      const t1 = (h + S1(e) + ch(e, f, g) + SHA256_K[i] + w[i]) >>> 0;
      const t2 = (S0(a) + maj(a, b, c)) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }

    this.h0 = (this.h0 + a) >>> 0;
    this.h1 = (this.h1 + b) >>> 0;
    this.h2 = (this.h2 + c) >>> 0;
    this.h3 = (this.h3 + d) >>> 0;
    this.h4 = (this.h4 + e) >>> 0;
    this.h5 = (this.h5 + f) >>> 0;
    this.h6 = (this.h6 + g) >>> 0;
    this.h7 = (this.h7 + h) >>> 0;
  }

  digest() {
    if (this.finished) throw new Error('Sha256: digest already called');
    this.finished = true;
    const bytesHashed = this.bytesHashed;
    const left = this.bufferLength;

    this.buffer[left] = 0x80;
    this.buffer.fill(0, left + 1);
    if (left >= 56) {
      this._compress(this.buffer);
      this.buffer.fill(0);
    }

    const bitLenHi = Math.floor((bytesHashed * 8) / 2 ** 32);
    const bitLenLo = (bytesHashed * 8) >>> 0;
    this.buffer[56] = (bitLenHi >>> 24) & 0xff;
    this.buffer[57] = (bitLenHi >>> 16) & 0xff;
    this.buffer[58] = (bitLenHi >>> 8) & 0xff;
    this.buffer[59] = bitLenHi & 0xff;
    this.buffer[60] = (bitLenLo >>> 24) & 0xff;
    this.buffer[61] = (bitLenLo >>> 16) & 0xff;
    this.buffer[62] = (bitLenLo >>> 8) & 0xff;
    this.buffer[63] = bitLenLo & 0xff;
    this._compress(this.buffer);

    const out = new Uint8Array(32);
    const hs = [this.h0, this.h1, this.h2, this.h3, this.h4, this.h5, this.h6, this.h7];
    for (let i = 0; i < hs.length; i++) {
      out[i * 4] = (hs[i] >>> 24) & 0xff;
      out[i * 4 + 1] = (hs[i] >>> 16) & 0xff;
      out[i * 4 + 2] = (hs[i] >>> 8) & 0xff;
      out[i * 4 + 3] = hs[i] & 0xff;
    }
    return out;
  }
}

/**
 * Hash a File/Blob in chunks and return hex SHA-256.
 * @param {File|Blob} file
 * @param {{chunkSize?: number, onProgress?: (p:{loaded:number,total:number,percent:number})=>void}} opts
 */
export async function hashFileStream(file, opts = {}) {
  const chunkSize = Math.max(256 * 1024, opts.chunkSize || 2 * 1024 * 1024);
  const total = file.size || 0;
  let loaded = 0;
  const hasher = new Sha256();

  const report = () => {
    if (typeof opts.onProgress === 'function') {
      const percent = total ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
      opts.onProgress({ loaded, total, percent });
    }
  };

  if (file.stream && typeof file.stream === 'function') {
    const reader = file.stream().getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
      hasher.update(chunk);
      loaded += chunk.byteLength;
      report();
      if (loaded % (32 * 1024 * 1024) < chunk.byteLength) {
        await new Promise((r) => setTimeout(r, 0));
      }
    }
  } else {
    for (let offset = 0; offset < total; offset += chunkSize) {
      const slice = file.slice(offset, Math.min(total, offset + chunkSize));
      const buf = await slice.arrayBuffer();
      const chunk = new Uint8Array(buf);
      hasher.update(chunk);
      loaded += chunk.byteLength;
      report();
      if (loaded % (32 * 1024 * 1024) < chunk.byteLength) {
        await new Promise((r) => setTimeout(r, 0));
      }
    }
  }

  const digest = hasher.digest();
  return Array.from(digest)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Compute a SHA‑256 hash of an arbitrary string. The returned
 * promise resolves to a lowercase hexadecimal string. This helper
 * wraps the Web Crypto API and reuses the existing toHex() to
 * convert the ArrayBuffer into a human‑readable hex digest. If
 * crypto.subtle is not available (e.g. in some older browsers),
 * the promise rejects.
 *
 * @param {string} str Input string to hash
 * @returns {Promise<string>} Lowercase hex SHA‑256 digest
 */
export async function hashString(str) {
  if (!('crypto' in window) || !window.crypto.subtle) {
    throw new Error('Web Crypto API unavailable');
  }
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const digest = await window.crypto.subtle.digest('SHA-256', data);
  return toHex(digest);
}
