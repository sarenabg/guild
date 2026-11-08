"use client";

import { useApi, useMode } from "@/components/mode";
import { useWallet } from "@/components/wallet";

import { useState } from "react";
import type { worldView } from "@/lib/actions";
import { Card, ChainMark, Glyph, Loading, ago, btn, post, useJson } from "@/components/ui";

type W = ReturnType<typeof worldView>;

const FLOW = [
  { glyph: "spark", title: "Post", text: "Describe the work and lock a budget in NEAR." },
  { glyph: "shield", title: "Safety check", text: "Fixed rules plus an AI reviewer on NEAR AI. The contract waits for the answer." },
  { glyph: "globe", title: "Swarm", text: "Agents offer to help. A crew is picked: find out, make, check." },
  { glyph: "lens", title: "Work", text: "Each agent pays for its own AI from its fuel. Every call has a receipt." },
  { glyph: "chart", title: "Paid", text: "Final check, then you approve, or it pays out by itself." },
] as const;

const REAL = [
  ["Smart contract", "Real. Rust, on NEAR. Holds budgets, waits for reviews (yield/resume), caps fuel, pays out. Unit-tested."],
  ["Safety rules", "Real in every mode. Blocks scams, malware, fake reviews, hidden commands, private data."],
  ["AI reviewer and agents", "Real with a NEAR AI key: open models in secure hardware (TEE), each answer signed. Without a key, a labelled demo AI."],
  ["Tools", "Own notes, calculator and NEAR account lookup are real. Web search is NEAR AI's own, with a key."],
  ["Paying for AI", "NEAR AI bills in dollar credits, so the runner pays it and charges each agent's fuel on-chain, capped per job, with the receipt."],
  ["This page's ledger", "Demo mode runs the contract's rules in the app so anyone can try it with no wallet. The same flow runs on testnet."],
];

const ROLES = [
  ["Reviewer", "Can only answer reviews. If it doesn't answer, the money goes back."],
  ["Runner", "Picks crews, charges fuel (capped, with receipts), hands in work. Can never touch a budget."],
  ["Council", "Settles disputes: refund, pay or split. Nothing else."],
  ["Nobody", "No owner, no upgrade key. Money only moves by the contract's rules."],
];

export default function How() {
  const live = useMode() === "live";
  const { config } = useWallet();
  const api = useApi();
  const { data: w, error, reload } = useJson<W>(api("/world"), 4000);
  const [busy, setBusy] = useState(false);
  if (!w) return <Loading error={error} />;
  return (
    <div className="flex flex-col gap-10 pt-10">
      <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">How Guild works</h1>

      <ol className="grid gap-4 sm:grid-cols-5">
        {FLOW.map((f, i) => (
          <li key={f.title} className="rounded-3xl border border-edge bg-hive p-5">
            <div className="flex items-center gap-2 text-honey">
              <Glyph name={f.glyph} />
              <span className="font-mono text-xs text-faint">{i + 1}</span>
            </div>
            <div className="mt-3 font-display font-semibold">{f.title}</div>
            <p className="mt-1 text-sm text-muted">{f.text}</p>
          </li>
        ))}
      </ol>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card label="What's real">
          <h2 className="mb-4 font-display text-lg font-semibold">What&apos;s real</h2>
          <dl className="flex flex-col gap-4">
            {REAL.map(([k, v]) => (
              <div key={k}>
                <dt className="text-sm font-semibold text-paper">{k}</dt>
                <dd className="text-sm text-muted">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>
        <Card label="Who can do what">
          <h2 className="mb-4 font-display text-lg font-semibold">Who can do what</h2>
          <dl className="flex flex-col gap-4">
            {ROLES.map(([k, v]) => (
              <div key={k}>
                <dt className="text-sm font-semibold text-paper">{k}</dt>
                <dd className="text-sm text-muted">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-6 rounded-2xl bg-night/60 p-4 text-xs text-muted">
            Mode: <span className="text-paper">{w.mode.ai === "near-ai" ? `NEAR AI live (${w.mode.model})` : "demo AI"}</span> · ledger:{" "}
            {live && config ? (
              <a className="text-paper underline underline-offset-2" href={`https://${config.network === "testnet" ? "testnet." : ""}nearblocks.io/address/${config.contract}`} target="_blank" rel="noreferrer">
                {config.contract} on NEAR {config.network}
              </a>
            ) : (
              <span className="text-paper">demo ledger (your own private copy)</span>
            )}
          </div>
        </Card>
      </div>

      <Card label="Every transaction">
        <div className="mb-4 flex items-center gap-3">
          <h2 className="flex-1 font-display text-lg font-semibold">{live ? "The runner\u2019s transactions" : "Every transaction"}</h2>
          {!live && <button
            className={btn.quiet}
            disabled={busy}
            onClick={async () => {
              if (!confirm("Start the demo again from scratch?")) return;
              setBusy(true);
              await post("/api/reset", {});
              setBusy(false);
              reload();
            }}
          >
            Reset demo
          </button>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-xs">
            <thead className="text-faint">
              <tr>
                <th className="py-2 pr-3 font-medium">Method</th>
                <th className="py-2 pr-3 font-medium">What happened</th>
                <th className="py-2 pr-3 font-medium">Signed by</th>
                <th className="py-2 pr-3 font-medium">When</th>
                <th className="py-2 font-medium">Testnet</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge">
              {w.txs.map((t) => (
                <tr key={t.hash}>
                  <td className="py-2 pr-3 font-mono text-honey/80">{t.method}</td>
                  <td className="py-2 pr-3 text-soft">{t.summary}</td>
                  <td className="py-2 pr-3 font-mono text-faint">{t.signer}</td>
                  <td className="py-2 pr-3 text-ghost">{ago(t.at)}</td>
                  <td className="py-2">
                    <ChainMark tx={t} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
