import type { AttachmentMime } from './feedback';
import { imageMaxBytes, videoMaxBytes } from './feedback';

export class MediaValidationError extends Error {}
const bad = (): never => {
  throw new MediaValidationError(
    'Die Datei ist kein unterstütztes, vollständiges Medienformat.',
  );
};
const ascii = (b: Uint8Array, start: number, length: number) =>
  String.fromCharCode(...b.subarray(start, start + length));
const u32 = (b: Uint8Array, i: number, little = false) =>
  new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(i, little);
function png(b: Uint8Array) {
  if (
    b.length < 45 ||
    ![137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => b[i] === n)
  )
    return false;
  let i = 8,
    image = false,
    header = false;
  while (i + 12 <= b.length) {
    const n = u32(b, i),
      kind = ascii(b, i + 4, 4);
    if (n > b.length - i - 12) return false;
    let crc = 0xffffffff;
    for (let p = i + 4; p < i + 8 + n; p++) {
      crc ^= b[p];
      for (let j = 0; j < 8; j++)
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    if ((crc ^ 0xffffffff) >>> 0 !== u32(b, i + 8 + n)) return false;
    if (!header) {
      if (
        kind !== 'IHDR' ||
        n !== 13 ||
        !u32(b, i + 8) ||
        !u32(b, i + 12) ||
        b[i + 18] !== 0 ||
        b[i + 19] !== 0 ||
        b[i + 20] > 1
      )
        return false;
      header = true;
    } else if (kind === 'IHDR') return false;
    if (kind === 'IDAT' && n > 0) image = true;
    i += n + 12;
    if (kind === 'IEND') return n === 0 && image && i === b.length;
  }
  return false;
}
function jpeg(b: Uint8Array) {
  if (b[0] !== 255 || b[1] !== 216 || b.length < 12) return false;
  let i = 2,
    frame = false,
    scan = false;
  while (i < b.length) {
    if (b[i++] !== 255) return false;
    while (b[i] === 255) i++;
    const marker = b[i++];
    if (marker === 217) return frame && scan && i === b.length;
    if (marker === 0 || marker === 216 || i + 2 > b.length) return false;
    if (marker >= 208 && marker <= 215) continue;
    const n = (b[i] << 8) | b[i + 1];
    if (n < 2 || i + n > b.length) return false;
    if (
      [
        192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207,
      ].includes(marker)
    ) {
      if (
        n < 11 ||
        n !== 8 + 3 * b[i + 7] ||
        !(b[i + 3] || b[i + 4]) ||
        !(b[i + 5] || b[i + 6])
      )
        return false;
      frame = true;
    }
    i += n;
    if (marker === 218) {
      if (n < 8 || n !== 6 + 2 * b[i - n + 2]) return false;
      scan = true;
      const start = i;
      while (i < b.length) {
        if (b[i] !== 255) {
          i++;
          continue;
        }
        if (b[i + 1] === 0 || (b[i + 1] >= 208 && b[i + 1] <= 215)) {
          i += 2;
          continue;
        }
        break;
      }
      if (i === start) return false;
    }
  }
  return false;
}
function webp(b: Uint8Array, allowAnimation = true) {
  if (
    b.length < 26 ||
    ascii(b, 0, 4) !== 'RIFF' ||
    u32(b, 4, true) !== b.length - 8 ||
    ascii(b, 8, 4) !== 'WEBP'
  )
    return false;
  let i = 12,
    image = false;
  while (i + 8 <= b.length) {
    const kind = ascii(b, i, 4),
      n = u32(b, i + 4, true);
    if (n > b.length - i - 8) return false;
    if (kind === 'VP8 ') {
      if (
        n < 10 ||
        ascii(b, i + 11, 3) !== '\x9d\x01\x2a' ||
        !((b[i + 14] | (b[i + 15] << 8)) & 16383) ||
        !((b[i + 16] | (b[i + 17] << 8)) & 16383)
      )
        return false;
      image = true;
    }
    if (kind === 'VP8L') {
      if (n < 6 || b[i + 8] !== 47 || (b[i + 12] & 224) !== 0) return false;
      image = true;
    }
    if (
      kind === 'VP8X' &&
      (n !== 10 || (b[i + 8] & 193) !== 0 || b[i + 9] || b[i + 10] || b[i + 11])
    )
      return false;
    if (kind === 'ANMF') {
      if (!allowAnimation || n < 24) return false;
      const frame = new Uint8Array(n - 16 + 12);
      frame.set([82, 73, 70, 70], 0);
      new DataView(frame.buffer).setUint32(4, frame.length - 8, true);
      frame.set([87, 69, 66, 80], 8);
      frame.set(b.subarray(i + 24, i + 8 + n), 12);
      if (!webp(frame, false)) return false;
      image = true;
    }
    i += 8 + n + (n % 2);
  }
  return image && i === b.length;
}
function iso(b: Uint8Array): AttachmentMime | null {
  const compatible: string[] = [];
  let i = 0,
    brand = '',
    movie = false,
    data = false;
  while (i + 8 <= b.length) {
    let n = u32(b, i),
      header = 8;
    const kind = ascii(b, i + 4, 4);
    if (n === 1) {
      if (i + 16 > b.length || u32(b, i + 8) !== 0) return null;
      n = u32(b, i + 12);
      header = 16;
    }
    if (n === 0) n = b.length - i;
    if (n < header || n > b.length - i) return null;
    if (kind === 'ftyp') {
      if (brand || n < header + 8 || n > 4096 || (n - header) % 4 !== 0)
        return null;
      brand = ascii(b, i + header, 4);
      for (let p = i + header + 8; p < i + n; p += 4)
        compatible.push(ascii(b, p, 4));
    }
    if (kind === 'moov') {
      // Require a video handler, rather than accepting an audio-only MP4.
      const findVideo = (
        start: number,
        end: number,
        depth: number,
      ): boolean => {
        let p = start,
          found = false;
        while (p + 8 <= end) {
          const size = u32(b, p),
            kind = ascii(b, p + 4, 4);
          if (size < 8 || size > end - p) return false;
          if (
            (depth === 0 && kind === 'trak') ||
            (depth === 1 && kind === 'mdia')
          )
            found = findVideo(p + 8, p + size, depth + 1) || found;
          if (
            depth === 2 &&
            kind === 'hdlr' &&
            size >= 20 &&
            ascii(b, p + 16, 4) === 'vide'
          )
            found = true;
          p += size;
        }
        return p === end && found;
      };
      movie = findVideo(i + header, i + n, 0) || movie;
    }
    if (kind === 'mdat' && n > header) data = true;
    i += n;
  }
  if (i !== b.length || !movie || !data) return null;
  if (!brand || brand === 'qt  ') return 'video/quicktime';
  return [brand, ...compatible].some((v) =>
    [
      'isom',
      'iso2',
      'iso3',
      'iso4',
      'iso5',
      'iso6',
      'mp41',
      'mp42',
      'avc1',
      'M4V ',
      'dash',
    ].includes(v),
  )
    ? 'video/mp4'
    : null;
}
function vint(
  b: Uint8Array,
  i: number,
  identifier = false,
): [number, number] | null {
  if (i >= b.length || b[i] === 0) return null;
  let n = 1,
    mask = 128;
  while (!(b[i] & mask)) {
    n++;
    mask >>= 1;
  }
  if (n > 8 || i + n > b.length) return null;
  if (
    !identifier &&
    (b[i] & (mask - 1)) === mask - 1 &&
    b.subarray(i + 1, i + n).every((v) => v === 255)
  )
    return [-1, n];
  let v = identifier ? b[i] : b[i] & (mask - 1);
  for (let j = 1; j < n; j++) v = v * 256 + b[i + j];
  return Number.isSafeInteger(v) ? [v, n] : null;
}
function webm(b: Uint8Array) {
  if (b.length < 20 || u32(b, 0) !== 0x1a45dfa3) return false;
  const header = vint(b, 4);
  if (!header || header[0] < 0) return false;
  const end = 4 + header[1] + header[0];
  if (end > b.length) return false;
  let p = 4 + header[1],
    type = false;
  while (p < end) {
    const id = vint(b, p, true);
    if (!id) return false;
    p += id[1];
    const size = vint(b, p);
    if (!size || size[0] < 0) return false;
    p += size[1];
    if (p + size[0] > end) return false;
    if (id[0] === 0x4282 && size[0] === 4 && ascii(b, p, 4) === 'webm')
      type = true;
    p += size[0];
  }
  if (!type || p + 5 > b.length || u32(b, p) !== 0x18538067) return false;
  p += 4;
  const segment = vint(b, p);
  if (!segment) return false;
  p += segment[1];
  // Streaming WebM may use an unknown Segment size; actual child sizes stay bounded.
  const stop = segment[0] === -1 ? b.length : p + segment[0];
  if (stop !== b.length) return false;
  let tracks = false,
    cluster = false;
  while (p < stop) {
    const id = vint(b, p, true);
    if (!id) return false;
    p += id[1];
    const size = vint(b, p);
    if (!size) return false;
    p += size[1];
    if (size[0] === -1 && id[0] === 0x1f43b675) {
      // Unknown-sized streaming clusters are bounded by the uploaded file.
      // Walk their actual child headers instead of trusting the unknown size.
      let q = p,
        blocks = false;
      while (q < stop) {
        const field = vint(b, q, true);
        if (!field) return false;
        q += field[1];
        const count = vint(b, q);
        if (!count || count[0] < 0) return false;
        q += count[1];
        if (q + count[0] > stop) return false;
        if ((field[0] === 0xa3 || field[0] === 0xa0) && count[0] > 0)
          blocks = true;
        q += count[0];
      }
      return tracks && blocks;
    }
    if (size[0] < 1 || p + size[0] > stop) return false;
    if (id[0] === 0x1654ae6b) {
      let q = p;
      const end = p + size[0];
      while (q < end) {
        const entry = vint(b, q, true);
        if (!entry) return false;
        q += entry[1];
        const n = vint(b, q);
        if (!n || n[0] < 1) return false;
        q += n[1];
        const entryEnd = q + n[0];
        if (entryEnd > end) return false;
        if (entry[0] === 0xae)
          while (q < entryEnd) {
            const field = vint(b, q, true);
            if (!field) return false;
            q += field[1];
            const count = vint(b, q);
            if (!count || count[0] < 1) return false;
            q += count[1];
            if (q + count[0] > entryEnd) return false;
            if (field[0] === 0x83 && count[0] === 1 && b[q] === 1)
              tracks = true;
            q += count[0];
          }
        q = entryEnd;
      }
    }
    if (id[0] === 0x1f43b675) cluster = true;
    p += size[0];
  }
  return tracks && cluster;
}
/** Structural container validation, not codec decoding or malware analysis. */
export function validateMedia(
  bytes: Uint8Array,
  declaredMime: string,
  declaredSize: number,
): AttachmentMime {
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.length !== declaredSize ||
    !Number.isSafeInteger(declaredSize) ||
    declaredSize < 1 ||
    declaredSize >
      (declaredMime.startsWith('image/') ? imageMaxBytes : videoMaxBytes)
  )
    bad();
  let actual: AttachmentMime | null = null;
  try {
    if (png(bytes)) actual = 'image/png';
    else if (jpeg(bytes)) actual = 'image/jpeg';
    else if (webp(bytes)) actual = 'image/webp';
    else if (webm(bytes)) actual = 'video/webm';
    else actual = iso(bytes);
  } catch {
    bad();
  }
  if (!actual || actual !== declaredMime) return bad();
  return actual;
}
