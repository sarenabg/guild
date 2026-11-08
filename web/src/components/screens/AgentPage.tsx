"use client";

import { useApi, useMode, useTo } from "@/components/mode";
import { useWallet, yocto } from "@/components/wallet";

import Link from "next/link";
import { useState } from "react";
import type { agentView } from "@/lib/actions";
import { Card, ChainMark, Checks, FuelBar, Hex, Loading, Near, StatusChip, Tick, ago, btn, post, useJson } from "@/components/ui";
import { fmtNear } from "@/lib/money";
import { SKILL_LABEL, TOOL_LABEL } from "@/lib/samples";

type V = NonNullable<ReturnType<typeof agentView>>;

export default function AgentPage({ id }: { id: string }) {
  const live = useMode() === "live";
  const wallet = useWallet();
  const to = useTo();
  const api = useApi();
  const { data: v, error, reload } = useJson<V>(api(`/agents/${id}`), 1500);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (!v) return <Loading error={error} />;
  const a = v.agent;

  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(action);
    setErr(null);
    if (live) {
      try {
        if (action === "fund") await wallet.call("fund_agent", { agent_id: id }, { deposit: yocto(Number(extra.amount) + 0.0025), tgas: 50 });
        else await wallet.call(action === "claim" ? "claim_earnings" : "retire_agent", { agent_id: id }, { tgas: 100 });
      } catch (e) {
        setErr((e as Error).message);
      }
    } else {
      const r = await post(`/api/agents/${id}`, { action, ...extra });
      if (!r.ok) setErr(String(r.data.error ?? "Failed"));
    }
    setBusy(null);
    reload();
  };

  const reviewing = a.status === "InReview";
  const turnedAway = a.status === "Rejected" || a.status === "ReviewTimedOut";
  const claimable = BigInt(v.funding.claimable);
  const myShare = BigInt(a.total_shares) > 0n ? Number((BigInt(v.funding.shares) * 1000n) / BigInt(a.total_shares)) / 10 : 0;

  return (
    <div className="flex flex-col gap-6 pt-10">
      <header className="flex flex-wrap items-center gap-6">
        <Hex agent={a} size={112} state={reviewing ? "review" : turnedAway ? "bad" : a.status === "Retired" ? "dim" : "idle"} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">{a.name}</h1>
            <span className="rounded-full bg-cell-2 px-2.5 py-1 text-xs font-semibold text-soft">{SKILL_LABEL[a.skill]}</span>
            {v.mine && <span className="rounded-full bg-honey-deep px-2.5 py-1 text-xs font-semibold text-honey">Yours</span>}
          </div>
          <p className="mt-1 text-lg text-muted">{a.tagline}</p>
          <p className="mt-1 font-mono text-xs text-ghost">
            by {a.owner} · {a.id}
          </p>
        </div>
        <dl className="grid grid-cols-3 gap-6 text-right">
          <div>
            <dd className="font-display text-2xl font-semibold">{a.jobs_done}</dd>
            <dt className="text-xs text-muted">jobs</dt>
          </div>
          <div>
            <dd className="font-display text-2xl font-semibold">{fmtNear(a.earned, 2)}</dd>
            <dt className="text-xs text-muted">NEAR earned</dt>
          </div>
          <div>
            <dd className="font-display text-2xl font-semibold">{a.funders}</dd>
            <dt className="text-xs text-muted">funders</dt>
          </div>
        </dl>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.2fr]">
        <div className="flex flex-col gap-6">
          <Card label="Safety check" className={turnedAway ? "border-rose-deep" : ""}>
            <div className="mb-4 flex items-center gap-2.5">
              {reviewing ? null : <Tick ok={!turnedAway} size={22} />}
              <h2 className="font-display text-lg font-semibold">{reviewing ? "Safety check…" : turnedAway ? "Turned away" : "Passed the safety check"}</h2>
            </div>
            <Checks checks={a.review?.checks ?? null} pending={reviewing} names={["Safe purpose", "No hidden commands", "Approved tools", "No private data"]} />
            {a.review && <p className="mt-4 text-sm text-muted">{a.review.summary}</p>}
            {turnedAway && (
              <p className="mt-4 rounded-2xl bg-mint-deep px-4 py-3 text-sm text-mint-soft">
                Its fuel went straight back to {v.mine ? "you" : "its owner"}.
              </p>
            )}
            {a.review && (
              <div className="mt-4 flex flex-wrap gap-2 text-xs text-faint">
                <span className="rounded-full bg-cell-2 px-2 py-1">{a.review.by === "rules" ? "Safety rules" : a.review.by === "ai" ? "NEAR AI reviewer" : "Rules + demo AI"}</span>
                {a.review.verified && (
                  <span className="flex items-center gap-1 rounded-full bg-mint-deep px-2 py-1 text-mint-soft">
                    <Tick ok size={12} /> TEE-signed
                  </span>
                )}
              </div>
            )}
          </Card>

          {!turnedAway && (
            <Card label="Fuel">
              <div className="flex items-baseline justify-between">
                <h2 className="font-display text-lg font-semibold">Fuel</h2>
                <span className="font-display text-2xl font-semibold text-honey">
                  <Near y={a.fuel} digits={3} />
                </span>
              </div>
              <FuelBar fuel={a.fuel} max={a.funded} className="mt-3" />
              <p className="mt-2 text-xs text-faint">
                Up to {fmtNear(a.max_fuel_per_job)} NEAR per job · {a.refuel_bps / 100}% of each payout refuels it
              </p>
              {a.status === "Active" && (
                <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-edge pt-5">
                  <span className="mr-auto text-sm text-soft">{a.busy_jobs > 0 ? "On a job: back it when it's done" : `Back ${a.name}`}</span>
                  {(live ? [0.1, 0.5, 1] : [0.5, 1, 5]).map((n) => (
                    <button key={n} className={btn.quiet} disabled={!!busy || a.busy_jobs > 0} onClick={() => act("fund", { amount: n })}>
                      +{n} NEAR
                    </button>
                  ))}
                </div>
              )}
              <p className="mt-3 text-xs text-muted">Funders share {Math.round((100 - a.creator_bps / 100) * (1 - a.refuel_bps / 10000))}% of what it earns.</p>
            </Card>
          )}

          {BigInt(v.funding.shares) > 0n && (
            <Card label="Your share" className="border-mint-deep">
              <h2 className="font-display text-lg font-semibold">Your share</h2>
              <div className="mt-3 flex items-end justify-between gap-4">
                <div>
                  <div className="font-display text-3xl font-semibold text-mint-soft">
                    <Near y={v.funding.claimable} digits={4} />
                  </div>
                  <div className="text-xs text-muted">ready to claim · you own {myShare}%</div>
                </div>
                <button className={btn.honey} disabled={!!busy || claimable === 0n} onClick={() => act("claim")}>
                  Claim
                </button>
              </div>
            </Card>
          )}
          {err && <p className="rounded-2xl bg-rose-deep px-4 py-3 text-sm text-rose-soft">{err}</p>}
        </div>

        <div className="flex flex-col gap-6">
          <Card label="How it works">
            <h2 className="mb-3 font-display text-lg font-semibold">Instructions</h2>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-soft">{a.spec.instructions}</p>
            {a.spec.knowledge && (
              <details className="mt-4">
                <summary className="cursor-pointer text-sm font-semibold text-honey">Knowledge</summary>
                <p className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap text-sm leading-relaxed text-muted">{a.spec.knowledge}</p>
              </details>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              {a.spec.tools.length ? (
                a.spec.tools.map((t) => (
                  <span key={t} className="rounded-full bg-cell-2 px-3 py-1 text-xs font-semibold text-soft">
                    {TOOL_LABEL[t] ?? t}
                  </span>
                ))
              ) : (
                <span className="text-xs text-faint">No tools</span>
              )}
            </div>
            <div className="mt-4 break-all font-mono text-[11px] text-ghost" title="Fingerprint of the reviewed instructions, knowledge and tools">
              fingerprint {a.spec_hash}
            </div>
          </Card>

          <Card label="Jobs">
            <h2 className="mb-3 font-display text-lg font-semibold">Jobs</h2>
            {v.jobs.length === 0 ? (
              <p className="text-sm text-muted">No jobs yet.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-edge">
                {v.jobs.map((j) => (
                  <li key={j.id}>
                    <Link href={to(`/jobs/${j.id}`)} className="flex items-center gap-3 py-2.5 text-sm hover:text-paper">
                      <span className="min-w-0 flex-1 truncate text-soft">{j.title}</span>
                      {j.pay && <Near y={j.pay} className="text-honey" />}
                      <StatusChip status={j.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {v.txs.length > 0 && (
            <Card label="On the ledger">
              <h2 className="mb-3 font-display text-lg font-semibold">On the ledger</h2>
              <ul className="flex flex-col gap-2 text-xs">
                {v.txs.slice(0, 8).map((t) => (
                  <li key={t.hash} className="flex gap-2">
                    <span className="w-28 shrink-0 font-mono text-honey/80">{t.method}</span>
                    <span className="min-w-0 flex-1 text-soft">{t.summary}</span>
                    <ChainMark tx={t} />
                    <span className="shrink-0 text-ghost">{ago(t.at)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {v.mine && a.status === "Active" && (
            <button className={`${btn.ghost} self-start`} disabled={!!busy || a.busy_jobs > 0} onClick={() => act("retire")}>
              Retire {a.name}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
