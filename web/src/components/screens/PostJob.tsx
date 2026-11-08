"use client";

import { useMode, useTo } from "@/components/mode";
import { useWallet, yocto } from "@/components/wallet";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SAMPLE_JOBS } from "@/lib/samples";
import { Card, btn, field, post } from "@/components/ui";

const DEADLINES = [
  { hours: 1, label: "1 hour" },
  { hours: 24, label: "1 day" },
  { hours: 72, label: "3 days" },
];

export default function PostJob() {
  const to = useTo();
  const mode = useMode();
  const wallet = useWallet();
  const live = mode === "live";
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [budget, setBudget] = useState(live ? 0.5 : 5);
  const [hours, setHours] = useState(24);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    if (live) {
      try {
        // Budget plus a little for storing the job on-chain (unused storage stays with the job).
        const r = await wallet.call(
          "post_job",
          { title: title.trim(), brief: brief.trim(), deadline_ns: (Date.now() + hours * 3_600_000) * 1_000_000 },
          { deposit: yocto(budget + 0.06), tgas: 150 },
        );
        router.push(to(typeof r.value === "number" ? `/jobs/${r.value}` : "/"));
      } catch (err) {
        setError((err as Error).message);
        setBusy(false);
      }
      return;
    }
    const { ok, data } = await post("/api/jobs", { title, brief, budget, hours });
    if (ok) router.push(to(`/jobs/${data.id}`));
    else {
      setError(String(data.error ?? "Couldn't post the job"));
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 pt-10">
      <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">Post a job</h1>

      <div className="flex flex-wrap gap-2" aria-label="Examples">
        {SAMPLE_JOBS.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => {
              setTitle(s.title);
              setBrief(s.brief);
              setBudget(live ? Math.min(s.budget / 10, 2) : s.budget);
            }}
            className={`min-h-10 rounded-full border px-3.5 text-sm transition ${s.bad ? "border-rose-deep text-rose-soft hover:border-rose" : "border-edge-2 text-soft hover:border-faint hover:text-paper"}`}
          >
            {s.bad ? "Try a bad one" : s.title}
          </button>
        ))}
      </div>

      <form onSubmit={submit}>
        <Card className="flex flex-col gap-5">
          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium text-muted">Title</span>
            <input className={field} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} required placeholder="e.g. Beginner's guide to 3 NEAR wallets" />
          </label>
          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium text-muted">What you need</span>
            <textarea className={`${field} min-h-36 resize-y leading-relaxed`} value={brief} onChange={(e) => setBrief(e.target.value)} maxLength={2000} required placeholder="Describe the work in a few sentences." />
          </label>

          <div className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-medium text-muted" id="budget-label">
                Budget
              </span>
              <span className="font-display text-2xl font-semibold text-honey">{budget} NEAR</span>
            </div>
            <input
              type="range"
              min={live ? 0.2 : 0.5}
              max={live ? 20 : 50}
              step={live ? 0.1 : 0.5}
              value={budget}
              onChange={(e) => setBudget(Number(e.target.value))}
              aria-labelledby="budget-label"
              className="w-full accent-[var(--color-honey)]"
            />
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium text-muted">Done within</legend>
            <div className="flex gap-2">
              {DEADLINES.map((d) => (
                <button
                  key={d.hours}
                  type="button"
                  onClick={() => setHours(d.hours)}
                  aria-pressed={hours === d.hours}
                  className={`min-h-10 flex-1 rounded-full text-sm font-semibold transition ${hours === d.hours ? "bg-paper text-night" : "bg-cell-2 text-soft hover:bg-edge-2"}`}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </fieldset>

          {error && <p className="rounded-2xl bg-rose-deep px-4 py-3 text-sm text-rose-soft">{error}</p>}

          <div className="flex flex-col gap-3 border-t border-edge pt-5 sm:flex-row sm:items-center">
            <p className="flex-1 text-sm text-muted">
              {live ? "Real NEAR, held by the contract. Back to you if it\u2019s turned down." : "Held safely until the work is done. Refunded if it\u2019s turned down."}
            </p>
            {live && !wallet.account ? (
              <button type="button" className={btn.honey} onClick={wallet.connect}>
                Connect wallet
              </button>
            ) : (
              <button className={btn.honey} disabled={busy || !title.trim() || !brief.trim()}>
                {busy ? (live ? "Confirm in your wallet…" : "Posting…") : live ? `Confirm in wallet · ${budget} NEAR` : `Post · ${budget} NEAR`}
              </button>
            )}
          </div>
        </Card>
      </form>
    </div>
  );
}
