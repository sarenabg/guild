// Guild film kit, shared by the promo and the walkthrough.
// makeKit(M) takes the film's own motion.js module (so GRID/FORMAT are the film's).
// Everything is a pure function of time: no state, no Math.random.

export const C = {
  night: '#0A0B0F', hive: '#101116', cell: '#16171D', edge: '#2A2C33',
  paper: '#F2EFE6', soft: '#D6D3C9', muted: '#A3A199', ghost: '#5E5D58',
  honey: '#F5B82E', honeyHi: '#FFD36B', honeyDeep: '#3A2A08',
  mint: '#4ADE80', mintDeep: '#0F2418', rose: '#FB7185', roseDeep: '#2A0F14',
};
export const DISPLAY = 'Display', UI = 'UI';

export function makeKit(M) {
  const { W, H, FORMAT, clamp, lerp, spring, SPRING, font, rrect, hash01 } = M;

  // ---------------------------------------------------------------- data
  const maps = {};
  async function loadMaps(names) {
    await Promise.all(names.map(async (n) => {
      maps[n] = await fetch(`../shared/screens/${n}.json`).then((r) => r.json());
    }));
  }
  const loadCues = () => fetch('vo_cues.json').then((r) => r.json());
  /** A box on a captured screen, by kind and label prefix (CSS px). */
  function box(screen, kind, label = '', nth = 0) {
    const hits = maps[screen].boxes.filter((b) => b.kind === kind && b.label.toLowerCase().startsWith(label.toLowerCase()));
    if (!hits.length) throw new Error(`no ${kind} "${label}" on ${screen}`);
    return hits[Math.min(nth, hits.length - 1)];
  }
  /** Rows (li) inside a box, e.g. the ticks of a safety-check card. */
  function rowsIn(screen, b) {
    return maps[screen].boxes.filter((r) => r.kind === 'row' && r.x >= b.x - 1 && r.y >= b.y - 1 && r.x + r.w <= b.x + b.w + 1 && r.y + r.h <= b.y + b.h + 1);
  }
  const pad = (b, p) => ({ x: b.x - p, y: b.y - p, w: b.w + 2 * p, h: b.h + 2 * p });

  // ---------------------------------------------------------------- background
  function hexPath(ctx, x, y, r) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3 - Math.PI / 2;
      const px = x + r * Math.cos(a), py = y + r * Math.sin(a);
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath();
  }
  /** Near-black, a slow honey glow, and a faint drifting honeycomb. */
  function bg(ctx, u, { glow = 1, gx = 0.62, gy = 0.42, drift = 1 } = {}) {
    ctx.fillStyle = C.night;
    ctx.fillRect(0, 0, W, H);
    const cx = W * (gx + 0.03 * Math.sin(u * 0.07)), cy = H * (gy + 0.03 * Math.cos(u * 0.05));
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * 0.7);
    g.addColorStop(0, `rgba(245,184,46,${0.13 * glow})`);
    g.addColorStop(0.45, `rgba(245,184,46,${0.035 * glow})`);
    g.addColorStop(1, 'rgba(245,184,46,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    const r = 48, dx = r * Math.sqrt(3), dy = r * 1.5;
    const ox = ((-u * 3 * drift) % dx) - dx, oy = ((-u * 1.5 * drift) % (dy * 2)) - dy * 2;
    ctx.save();
    ctx.strokeStyle = 'rgba(242,239,230,0.035)';
    ctx.lineWidth = 1.2;
    for (let row = 0; row < H / dy + 4; row++) {
      for (let col = 0; col < W / dx + 3; col++) {
        hexPath(ctx, ox + col * dx + (row % 2 ? dx / 2 : 0), oy + row * dy, r * 0.96);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- plates: real UI lifted out
  /**
   * A crop of a real screenshot as a floating card. src: CSS-px rect; dpr: capture scale.
   * dst: { cx, cy, w }. o: { k entrance 0..1, from [dx,dy], tilt, rot, rest, scale, alpha, glow, reveal, shadow }
   * Returns the drawn rect and scale (for placing overlays).
   */
  function plate(ctx, img, src, dpr, dst, o = {}) {
    const k = o.k ?? 1;
    if (k <= 0.001 || !img) return null;
    const w = dst.w, h = (dst.w * src.h) / src.w;
    const [fx, fy] = o.from ?? [0, 80];
    const cx = dst.cx + fx * (1 - k), cy = dst.cy + fy * (1 - k);
    const s = (o.scale ?? 1) * lerp(0.9, 1, k);
    const tilt = (o.tilt ?? 0) * (1 - k);
    ctx.save();
    ctx.globalAlpha = clamp(k * 1.6) * (o.alpha ?? 1);
    ctx.translate(cx, cy);
    ctx.rotate((o.rot ?? 0) * (1 - k) + (o.rest ?? 0));
    ctx.transform(1, tilt * 0.14, -tilt * 0.06, 1, 0, 0);
    ctx.scale(s * (1 - Math.abs(tilt) * 0.08), s);
    const r = 20 * (w / src.w);
    if (o.shadow !== false) {
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.65)';
      ctx.shadowBlur = 50;
      ctx.shadowOffsetY = 26;
      rrect(ctx, -w / 2, -h / 2, w, h, r);
      ctx.fillStyle = C.hive;
      ctx.fill();
      ctx.restore();
    }
    if (o.glow) {
      ctx.save();
      ctx.shadowColor = `rgba(245,184,46,${0.6 * o.glow})`;
      ctx.shadowBlur = 46 * o.glow;
      rrect(ctx, -w / 2, -h / 2, w, h, r);
      ctx.strokeStyle = `rgba(245,184,46,${0.75 * o.glow})`;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();
    }
    ctx.save();
    rrect(ctx, -w / 2, -h / 2, w, h, r);
    ctx.clip();
    ctx.drawImage(img, src.x * dpr, src.y * dpr, src.w * dpr, src.h * dpr, -w / 2, -h / 2, w, h);
    if (o.reveal !== undefined && o.reveal < 1) {
      ctx.fillStyle = C.hive;
      ctx.fillRect(-w / 2 + w * Math.max(0, o.reveal), -h / 2, w * (1 - Math.max(0, o.reveal)), h);
    }
    ctx.restore();
    ctx.restore();
    const ss = s * (1 - Math.abs(tilt) * 0.08);
    return { x: cx - (w * ss) / 2, y: cy - (h * s) / 2, w: w * ss, h: h * s, scale: (w * ss) / src.w, cx, cy };
  }
  /** A CSS-px point on the capture, mapped onto a drawn (untilted) plate. */
  const onPlate = (p, src, x, y) => ({ x: p.x + (x - src.x) * p.scale, y: p.y + (y - src.y) * p.scale });

  /** Full-frame "camera" over a capture: shows `view` (CSS px) filling dst. */
  function camera(ctx, img, dpr, view, dst = { x: 0, y: 0, w: W, h: H }, alpha = 1) {
    if (!img) return;
    const s = Math.max(dst.w / view.w, dst.h / view.h);
    const vw = dst.w / s, vh = dst.h / s;
    const vx = view.x + (view.w - vw) / 2, vy = view.y + (view.h - vh) / 2;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.rect(dst.x, dst.y, dst.w, dst.h);
    ctx.clip();
    ctx.drawImage(img, vx * dpr, vy * dpr, vw * dpr, vh * dpr, dst.x, dst.y, dst.w, dst.h);
    ctx.restore();
    return { s, vx, vy, map: (x, y) => ({ x: dst.x + (x - vx) * s, y: dst.y + (y - vy) * s }) };
  }

  // ---------------------------------------------------------------- overlays
  function tick(ctx, x, y, r, k) {
    if (k <= 0.001) return;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(k, k);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = C.mintDeep;
    ctx.fill();
    ctx.strokeStyle = C.mint;
    ctx.lineWidth = r * 0.22;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    const p = clamp(k * 1.2);
    ctx.moveTo(-r * 0.42, r * 0.04);
    if (p < 0.5) ctx.lineTo(lerp(-r * 0.42, -r * 0.12, p * 2), lerp(r * 0.04, r * 0.34, p * 2));
    else {
      ctx.lineTo(-r * 0.12, r * 0.34);
      ctx.lineTo(lerp(-r * 0.12, r * 0.46, (p - 0.5) * 2), lerp(r * 0.34, -r * 0.32, (p - 0.5) * 2));
    }
    ctx.stroke();
    ctx.restore();
  }
  function cross(ctx, x, y, r, k) {
    if (k <= 0.001) return;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(k, k);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = C.roseDeep;
    ctx.fill();
    ctx.strokeStyle = C.rose;
    ctx.lineWidth = r * 0.22;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-r * 0.35, -r * 0.35);
    ctx.lineTo(r * 0.35, r * 0.35);
    ctx.moveTo(r * 0.35, -r * 0.35);
    ctx.lineTo(-r * 0.35, r * 0.35);
    ctx.stroke();
    ctx.restore();
  }
  /** A ring that draws itself around a rect, then breathes. */
  function ring(ctx, r, k, t, color = C.honey) {
    if (k <= 0.001) return;
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 22;
    ctx.strokeStyle = color;
    ctx.globalAlpha = clamp(k) * (0.8 + 0.2 * Math.sin(t * 6));
    ctx.lineWidth = 4;
    const p = 8;
    rrect(ctx, r.x - p, r.y - p, r.w + 2 * p, r.h + 2 * p, Math.min(26, (r.h + 2 * p) / 2));
    const per = 2 * (r.w + r.h) + 8 * p;
    ctx.setLineDash([per * clamp(k), per]);
    ctx.stroke();
    ctx.restore();
  }

  // ---------------------------------------------------------------- brand marks
  function logo(ctx, x, y, size, k = 1, inner = 1) {
    if (k <= 0.001) return;
    ctx.save();
    ctx.translate(x, y);
    const r = size / 2;
    ctx.lineWidth = size * 0.075;
    ctx.strokeStyle = C.honey;
    ctx.lineJoin = 'round';
    hexPath(ctx, 0, 0, r * 0.92);
    ctx.setLineDash([size * 6 * clamp(k), size * 6]);
    ctx.stroke();
    ctx.setLineDash([]);
    if (inner > 0.001) {
      ctx.scale(inner, inner);
      hexPath(ctx, 0, 0, r * 0.42);
      ctx.fillStyle = C.honey;
      ctx.fill();
    }
    ctx.restore();
  }
  function honeyHex(ctx, x, y, r, { fillc = C.honey, k = 1, glow = 0, label, labelColor = C.night, size, rot = 0 } = {}) {
    if (k <= 0.001) return;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.scale(k, k);
    if (glow) {
      ctx.shadowColor = `rgba(245,184,46,${0.7 * glow})`;
      ctx.shadowBlur = 50 * glow;
    }
    hexPath(ctx, 0, 0, r);
    ctx.fillStyle = fillc;
    ctx.fill();
    ctx.shadowBlur = 0;
    if (label) {
      ctx.font = font(size ?? r * 0.4, 700, DISPLAY);
      ctx.fillStyle = labelColor;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, 0, 0);
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- kinetic captions
  const KEY = new Set(['guild', 'near', 'safety', 'money', 'paid', 'anyone', 'swarm', 'fuel', 'turned', 'away', 'back', 'approve', 'receipt', 'crew', 'down', 'private', 'everyone', 'demo', 'live', 'backed', 'earn', 'yes', 'job', 'agent', 'agents', 'budget', 'check', 'scams']);
  const clean = (w) => w.toLowerCase().replace(/[^a-z]/g, '');

  /** The narration line under way at time t; each word rises into place as it is said. */
  function captions(ctx, t, cues, o) {
    const hold = o.hold ?? 0.45;
    const line = cues.find((c) => t >= c.start - 0.15 && t <= c.end + hold);
    if (!line) return;
    const size = o.size, f = font(size, o.weight ?? 600, o.family ?? DISPLAY);
    ctx.font = f;
    const space = ctx.measureText(' ').width;
    const rows = [[]];
    let rowW = 0;
    for (const wd of line.words) {
      const ww = ctx.measureText(wd.w).width;
      if (rowW + ww > o.maxW && rows[rows.length - 1].length) {
        rows.push([]);
        rowW = 0;
      }
      rows[rows.length - 1].push({ ...wd, ww });
      rowW += ww + space;
    }
    const lineH = o.lineH ?? size * 1.14;
    const out = clamp((t - line.end - hold + 0.3) / 0.3);
    const y0 = o.anchor === 'bottom' ? o.y - (rows.length - 1) * lineH : o.y;
    if (o.plate) {
      const tw = Math.max(...rows.map((r) => r.reduce((s, w) => s + w.ww + space, -space)));
      const bx = o.align === 'center' ? o.x - tw / 2 : o.x;
      ctx.save();
      ctx.globalAlpha = (1 - out) * clamp((t - line.start + 0.15) / 0.2);
      rrect(ctx, bx - size * 0.6, y0 - size * 1.02, tw + size * 1.2, rows.length * lineH + size * 0.5, size * 0.42);
      ctx.fillStyle = 'rgba(10,11,15,0.82)';
      ctx.fill();
      ctx.restore();
    }
    rows.forEach((row, ri) => {
      const rw = row.reduce((s, w) => s + w.ww + space, -space);
      let x = o.align === 'center' ? o.x - rw / 2 : o.x;
      const y = y0 + ri * lineH;
      for (const wd of row) {
        const k = spring(t - wd.t + 0.08, SPRING.snappy);
        if (k > 0.001) {
          const key = KEY.has(clean(wd.w));
          ctx.save();
          ctx.globalAlpha = clamp(k * 1.5) * (1 - out);
          ctx.font = f;
          ctx.fillStyle = key ? o.keyColor ?? C.honey : o.color ?? C.paper;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'alphabetic';
          ctx.fillText(wd.w, x, y + (1 - k) * size * 0.5 - out * size * 0.35);
          ctx.restore();
        }
        x += wd.ww + space;
      }
    });
  }

  /** Vignette + film grain, after motion blur. */
  function grain(ctx, t) {
    const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.78);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.42)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);
    const seed = Math.floor(t * 30);
    ctx.save();
    ctx.globalAlpha = 0.045;
    for (let i = 0; i < 700; i++) {
      ctx.fillStyle = hash01(i + 3, seed) > 0.5 ? '#fff' : '#000';
      ctx.fillRect(hash01(i, seed) * W, hash01(i + 7, seed) * H, 2, 2);
    }
    ctx.restore();
  }

  return { maps, loadMaps, loadCues, box, rowsIn, pad, bg, hexPath, plate, onPlate, camera, tick, cross, ring, logo, honeyHex, captions, grain };
}
