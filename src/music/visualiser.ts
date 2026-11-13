/**
 * The light show behind the music player: a kaleidoscope of spectrum ribbons
 * that leaves trails by redrawing the previous frame slightly larger and
 * rotated. Drawn on a 2D canvas so it needs no WebGL and stays cheap.
 *
 * `draw` is called once per animation frame with the current spectrum
 * (0-255 per bin). With reduced motion it draws a still, mirrored spectrum
 * and nothing spins or zooms.
 */
export interface Scope {
  draw(spectrum: Uint8Array, seconds: number, playing: boolean): void;
  resize(): void;
}

const ARMS = 6;

export function createScope(canvas: HTMLCanvasElement, reducedMotion: boolean): Scope {
  const ctx = canvas.getContext('2d', { alpha: false })!;
  let width = 0, height = 0, smoothedBass = 0;

  function resize() {
    const scale = Math.min(window.devicePixelRatio || 1, 1.5);
    width = Math.max(1, Math.floor(canvas.clientWidth * scale));
    height = Math.max(1, Math.floor(canvas.clientHeight * scale));
    canvas.width = width; canvas.height = height;
    ctx.fillStyle = '#05060d'; ctx.fillRect(0, 0, width, height);
  }

  function still(spectrum: Uint8Array) {
    ctx.fillStyle = '#05060d'; ctx.fillRect(0, 0, width, height);
    const bars = 48, gap = width / bars;
    for (let i = 0; i < bars; i++) {
      const value = spectrum[Math.floor(i * spectrum.length * 0.6 / bars)] / 255;
      const tall = value * height * 0.35;
      ctx.fillStyle = `hsl(${200 + i * 3}, 80%, ${35 + value * 30}%)`;
      ctx.fillRect(i * gap + 1, height / 2 - tall, gap - 2, tall * 2);
    }
  }

  function draw(spectrum: Uint8Array, seconds: number, playing: boolean) {
    if (reducedMotion) { still(spectrum); return; }
    const cx = width / 2, cy = height / 2, reach = Math.min(width, height) * 0.5;
    let bass = 0;
    for (let i = 1; i < 8; i++) bass += spectrum[i];
    smoothedBass += (bass / (7 * 255) - smoothedBass) * 0.25;

    // Trails: the last frame, a little bigger, a little turned, a little dimmer.
    ctx.globalCompositeOperation = 'source-over';
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(0.004 + smoothedBass * 0.012);
    const zoom = 1.012 + smoothedBass * 0.03;
    ctx.scale(zoom, zoom);
    ctx.translate(-cx, -cy);
    ctx.globalAlpha = 0.93;
    ctx.drawImage(canvas, 0, 0);
    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(5, 6, 13, 0.07)';
    ctx.fillRect(0, 0, width, height);

    // New light: one spectrum ribbon, repeated around the centre and mirrored.
    ctx.globalCompositeOperation = 'lighter';
    const bins = Math.floor(spectrum.length * 0.55), spin = seconds * 0.18;
    const idle = playing ? 0 : 0.08 + 0.05 * Math.sin(seconds * 0.9);
    for (let arm = 0; arm < ARMS; arm++) {
      for (const mirror of [1, -1]) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(spin + arm * Math.PI * 2 / ARMS);
        ctx.scale(1, mirror);
        ctx.beginPath();
        for (let i = 0; i < bins; i += 2) {
          const level = Math.max(spectrum[i] / 255, idle);
          const along = reach * (0.08 + 0.9 * i / bins);
          const out = level * reach * 0.22;
          if (i === 0) ctx.moveTo(along, out); else ctx.lineTo(along, out);
        }
        ctx.strokeStyle = `hsla(${(seconds * 24 + arm * 60) % 360}, 95%, 60%, 0.5)`;
        ctx.lineWidth = Math.max(1.5, width / 520);
        ctx.stroke();
        ctx.restore();
      }
    }
    // A pulse at the centre on the kick.
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, reach * (0.1 + smoothedBass * 0.35));
    glow.addColorStop(0, `hsla(${(seconds * 40) % 360}, 100%, 70%, ${0.1 + smoothedBass * 0.5})`);
    glow.addColorStop(1, 'hsla(0, 0%, 0%, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'source-over';
  }

  resize();
  return { draw, resize };
}
