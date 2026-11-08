"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { Agent, Check, Glyph as GlyphName, JobStatus } from "@/lib/types";
import { fmtNear } from "@/lib/money";

// ----- Data -----------------------------------------------------------------

/** Fetch JSON and refresh it every `every` ms while the tab is open. */
export function useJson<T>(url: string, every = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  const load = useCallback(async () => {
    try {
      const res = await fetch(url, { cache: "no-store" });
      const body = await res.json();
      if (!alive.current) return;
      if (!res.ok) setError(body.error ?? "Something went wrong");
      else {
        setData(body as T);
        setError(null);
      }
    } catch {
      if (alive.current) setError("Can't reach the server");
    }
  }, [url]);
  useEffect(() => {
    alive.current = true;
    load();
    if (!every) return () => void (alive.current = false);
    const t = setInterval(() => document.visibilityState === "visible" && load(), every);
    return () => {
      alive.current = false;
      clearInterval(t);
    };
  }, [load, every]);
  return { data, error, reload: load };
}

export async function post(url: string, body: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

export function ago(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 10) return "now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

// ----- Glyphs and hexagons --------------------------------------------------

const PATHS: Record<GlyphName, ReactNode> = {
  eye: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  pen: (
    <>
      <path d="M4 20l4-1 11-11-3-3L5 16z" />
      <path d="M14 6l3 3" />
    </>
  ),
  lens: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="M20 20l-4.5-4.5" />
    </>
  ),
  spark: <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6" />,
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18" />
    </>
  ),
  chart: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  shield: <path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z" />,
  code: <path d="M8 7l-5 5 5 5M16 7l5 5-5 5" />,
  leaf: <path d="M5 19c0-9 6-14 15-14 0 9-5 15-14 15M5 19l7-7" />,
};

export function Glyph({ name, size = 20, className = "" }: { name: GlyphName; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {PATHS[name] ?? PATHS.spark}
    </svg>
  );
}

export type HexState = "idle" | "crew" | "working" | "done" | "dim" | "review" | "bad";

/** An agent as a hexagon cell. */
export function Hex({
  agent,
  size = 96,
  state = "idle",
  label = true,
  sub,
}: {
  agent: Pick<Agent, "name" | "hue" | "glyph">;
  size?: number;
  state?: HexState;
  label?: boolean;
  sub?: string;
}) {
  const h = agent.hue;
  const bg =
    state === "working"
      ? "var(--color-honey)"
      : state === "crew" || state === "done"
        ? "var(--color-honey-deep)"
        : state === "bad"
          ? "var(--color-rose-deep)"
          : state === "dim"
            ? "var(--color-cell)"
            : `hsl(${h} 35% 13%)`;
  const fg =
    state === "working"
      ? "var(--color-night)"
      : state === "crew" || state === "done"
        ? "var(--color-honey)"
        : state === "bad"
          ? "var(--color-rose)"
          : state === "dim"
            ? "var(--color-ghost)"
            : `hsl(${h} 80% 68%)`;
  return (
    <div className={`relative shrink-0 ${state === "working" ? "working" : ""}`} style={{ width: size, height: size * 1.12 }}>
      <div
        className={`hex flex h-full w-full flex-col items-center justify-center gap-1 transition-colors duration-500 ${state === "review" ? "animate-pulse" : ""}`}
        style={{ background: bg, color: fg }}
      >
        <Glyph name={agent.glyph} size={Math.round(size * 0.24)} />
        {label && size >= 72 && (
          <span className="max-w-[80%] truncate font-display text-[13px] font-semibold leading-none" style={{ color: state === "working" ? "var(--color-night)" : undefined }}>
            {agent.name}
          </span>
        )}
        {sub && size >= 72 && (
          <span className="text-[10.5px] font-medium leading-none opacity-80">{sub}</span>
        )}
      </div>
    </div>
  );
}

/** Lay hexagons out as a honeycomb that wraps to the screen width. */
export function Honeycomb({ children, size = 96, perRow = 5 }: { children: ReactNode[]; size?: number; perRow?: number }) {
  const rows: ReactNode[][] = [];
  let i = 0;
  let r = 0;
  while (i < children.length) {
    const n = r % 2 === 0 ? perRow : perRow - 1;
    rows.push(children.slice(i, i + n));
    i += n;
    r++;
  }
  const gap = Math.round(size * 0.08);
  return (
    <div className="flex flex-col items-center">
      {rows.map((row, k) => (
        <div key={k} className="flex" style={{ gap, marginTop: k === 0 ? 0 : -Math.round(size * 0.26) }}>
          {row}
        </div>
      ))}
    </div>
  );
}

// ----- Small pieces ---------------------------------------------------------

export function Near({ y, digits, className = "" }: { y: string | bigint; digits?: number; className?: string }) {
  return <span className={className}>{fmtNear(y, digits)} NEAR</span>;
}

export function FuelBar({ fuel, max, className = "" }: { fuel: string; max: string; className?: string }) {
  const f = Number(BigInt(fuel || "0") / 10n ** 18n);
  const m = Math.max(1, Number(BigInt(max || "1") / 10n ** 18n));
  const pct = Math.max(2, Math.min(100, (f / m) * 100));
  return (
    <div className={`h-1.5 w-full rounded-full bg-edge ${className}`} role="meter" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Fuel">
      <div className="h-1.5 rounded-full bg-honey transition-all duration-700" style={{ width: `${pct}%` }} />
    </div>
  );
}

