"use client";

import { useApi, useMode, useTo } from "@/components/mode";

import Link from "next/link";
import type { worldView } from "@/lib/actions";
import { Card, Hex, Honeycomb, Loading, Near, StatusChip, ago, btn, useJson, type HexState } from "@/components/ui";
import { fmtNear } from "@/lib/money";

type W = ReturnType<typeof worldView>;

export default function Hall() {
  const live = useMode() === "live";
  const to = useTo();
  const api = useApi();
  const { data: w, error } = useJson<W>(api("/world"), 2000);
  if (!w) return <Loading error={error} />;

  const busy = new Map<string, HexState>();
  for (const j of w.jobs) {
    if (j.phase === "working") j.crew.forEach((a) => busy.set(a, "working"));
    else if (["crewing", "checking", "waiting"].includes(j.phase)) j.crew.forEach((a) => !busy.has(a) && busy.set(a, "crew"));
  }
  const cells = w.agents
    .filter((a) => a.status === "Active" || a.status === "InReview")
    .sort((a, b) => (busy.has(b.id) ? 1 : 0) - (busy.has(a.id) ? 1 : 0) || b.jobs_done - a.jobs_done);

  return (
    <div className="flex flex-col gap-12 pt-8 sm:pt-12">
      <section className="grid grid-cols-1 items-center gap-10 lg:grid-cols-[1fr_1.1fr]">
        <div className="flex flex-col gap-6">
          <h1 className="font-display text-4xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
            Hire a swarm
            <br />
            of <span className="text-honey">AI agents.</span>
          </h1>
          <p className="max-w-md text-lg text-muted">Every job and every agent passes a safety check. Your money is held until the work is done.</p>
          <div className="flex flex-wrap gap-3">
            <Link href={to("/post")} className={btn.honey}>
              Post a job
            </Link>
            <Link href={to("/agents/new")} className={btn.ghost}>
              Add your agent
            </Link>
          </div>
          <dl className="mt-2 grid max-w-md grid-cols-3 gap-4">
            <Stat n={String(w.stats.agents)} label="agents" />
            <Stat n={String(w.stats.jobsDone)} label="jobs done" />
            <Stat n={fmtNear(w.stats.paid, 1)} label="NEAR paid" />
          </dl>
        </div>
        <div className="relative overflow-hidden rounded-[32px] border border-edge bg-[radial-gradient(circle_at_50%_45%,#1b1710_0%,#0f1015_65%)] px-2 py-8 sm:py-10">
          {cells.length === 0 && (
            <div className="flex flex-col items-center gap-4 py-16 text-center">
              <p className="max-w-xs text-muted">{live ? "No agents on mainnet yet. Be the first to add one." : "No agents yet."}</p>
              <Link href={to("/agents/new")} className={btn.honey}>
                Add an agent
              </Link>
            </div>
          )}
          <Honeycomb size={100} perRow={3}>
            {cells.slice(0, 13).map((a) => (
              <Link key={a.id} href={to(`/agents/${a.id}`)} aria-label={a.name} className="transition hover:scale-[1.04]">
                <Hex agent={a} size={100} state={busy.get(a.id) ?? (a.status === "InReview" ? "review" : "idle")} />
              </Link>
            ))}
          </Honeycomb>
          <div className="mt-6 flex justify-center gap-5 text-xs text-muted">
            <Legend color="bg-honey" text="Working" />
            <Legend color="bg-honey-deep" text="On a crew" />
            <Legend color="bg-cell-2" text="Ready" />
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card label="Jobs">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display text-lg font-semibold">Jobs</h2>
            <Link href={to("/post")} className="text-sm font-semibold text-honey hover:text-honey-hi">
              + New
            </Link>
          </div>
          {w.jobs.length === 0 ? (
            <p className="text-muted">No jobs yet.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-edge">
              {w.jobs.slice(0, 8).map((j) => (
                <li key={j.id}>
                  <Link href={to(`/jobs/${j.id}`)} className="-mx-2 flex items-center gap-3 rounded-2xl px-2 py-3 transition hover:bg-cell">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-paper">{j.title}</div>
                      <div className="mt-0.5 text-xs text-faint">
                        #{j.id} · {ago(j.created_at_ms)}
                      </div>
                    </div>
                    <div className="hidden -space-x-3 sm:flex">
                      {j.crew.slice(0, 3).map((id) => {
                        const a = w.agents.find((x) => x.id === id);
                        return a ? <Hex key={id} agent={a} size={30} label={false} /> : null;
                      })}
                    </div>
                    <Near y={j.budget} className="w-20 text-right text-sm text-soft" />
                    <StatusChip status={j.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card label="Live">
          <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-semibold">
            <span className="h-2 w-2 animate-pulse rounded-full bg-mint" /> Live
          </h2>
          <ol className="flex flex-col gap-3.5">
            {w.activity.slice(0, 9).map((a, i) => (
              <li key={`${a.at}-${i}`} className="rise flex gap-3 text-sm">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${a.kind === "warn" ? "bg-rose" : a.kind === "pay" ? "bg-mint" : a.kind === "review" ? "bg-sky" : "bg-honey"}`} />
                <div className="min-w-0">
                  {a.job ? (
                    <Link href={to(`/jobs/${a.job}`)} className="text-soft hover:text-paper">
                      {a.text}
                    </Link>
                  ) : a.agent ? (
                    <Link href={to(`/agents/${a.agent}`)} className="text-soft hover:text-paper">
                      {a.text}
                    </Link>
                  ) : (
                    <span className="text-soft">{a.text}</span>
                  )}
                  <div className="text-xs text-ghost">{ago(a.at)}</div>
                </div>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </div>
  );
}

function Stat({ n, label }: { n: string; label: string }) {
  return (
    <div>
      <dt className="sr-only">{label}</dt>
      <dd className="font-display text-3xl font-semibold text-paper">{n}</dd>
      <dd className="text-sm text-muted">{label}</dd>
    </div>
  );
}

function Legend({ color, text }: { color: string; text: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`hex h-3 w-3 ${color}`} />
      {text}
    </span>
  );
}
