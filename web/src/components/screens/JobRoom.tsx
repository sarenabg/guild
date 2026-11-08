"use client";

import { useApi, useMode, useTo } from "@/components/mode";
import { useWallet } from "@/components/wallet";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { jobView } from "@/lib/actions";
import type { Agent, Phase, Verdict, WorkStep } from "@/lib/types";
import { Card, ChainMark, Checks, Glyph, Hex, Honeycomb, Loading, Markdown, Near, Spinner, StatusChip, Tick, ago, btn, post, useJson, type HexState } from "@/components/ui";
import { fmtNear } from "@/lib/money";
import { SKILL_LABEL, TOOL_LABEL } from "@/lib/samples";

type V = NonNullable<ReturnType<typeof jobView>>;

const STEPS: { label: string; phases: Phase[] }[] = [
  { label: "Safety check", phases: ["reviewing"] },
  { label: "Offers", phases: ["bidding", "crewing"] },
  { label: "Work", phases: ["working"] },
  { label: "Final check", phases: ["checking"] },
  { label: "Paid", phases: ["waiting", "done"] },
];

export default function JobRoom({ id }: { id: string }) {
  const api = useApi();
  const [fast, setFast] = useState(true);
  const { data: v, error, reload } = useJson<V>(api(`/jobs/${id}`), fast ? 900 : 4000);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (v) setFast(!["done", "refunded", "rejected"].includes(v.job.phase));
  }, [v]);

  if (!v) return <Loading error={error} />;
  const { job, agents } = v;
  const stepIdx = STEPS.findIndex((s) => s.phases.includes(job.phase));
  const turnedDown = job.phase === "rejected";

  return (
    <div className="flex flex-col gap-6 pt-8">
      <header className="flex flex-wrap items-end gap-4">
        <div className="min-w-0 flex-1">
          <div className="font-mono text-xs text-faint">job #{job.id}</div>
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight sm:text-3xl">{job.title}</h1>
        </div>
        <div className="flex items-center gap-4">
          <StatusChip status={job.status} />
          <div className="text-right">
            <div className="text-xs text-muted">{["Paid", "Split"].includes(job.status) ? "Paid out" : ["Refunded", "Rejected", "ReviewTimedOut"].includes(job.status) ? "Returned" : "Held safely"}</div>
            <div className="font-display text-2xl font-semibold text-honey">
              <Near y={job.budget} />
            </div>
          </div>
        </div>
      </header>

      {!turnedDown && <Stepper current={stepIdx} done={job.phase === "done"} />}

      {turnedDown ? (
        <TurnedDown verdict={job.review} budget={job.budget} />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.55fr_1fr]">
          <div className="flex min-w-0 flex-col gap-6">
            {job.phase === "reviewing" && (
              <Card className="flex flex-col gap-5" label="Safety check">
                <div className="flex items-center gap-3">
                  <Spinner size={22} />
                  <h2 className="font-display text-xl font-semibold">Safety check</h2>
                </div>
                <Checks checks={null} pending names={["Allowed", "Clear", "Fair price", "No private data"]} />
                <p className="text-sm text-muted">The money is locked. The contract is waiting for the reviewer&apos;s answer.</p>
              </Card>
            )}

            {job.phase !== "reviewing" && <Crew v={v} />}

            {job.steps.length > 0 && (
              <Card label="Work">
                <h2 className="mb-5 font-display text-lg font-semibold">Work</h2>
                <ol className="flex flex-col gap-6">
                  {job.steps.map((s, i) => (
                    <StepView key={i} step={s} agent={agents[s.agent]} />
                  ))}
                </ol>
              </Card>
            )}

            {job.result && ["checking", "waiting", "done", "disputed"].includes(job.phase) && (
              <Result v={v} now={now} onDone={reload} />
            )}
          </div>

          <aside className="flex min-w-0 flex-col gap-6">
            {job.payouts.length > 0 && <Payouts v={v} />}
            {job.review && <VerdictCard title="Safety check" verdict={job.review} />}
            {job.result_check && <VerdictCard title="Final check" verdict={job.result_check} />}
            {job.bids.length > 0 && <Offers v={v} />}
            <Brief brief={job.brief} />
            {v.txs.length > 0 && <Ledger txs={v.txs} />}
          </aside>
        </div>
      )}
    </div>
  );
}

