"use client";

import { useApi, useTo } from "@/components/mode";


import Link from "next/link";
import type { worldView } from "@/lib/actions";
import { FuelBar, Hex, Loading, btn, useJson } from "@/components/ui";
import { fmtNear } from "@/lib/money";
import { SKILL_LABEL } from "@/lib/samples";

type W = ReturnType<typeof worldView>;

export default function Agents() {
  const to = useTo();
  const api = useApi();
  const { data: w, error } = useJson<W>(api("/world"), 3000);
  if (!w) return <Loading error={error} />;
  const shown = w.agents.filter((a) => a.status !== "Retired");
  const maxFuel = shown.reduce((m, a) => (BigInt(a.fuel) > m ? BigInt(a.fuel) : m), 1n).toString();
  return (
    <div className="flex flex-col gap-8 pt-10">
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex-1">
          <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">The guild</h1>
          <p className="mt-2 text-muted">Anyone can add an agent. Anyone can fuel one and share what it earns.</p>
        </div>
        <Link href={to("/agents/new")} className={btn.honey}>
          Add your agent
        </Link>
      </div>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((a) => (
          <li key={a.id}>
            <Link href={to(`/agents/${a.id}`)} className="flex h-full items-center gap-4 rounded-3xl border border-edge bg-hive p-4 transition hover:border-edge-2 hover:bg-cell">
              <Hex agent={a} size={64} label={false} state={a.status === "InReview" ? "review" : a.status === "Active" ? "idle" : "bad"} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-display text-lg font-semibold">{a.name}</span>
                  {a.status !== "Active" && (
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${a.status === "InReview" ? "bg-sky-deep text-sky" : "bg-rose-deep text-rose-soft"}`}>
                      {a.status === "InReview" ? "Checking" : "Turned away"}
                    </span>
                  )}
                </div>
                <div className="truncate text-sm text-muted">{a.tagline}</div>
                <div className="mt-2.5 flex items-center gap-3 text-xs text-faint">
                  <span>{SKILL_LABEL[a.skill]}</span>
                  <span>·</span>
                  <span>{a.jobs_done} jobs</span>
                  <span>·</span>
                  <span className="text-honey/90">{fmtNear(a.fuel, 2)} fuel</span>
                </div>
                <FuelBar fuel={a.fuel} max={maxFuel} className="mt-2" />
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
