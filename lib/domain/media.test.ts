import { describe, expect, it } from 'vitest';
import { validateMedia } from './media';
const png = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=',
  ),
  (c) => c.charCodeAt(0),
);
const bytes = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const box = (type: string, body: Uint8Array) => {
  const b = new Uint8Array(8 + body.length);
  new DataView(b.buffer).setUint32(0, b.length);
  b.set(bytes(type), 4);
  b.set(body, 8);
  return b;
};
const join = (...parts: Uint8Array[]) => {
  const b = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) {
    b.set(p, i);
    i += p.length;
  }
  return b;
};
describe('LUUFI-11 bounded actual container validation', () => {
  it('accepts supported image/video containers and rejects wrong declarations', () => {
    const jpeg = Uint8Array.from([
      255, 216, 255, 192, 0, 11, 8, 0, 1, 0, 1, 1, 1, 17, 0, 255, 218, 0, 8, 1,
      1, 0, 0, 63, 0, 42, 255, 217,
    ]);
    const webp = join(
      bytes('RIFF'),
      Uint8Array.from([18, 0, 0, 0]),
      bytes('WEBPVP8L'),
      Uint8Array.from([6, 0, 0, 0, 47, 0, 0, 0, 0, 42]),
    );
    const mp4 = (brand: string) =>
      join(
        box('ftyp', join(bytes(brand), new Uint8Array(4))),
        box(
          'moov',
          box(
            'trak',
            box('mdia', box('hdlr', join(new Uint8Array(8), bytes('vide')))),
          ),
        ),
        box('mdat', new Uint8Array([1])),
      );
    const webm = Uint8Array.from([
      0x1a, 0x45, 0xdf, 0xa3, 0x87, 0x42, 0x82, 0x84, 119, 101, 98, 109, 0x18,
      0x53, 0x80, 0x67, 0x90, 0x16, 0x54, 0xae, 0x6b, 0x85, 0xae, 0x83, 0x83,
      0x81, 1, 0x1f, 0x43, 0xb6, 0x75, 0x81, 1,
    ]);
    for (const [b, mime] of [
      [png, 'image/png'],
      [jpeg, 'image/jpeg'],
      [webp, 'image/webp'],
      [mp4('isom'), 'video/mp4'],
      [mp4('qt  '), 'video/quicktime'],
      [webm, 'video/webm'],
    ] as const) {
      expect(validateMedia(b, mime, b.length)).toBe(mime);
      expect(() => validateMedia(b, 'text/html', b.length)).toThrow();
      expect(() =>
        validateMedia(b.subarray(0, b.length - 1), mime, b.length - 1),
      ).toThrow();
    }
    const streaming = webm.slice();
    streaming[16] = 255;
    expect(validateMedia(streaming, 'video/webm', streaming.length)).toBe(
      'video/webm',
    );
    const unknownCluster = join(
      webm.subarray(0, 31),
      Uint8Array.from([255, 0xa3, 0x81, 1]),
    );
    unknownCluster[16] = 255;
    expect(
      validateMedia(unknownCluster, 'video/webm', unknownCluster.length),
    ).toBe('video/webm');
    const frame = join(new Uint8Array(16), webp.subarray(12));
    const animation = join(
      bytes('RIFF'),
      new Uint8Array(4),
      bytes('WEBPANMF'),
      new Uint8Array(4),
      frame,
    );
    new DataView(animation.buffer).setUint32(4, animation.length - 8, true);
    new DataView(animation.buffer).setUint32(16, frame.length, true);
    expect(validateMedia(animation, 'image/webp', animation.length)).toBe(
      'image/webp',
    );
    const audio = mp4('isom');
    const handler = audio.findIndex((_, i) => asciiAt(audio, i) === 'vide');
    audio.set(bytes('soun'), handler);
    expect(() => validateMedia(audio, 'video/mp4', audio.length)).toThrow();
  });
  it('rejects declared lengths, oversized media, corrupt PNG chunks and executable data', () => {
    expect(() => validateMedia(png, 'image/png', png.length + 1)).toThrow();
    expect(() =>
      validateMedia(new Uint8Array(10_000_001), 'image/png', 10_000_001),
    ).toThrow();
    expect(() =>
      validateMedia(new Uint8Array(15_000_001), 'video/mp4', 15_000_001),
    ).toThrow();
    const broken = png.slice();
    broken[20] ^= 1;
    expect(() => validateMedia(broken, 'image/png', broken.length)).toThrow();
    const html = bytes('<html><script>alert(1)</script></html>');
    expect(() => validateMedia(html, 'image/png', html.length)).toThrow();
  });
});
function asciiAt(b: Uint8Array, i: number) {
  return String.fromCharCode(...b.slice(i, i + 4));
}