const STATUS: Record<JobStatus, { text: string; tone: string }> = {
  InReview: { text: "Checking", tone: "bg-sky-deep text-sky" },
  Open: { text: "Finding crew", tone: "bg-honey-deep text-honey" },
  Working: { text: "Working", tone: "bg-honey-deep text-honey" },
  Delivered: { text: "Ready", tone: "bg-mint-deep text-mint-soft" },
  Disputed: { text: "Disputed", tone: "bg-rose-deep text-rose-soft" },
  Paid: { text: "Paid", tone: "bg-mint-deep text-mint-soft" },
  Refunded: { text: "Refunded", tone: "bg-cell-2 text-muted" },
  Rejected: { text: "Turned down", tone: "bg-rose-deep text-rose-soft" },
  ReviewTimedOut: { text: "Refunded", tone: "bg-cell-2 text-muted" },
  Split: { text: "Settled", tone: "bg-cell-2 text-soft" },
};

export function StatusChip({ status }: { status: JobStatus }) {
  const s = STATUS[status];
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${s.tone}`}>{s.text}</span>;
}

export function Tick({ ok, size = 18 }: { ok: boolean; size?: number }) {
  return ok ? (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-label="Passed" role="img">
      <circle cx="10" cy="10" r="10" fill="var(--color-mint-deep)" />
      <path d="M5.8 10.4l2.8 2.8 5.6-6" stroke="var(--color-mint)" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ) : (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-label="Failed" role="img">
      <circle cx="10" cy="10" r="10" fill="var(--color-rose-deep)" />
      <path d="M7 7l6 6M13 7l-6 6" stroke="var(--color-rose)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="spin" aria-label="Working" role="img">
      <circle cx="12" cy="12" r="9" stroke="var(--color-edge-2)" strokeWidth="3" fill="none" />
      <path d="M12 3a9 9 0 019 9" stroke="var(--color-honey)" strokeWidth="3" fill="none" strokeLinecap="round" />
    </svg>
  );
}

/** The list of safety checks. While `pending`, rows appear one by one. */
export function Checks({ checks, pending, names }: { checks: Check[] | null; pending?: boolean; names: string[] }) {
  const rows: Check[] = checks ?? names.map((name) => ({ name, passed: true }));
  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map((c, i) => (
        <li key={c.name} className="rise flex items-start gap-2.5 text-sm" style={{ animationDelay: `${i * 120}ms` }}>
          <span className="mt-0.5">{pending || !checks ? <Spinner size={18} /> : <Tick ok={c.passed} />}</span>
          <span className="min-w-0">
            <span className={!checks || c.passed ? "text-paper" : "text-rose-soft"}>{c.name}</span>
            {checks && c.note && !c.passed && <span className="block text-[13px] text-muted">{c.note}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function Card({ children, className = "", as: As = "section", label }: { children: ReactNode; className?: string; as?: "section" | "div" | "aside"; label?: string }) {
  return (
    <As aria-label={label} className={`rounded-3xl border border-edge bg-hive p-5 sm:p-6 ${className}`}>
      {children}
    </As>
  );
}

export const btn = {
  honey: "inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-honey px-5 text-sm font-semibold text-night transition hover:bg-honey-hi disabled:cursor-not-allowed disabled:opacity-40",
  ghost: "inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-edge-2 px-5 text-sm font-semibold text-paper transition hover:border-faint disabled:cursor-not-allowed disabled:opacity-40",
  quiet: "inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-cell-2 px-5 text-sm font-semibold text-soft transition hover:bg-edge-2 disabled:cursor-not-allowed disabled:opacity-40",
  danger: "inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-rose-deep bg-rose-deep px-5 text-sm font-semibold text-rose-soft transition hover:border-rose disabled:opacity-40",
};

export const field =
  "w-full rounded-2xl border border-edge-2 bg-cell px-4 py-3 text-[15px] text-paper placeholder:text-ghost outline-none transition focus:border-honey";

// ----- Markdown (safe: builds React elements, never raw HTML) ---------------

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|_[^_]+_)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith("**")) out.push(<strong key={`${key}-${i++}`}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith("`")) out.push(<code key={`${key}-${i++}`}>{t.slice(1, -1)}</code>);
    else out.push(<em key={`${key}-${i++}`}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text, typing = false }: { text: string; typing?: boolean }) {
  const lines = text.replace(/\r/g, "").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const k = `b${i}`;
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith("|")) {
        const cells = lines[i].split("|").slice(1, -1).map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      const [head, ...body] = rows;
      blocks.push(
        <div key={k} className="overflow-x-auto">
          <table>
            <thead>
              <tr>{head?.map((c, j) => <th key={j}>{inline(c, `${k}h${j}`)}</th>)}</tr>
            </thead>
            <tbody>
              {body.map((r, ri) => (
                <tr key={ri}>{r.map((c, j) => <td key={j}>{inline(c, `${k}${ri}${j}`)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (/^[-*•] /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*•] /.test(lines[i])) items.push(lines[i++].slice(2));
      blocks.push(
        <ul key={k}>
          {items.map((it, j) => (
            <li key={j}>{inline(it, `${k}${j}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      blocks.push(h[1].length === 1 ? <h1 key={k}>{inline(h[2], k)}</h1> : <h2 key={k}>{inline(h[2], k)}</h2>);
      i++;
      continue;
    }
    blocks.push(<p key={k}>{inline(line, k)}</p>);
    i++;
  }
  return <div className={`prose-guild ${typing ? "caret" : ""}`}>{blocks}</div>;
}

export function Loading({ error }: { error?: string | null }) {
  return <div className="py-32 text-center text-muted">{error ?? "Loading the hive…"}</div>;
}

/** Link to the real transaction on the explorer (Live version only). */
export function ChainMark({ tx }: { tx: { url?: string } }) {
  if (!tx.url) return null;
  return (
    <a href={tx.url} target="_blank" rel="noreferrer" className="shrink-0 font-semibold text-mint-soft hover:text-mint" title="Open on the NEAR explorer">
      ↗
    </a>
  );
}
