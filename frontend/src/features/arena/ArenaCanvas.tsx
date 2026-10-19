import { useEffect, useRef } from 'react';
import { stepCoins, type CoinMap } from './engine';
import type { PaymentStatus } from '../../lib/api/types';

interface Props {
  coins: CoinMap;
  scene: { intensity: number };
  /** Short text equivalent of what the canvas shows right now. */
  summary: string;
}

const STATUS_VARS: Record<PaymentStatus, string> = {
  PENDING: '--color-status-pending',
  PROCESSING: '--color-status-processing',
  SUCCEEDED: '--color-status-succeeded',
  FAILED: '--color-status-failed',
  CANCELLED: '--color-status-cancelled',
};

// Colours come from the CSS theme tokens so the canvas follows the design system.
function readColors() {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string) => cs.getPropertyValue(name).trim() || 'currentColor';
  return {
    status: Object.fromEntries(Object.entries(STATUS_VARS).map(([k, n]) => [k, v(n)])) as Record<PaymentStatus, string>,
    line: v('--color-line'),
    surface: v('--color-surface-strong'),
    fg: v('--color-fg'),
    muted: v('--color-muted'),
    accent: v('--color-accent'),
    mono: cs.getPropertyValue('--font-mono').trim() || 'monospace',
  };
}

export function ArenaCanvas({ coins, scene, summary }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    // jsdom has no 2D context; without one there is simply nothing to draw.
    const ctx = canvas?.getContext('2d') ?? null;
    if (!wrap || !canvas || !ctx) return;

    const reducedQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
    let reduced = reducedQuery?.matches ?? false;
    const onMotionChange = () => (reduced = reducedQuery?.matches ?? false);
    reducedQuery?.addEventListener('change', onMotionChange);

    const colors = readColors();
    let w = 0;
    let h = 0;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      w = wrap.clientWidth;
      h = wrap.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
    ro?.observe(wrap);

    const box = (x: number, y: number, bw: number, bh: number, stroke: string, label: string, labelColor: string) => {
      ctx.beginPath();
      ctx.roundRect(x, y, bw, bh, 12);
      ctx.fillStyle = colors.surface;
      ctx.fill();
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = labelColor;
      ctx.font = `600 11px ${colors.mono}`;
      ctx.textAlign = 'center';
      ctx.fillText(label, x + bw / 2, y + 16);
    };

    let raf = 0;
    let last = performance.now();
    const frame = (t: number) => {
      const dt = Math.min(50, t - last);
      last = t;
      stepCoins(coins, dt, reduced);

      let vault = 0;
      let failed = 0;
      for (const c of coins.values()) {
        if (c.status === 'SUCCEEDED') vault++;
        else if (c.status === 'FAILED') failed++;
      }

      ctx.clearRect(0, 0, w, h);
      const k = scene.intensity;

      // Intake lane label
      ctx.fillStyle = colors.muted;
      ctx.font = `600 11px ${colors.mono}`;
      ctx.textAlign = 'left';
      ctx.fillText('INTAKE', 12, 20);

      // Gateway: glows and shakes as chaos rises. No shake with reduced motion.
      const shake = reduced ? 0 : Math.sin(t / 40) * k * 2.5;
      ctx.save();
      ctx.translate(shake, 0);
      ctx.shadowColor = colors.status.FAILED;
      ctx.shadowBlur = k * 24;
      box(w * 0.42, h * 0.3, w * 0.16, h * 0.4, k > 0.5 ? colors.status.FAILED : colors.line, 'GATEWAY', colors.fg);
      ctx.restore();

      box(w * 0.78, h * 0.06, w * 0.19, h * 0.4, colors.status.SUCCEEDED, `VAULT ${vault}`, colors.status.SUCCEEDED);
      box(w * 0.78, h * 0.58, w * 0.19, h * 0.38, colors.status.FAILED, `FAILED ${failed}`, colors.status.FAILED);

      const r = Math.max(5, Math.min(9, w / 55));
      for (const c of coins.values()) {
        const px = c.x * w;
        const py = c.y * h;
        // Processing coins breathe; with reduced motion they stay still.
        const pulse = c.status === 'PROCESSING' && !reduced ? Math.sin(t / 150) * 1.5 : 0;
        ctx.globalAlpha = Math.max(0, Math.min(1, c.alpha));
        ctx.beginPath();
        ctx.arc(px, py, r + pulse, 0, Math.PI * 2);
        ctx.fillStyle = colors.status[c.status];
        ctx.fill();
        if (c.status === 'PENDING' && c.attempts > 0) {
          ctx.fillStyle = colors.fg;
          ctx.font = `600 10px ${colors.mono}`;
          ctx.textAlign = 'left';
          ctx.fillText(`×${c.attempts}`, px + r + 2, py + 3);
        }
        ctx.globalAlpha = 1;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      reducedQuery?.removeEventListener('change', onMotionChange);
    };
  }, [coins, scene]);

  return (
    <div ref={wrapRef} className="h-[360px] w-full overflow-hidden rounded-card border border-line bg-surface backdrop-blur-md sm:h-[400px]">
      <canvas ref={canvasRef} role="img" aria-label={`Payment pipeline: coins travel from intake through the gateway to the success vault or the failed pile. ${summary} Events are listed in the engineer log.`} className="block size-full" />
    </div>
  );
}
