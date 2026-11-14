import { describe, expect, it } from 'vitest';
import { chooseTap, pretendSpectrum } from '../src/music/tap';

describe('how the light show listens', () => {
  it('listens to a copy of the stream where the browser offers one, leaving playback alone', () => {
    expect(chooseTap({ captureStream: true, appleWebKit: false })).toBe('stream');
    expect(chooseTap({ captureStream: true, appleWebKit: true })).toBe('stream');
  });
  it('never routes playback through Web Audio on Apple WebKit', () => {
    expect(chooseTap({ captureStream: false, appleWebKit: true })).toBe('none');
  });
  it('routes the element through Web Audio only as a last resort elsewhere', () => {
    expect(chooseTap({ captureStream: false, appleWebKit: false })).toBe('element');
  });
});

describe('pretend spectrum', () => {
  it('fills every bin with a byte value and moves over time', () => {
    const a = new Uint8Array(256), b = new Uint8Array(256);
    pretendSpectrum(a, 1); pretendSpectrum(b, 1.3);
    expect(a.some(v => v > 0)).toBe(true);
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });
  it('is louder in the bass than at the top, like music', () => {
    const s = new Uint8Array(256);
    let low = 0, high = 0;
    for (let t = 0; t < 4; t += 0.1) { pretendSpectrum(s, t); low += s.slice(0, 16).reduce((x, y) => x + y, 0); high += s.slice(200, 216).reduce((x, y) => x + y, 0); }
    expect(low).toBeGreaterThan(high * 2);
  });
});