function Stepper({ current, done }: { current: number; done: boolean }) {
  return (
    <ol className="grid grid-cols-5 gap-2" aria-label="Progress">
      {STEPS.map((s, i) => {
        const state = done || i < current ? "done" : i === current ? "now" : "next";
        return (
          <li key={s.label} className="flex flex-col gap-2">
            <div className={`h-1.5 rounded-full transition-colors duration-500 ${state === "done" ? "bg-honey" : state === "now" ? "bg-honey/60 animate-pulse" : "bg-edge"}`} />
            <span className={`text-xs font-medium sm:text-sm ${state === "next" ? "text-ghost" : state === "now" ? "text-honey" : "text-soft"}`}>{s.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

function TurnedDown({ verdict, budget }: { verdict: Verdict | null; budget: string }) {
  const to = useTo();
  return (
    <Card className="flex flex-col gap-5 border-rose-deep" label="Turned down">
      <div className="flex items-center gap-3">
        <Tick ok={false} size={28} />
        <h2 className="font-display text-2xl font-semibold">Turned down</h2>
      </div>
      {verdict ? (
        <>
          <p className="text-lg text-soft">{verdict.summary}</p>
          <Checks checks={verdict.checks} names={[]} />
        </>
      ) : (
        <p className="text-soft">The reviewer didn&apos;t answer in time.</p>
      )}
      <div className="flex flex-wrap items-center gap-4 border-t border-edge pt-5">
        <span className="flex-1 text-mint-soft">
          <Near y={budget} /> sent back to you
        </span>
        <Link href={to("/post")} className={btn.ghost}>
          Post another job
        </Link>
      </div>
    </Card>
  );
}

function Crew({ v }: { v: V }) {
  const to = useTo();
  const { job, agents } = v;
  const working = job.steps.find((s) => !s.ended_at)?.agent;
  const finished = new Set(job.steps.filter((s) => s.ended_at).map((s) => s.agent));
  const crewIds = job.crew.map((c) => c.agent);
  const others = job.bids.map((b) => b.agent).filter((a) => !crewIds.includes(a));
  const ids = crewIds.length ? [...crewIds, ...others] : others;
  const state = (a: string): HexState => {
    if (a === working) return "working";
    if (crewIds.includes(a)) return job.phase === "done" || finished.has(a) ? "done" : "crew";
    return crewIds.length ? "dim" : "idle";
  };
  return (
    <Card className="overflow-hidden bg-[radial-gradient(circle_at_50%_40%,#1b1710_0%,#101116_70%)]" label="Crew">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold">{crewIds.length ? "Crew" : "Offers coming in"}</h2>
        {job.phase === "bidding" && <Spinner />}
      </div>
      {ids.length === 0 ? (
        <div className="py-10 text-center text-muted">Waiting for agents…</div>
      ) : (
        <div className="py-2">
          <Honeycomb size={84} perRow={3}>
            {ids.map((a) =>
              agents[a] ? (
                <Link key={a} href={to(`/agents/${a}`)} className="rise" aria-label={agents[a].name}>
                  <Hex agent={agents[a]} size={84} state={state(a)} sub={a === working ? "working" : crewIds.includes(a) ? SKILL_LABEL[agents[a].skill].toLowerCase() : undefined} />
                </Link>
              ) : null,
            )}
          </Honeycomb>
        </div>
      )}
    </Card>
  );
}

function StepView({ step, agent }: { step: WorkStep; agent?: Agent }) {
  const [open, setOpen] = useState(false);
  if (!agent) return null;
  const typing = !step.ended_at;
  const failed = step.receipt === "failed";
  return (
    <li className="rise flex gap-3">
      <Hex agent={agent} size={36} label={false} state={typing ? "working" : "done"} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className="font-semibold text-paper">{agent.name}</span>
          <span className="text-faint">{SKILL_LABEL[agent.skill]}</span>
          {typing && <span className="text-honey">· working…</span>}
          {step.tools.map((t, i) => (
            <button key={i} type="button" onClick={() => setOpen(!open)} className="rounded-full bg-cell-2 px-2 py-0.5 text-xs text-soft hover:bg-edge-2" aria-expanded={open}>
              {TOOL_LABEL[t.tool] ?? t.tool}
            </button>
          ))}
        </div>
        {open && step.tools.length > 0 && (
          <div className="mt-2 flex flex-col gap-2 rounded-2xl border border-edge bg-night/60 p-3 text-xs">
            {step.tools.map((t, i) => (
              <div key={i}>
                <div className="text-faint">
                  {TOOL_LABEL[t.tool] ?? t.tool} · <span className="font-mono">{t.input}</span>
                </div>
                <pre className="mt-1 whitespace-pre-wrap font-mono text-soft">{t.output}</pre>
              </div>
            ))}
          </div>
        )}
        <div className="mt-2 rounded-2xl rounded-tl-md bg-cell px-4 py-3">
          {failed ? (
            <p className="text-sm text-rose-soft">Couldn&apos;t finish this part.</p>
          ) : step.text ? (
            <Markdown text={step.text} typing={typing} />
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted">
              <Spinner /> Thinking…
            </div>
          )}
        </div>
        {step.ended_at && !failed && (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-faint">
            <span className="flex items-center gap-1 text-honey/90">
              <Bolt /> {fmtNear(step.cost)} NEAR
            </span>
            <span>{step.tokens.toLocaleString()} tokens</span>
            <span className="font-mono" title="NEAR AI receipt">
              {step.receipt.slice(0, 20)}
            </span>
            {step.verified && (
              <span className="flex items-center gap-1 text-mint-soft" title={`Signed by ${step.verified.signer}`}>
                <Tick ok size={12} /> TEE-signed
              </span>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

function Bolt() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M13 2L4 14h7l-1 8 9-12h-7z" fill="currentColor" />
    </svg>
  );
}

function Result({ v, now, onDone }: { v: V; now: number; onDone: () => void }) {
  const { job } = v;
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const live = useMode() === "live";
  const wallet = useWallet();
  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(action);
    setErr(null);
    if (live) {
      try {
        if (action === "resolve") await wallet.call("resolve", { job_id: job.id, crew_bps: extra.crewBps }, { tgas: 150 });
        else await wallet.call(action === "cancel" ? "cancel_job" : action, { job_id: job.id }, { tgas: 150 });
      } catch (e) {
        setErr((e as Error).message);
      }
    } else {
      const r = await post(`/api/jobs/${job.id}`, { action, ...extra });
      if (!r.ok) setErr(String(r.data.error ?? "Failed"));
    }
    setBusy(null);
    onDone();
  };
  const council = live ? v.council === wallet.account : true;
  const left = job.release_at_ms ? Math.max(0, Math.ceil((job.release_at_ms - now) / 1000)) : null;
  const yours = job.poster === v.you;
  return (
    <Card className="border-honey/30" label="Result">
      <div className="mb-4 flex items-center gap-2">
        <Glyph name="spark" className="text-honey" />
        <h2 className="font-display text-lg font-semibold">The result</h2>
        <div className="flex-1" />
        {job.phase === "checking" && (
          <span className="flex items-center gap-2 text-sm text-muted">
            <Spinner /> Final check
          </span>
        )}
      </div>
      <div className="rounded-2xl bg-night/60 p-5">
        <Markdown text={job.result ?? ""} />
      </div>
      {job.phase === "waiting" && job.status === "Delivered" && (
        <div className="mt-5 flex flex-col gap-3 border-t border-edge pt-5 sm:flex-row sm:items-center">
          <p className="flex-1 text-sm text-muted">
            {left !== null ? (
              <>
                Pays out by itself in <span className="font-mono text-paper">{Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}</span>
              </>
            ) : (
              "Didn't pass the final check. You decide."
            )}
          </p>
          {yours && (
            <div className="flex gap-2">
              <button className={btn.ghost} disabled={!!busy || (left !== null && left === 0)} onClick={() => act("dispute")}>
                Dispute
              </button>
              <button className={btn.honey} disabled={!!busy} onClick={() => act("approve")}>
                {busy === "approve" ? "Paying…" : "Approve & pay"}
              </button>
            </div>
          )}
        </div>
      )}
      {job.phase === "disputed" && (
        <div className="mt-5 flex flex-col gap-3 border-t border-edge pt-5">
          <p className="text-sm text-soft">Disputed. The council decides how the money is split.</p>
          {council && <div className="flex flex-wrap gap-2">
            <span className="self-center text-xs text-faint">{live ? "You are the council" : "Demo: act as the council"}</span>
            <button className={btn.quiet} disabled={!!busy} onClick={() => act("resolve", { crewBps: 0 })}>
              Refund all
            </button>
            <button className={btn.quiet} disabled={!!busy} onClick={() => act("resolve", { crewBps: 5000 })}>
              Split 50/50
            </button>
            <button className={btn.quiet} disabled={!!busy} onClick={() => act("resolve", { crewBps: 10000 })}>
              Pay the crew
            </button>
          </div>}
        </div>
      )}
      {err && <p className="mt-3 text-sm text-rose-soft">{err}</p>}
    </Card>
  );
}

function VerdictCard({ title, verdict }: { title: string; verdict: Verdict }) {
  return (
    <Card label={title}>
      <div className="mb-4 flex items-center gap-2.5">
        <Tick ok={verdict.approved} size={22} />
        <h2 className="font-display text-lg font-semibold">{title}</h2>
      </div>
      <Checks checks={verdict.checks} names={[]} />
      <p className="mt-4 text-sm text-muted">{verdict.summary}</p>
      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-faint">
        <span className="rounded-full bg-cell-2 px-2 py-1">{verdict.by === "rules" ? "Safety rules" : verdict.by === "ai" ? "NEAR AI reviewer" : "Rules + demo AI"}</span>
        {verdict.verified && (
          <span className="flex items-center gap-1 rounded-full bg-mint-deep px-2 py-1 text-mint-soft" title={verdict.verified.signer}>
            <Tick ok size={12} /> TEE-signed
          </span>
        )}
        <span className="font-mono">{verdict.receipt.slice(0, 22)}</span>
      </div>
    </Card>
  );
}

function Offers({ v }: { v: V }) {
  const { job, agents } = v;
  const crew = new Set(job.crew.map((c) => c.agent));
  return (
    <Card label="Offers">
      <h2 className="mb-4 font-display text-lg font-semibold">Offers</h2>
      <ul className="flex flex-col gap-3">
        {job.bids.map((b) => {
          const a = agents[b.agent];
          if (!a) return null;
          const m = job.crew.find((c) => c.agent === b.agent);
          return (
            <li key={b.agent} className={`rise flex items-center gap-3 ${crew.size && !crew.has(b.agent) ? "opacity-45" : ""}`}>
              <Hex agent={a} size={34} label={false} state={crew.has(b.agent) ? "crew" : "idle"} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-semibold">{a.name}</span>
                  {m && <span className="rounded-full bg-honey-deep px-2 py-0.5 text-[11px] font-semibold text-honey">{m.share_bps / 100}%</span>}
                </div>
                <div className="truncate text-xs text-muted">{b.pitch}</div>
              </div>
              <div className="w-14">
                <div className="h-1 rounded-full bg-edge">
                  <div className="h-1 rounded-full bg-sky" style={{ width: `${b.fit}%` }} />
                </div>
                <div className="mt-1 text-right text-[11px] text-faint">{b.fit}% fit</div>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function Payouts({ v }: { v: V }) {
  const { job, agents } = v;
  return (
    <Card label="Paid out">
      <h2 className="mb-4 font-display text-lg font-semibold">Paid out</h2>
      <ul className="flex flex-col gap-4">
        {job.payouts.map((p) => {
          const a = agents[p.agent];
          return (
            <li key={p.agent} className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className="font-semibold">{a?.name}</span>
                <Near y={p.pay} className="text-honey" />
              </div>
              <div className="flex h-2 overflow-hidden rounded-full bg-edge">
                <div className="bg-honey" style={{ width: pct(p.refuel, p.pay) }} title="Back into fuel" />
                <div className="bg-paper/80" style={{ width: pct(p.creator, p.pay) }} title="Creator" />
                <div className="bg-mint" style={{ width: pct(p.funders, p.pay) }} title="Funders" />
              </div>
            </li>
          );
        })}
      </ul>
      <div className="mt-4 flex flex-wrap gap-4 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-honey" /> Fuel
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-paper/80" /> Creator
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-mint" /> Funders
        </span>
      </div>
    </Card>
  );
}

function pct(part: string, whole: string): string {
  const w = BigInt(whole || "0");
  if (w === 0n) return "0%";
  return `${Number((BigInt(part) * 10000n) / w) / 100}%`;
}

function Brief({ brief }: { brief: string }) {
  return (
    <Card label="Brief">
      <h2 className="mb-2 font-display text-lg font-semibold">Brief</h2>
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-soft">{brief}</p>
    </Card>
  );
}

function Ledger({ txs }: { txs: V["txs"] }) {
  return (
    <Card label="On the ledger">
      <h2 className="mb-3 font-display text-lg font-semibold">On the ledger</h2>
      <ul className="flex flex-col gap-2.5 text-xs">
        {txs.map((t) => (
          <li key={t.hash} className="flex gap-2">
            <span className="w-24 shrink-0 font-mono text-honey/80">{t.method}</span>
            <span className="min-w-0 flex-1 text-soft">{t.summary}</span>
            <ChainMark tx={t} />
            <span className="shrink-0 text-ghost">{ago(t.at)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
