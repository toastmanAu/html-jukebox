/**
 * How the light show hears the music.
 *
 * The audio element must play on its own, straight to the device. Sending playback
 * through a Web Audio graph (createMediaElementSource) makes the graph the only way
 * out, and on phones that path goes silent on Bluetooth speakers, obeys the mute
 * switch and stops when the screen locks. So the light show only ever listens:
 *
 * - 'stream':  analyse a copy of the element's output (captureStream). Playback is untouched.
 * - 'none':    no way to listen without taking over playback (Safari, every iOS browser).
 *              The light show runs on a pretend spectrum.
 * - 'element': route the element through Web Audio. Only where there is no copy to
 *              listen to and the routing is known to be harmless (desktop Firefox).
 */
export type TapMode = 'stream' | 'none' | 'element';

export function chooseTap(env: { captureStream: boolean; appleWebKit: boolean }): TapMode {
  if (env.captureStream) return 'stream';
  return env.appleWebKit ? 'none' : 'element';
}

export function detectTap(element: HTMLMediaElement): TapMode {
  return chooseTap({
    captureStream: typeof (element as { captureStream?: unknown }).captureStream === 'function',
    appleWebKit: /Apple/.test(navigator.vendor ?? ''),
  });
}

/** A moving, music-shaped spectrum for when the real one cannot be heard: strong bass with a beat, quieter highs. */
export function pretendSpectrum(spectrum: Uint8Array, seconds: number): void {
  const beat = Math.pow(0.5 + 0.5 * Math.sin(seconds * Math.PI * 4), 3);   // two pulses a second
  for (let i = 0; i < spectrum.length; i++) {
    const tilt = Math.exp(-i / 48);
    const ripple = 0.5 + 0.5 * Math.sin(seconds * (1.3 + (i % 7) * 0.31) + i * 0.45);
    spectrum[i] = Math.round(255 * Math.min(1, tilt * (0.35 + 0.55 * beat) + 0.22 * ripple * (0.4 + tilt)));
  }
}
