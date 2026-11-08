"use client";

import { useMode, useTo } from "@/components/mode";
import { useWallet, yocto } from "@/components/wallet";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Glyph as GlyphName, Skill } from "@/lib/types";
import { AGENT_TEMPLATES, SKILL_LABEL, TOOL_LABEL } from "@/lib/samples";
import { Card, Glyph, Hex, btn, field, post } from "@/components/ui";

const SKILLS: Skill[] = ["research", "analyze", "write", "translate", "code", "check"];
const GLYPHS: GlyphName[] = ["eye", "pen", "lens", "spark", "globe", "chart", "shield", "code", "leaf"];
const HUES = [38, 12, 320, 265, 205, 160, 95, 48];
const TOOLS = ["web_search", "knowledge", "calculator", "near_lookup"];

export default function NewAgent() {
  const to = useTo();
  const live = useMode() === "live";
  const wallet = useWallet();
  const router = useRouter();
  const [name, setName] = useState("");
  const [tagline, setTagline] = useState("");
  const [skill, setSkill] = useState<Skill>("research");
  const [glyph, setGlyph] = useState<GlyphName>("globe");
  const [hue, setHue] = useState(205);
  const [instructions, setInstructions] = useState("");
  const [knowledge, setKnowledge] = useState("");
  const [tools, setTools] = useState<string[]>(["knowledge"]);
  const [fuel, setFuel] = useState(live ? 0.3 : 2);
  const [creatorPct, setCreatorPct] = useState(50);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function applyTemplate(key: string) {
    const t = AGENT_TEMPLATES.find((x) => x.key === key)!;
    setName(t.name);
    setTagline(t.tagline);
    setSkill(t.skill);
    setGlyph(t.glyph);
    setHue(t.hue);
    setInstructions(t.instructions);
    setKnowledge(t.knowledge);
    setTools(t.tools);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    if (live) {
      try {
        // 1. Share the instructions with the reviewer; get their fingerprint.
        const saved = await post("/api/live/specs", { name, tagline, skill, glyph, hue, instructions, knowledge, tools });
        if (!saved.ok) throw new Error(String(saved.data.error ?? "Couldn't save the instructions"));
        const { spec_hash, id } = saved.data as { spec_hash: string; id: string };
        // 2. Register the agent on-chain with that fingerprint and its fuel.
        await wallet.call(
          "register_agent",
          {
            id,
            name: name.trim(),
            spec_hash,
            tools,
            max_fuel_per_job: yocto(Math.min(fuel, 0.1)).toString(),
            refuel_bps: 2000,
            creator_bps: Math.round(creatorPct * 100),
          },
          { deposit: yocto(fuel + 0.03), tgas: 150 },
        );
        router.push(to(`/agents/${id}`));
      } catch (err) {
        setError((err as Error).message);
        setBusy(false);
      }
      return;
    }
    const { ok, data } = await post("/api/agents", {
      name,
      tagline,
      skill,
      glyph,
      hue,
      instructions,
      knowledge,
      tools,
      fuel,
      maxPerJob: Math.min(fuel, 0.5),
      refuelPct: 20,
      creatorPct,
    });
    if (ok) router.push(to(`/agents/${data.id}`));
    else {
      setError(String(data.error ?? "Couldn't add the agent"));
      setBusy(false);
    }
  }

  const preview = { name: name || "Your agent", hue, glyph };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 pt-10">
      <div className="flex items-center gap-5">
        <Hex agent={preview} size={84} />
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">Add an agent</h1>
          <p className="mt-1 text-muted">It joins after a safety check.</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2" aria-label="Templates">
        {AGENT_TEMPLATES.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => applyTemplate(t.key)}
            className={`min-h-10 rounded-full border px-3.5 text-sm transition ${t.bad ? "border-rose-deep text-rose-soft hover:border-rose" : "border-edge-2 text-soft hover:border-faint hover:text-paper"}`}
          >
            {t.bad ? "Try a sneaky one" : `${SKILL_LABEL[t.skill]} template`}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="flex flex-col gap-6">
        <Card className="flex flex-col gap-5" label="Identity">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium text-muted">Name</span>
              <input className={field} value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required placeholder="e.g. Sage" />
            </label>
            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium text-muted">Tagline</span>
              <input className={field} value={tagline} onChange={(e) => setTagline(e.target.value)} maxLength={60} placeholder="e.g. Digs up the facts" />
            </label>
          </div>
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-muted">Best at</legend>
            <div className="flex flex-wrap gap-2">
              {SKILLS.map((s) => (
                <button key={s} type="button" aria-pressed={skill === s} onClick={() => setSkill(s)} className={`min-h-10 rounded-full px-4 text-sm font-semibold transition ${skill === s ? "bg-paper text-night" : "bg-cell-2 text-soft hover:bg-edge-2"}`}>
                  {SKILL_LABEL[s]}
                </button>
              ))}
            </div>
          </fieldset>
          <div className="flex flex-wrap items-center gap-6">
            <fieldset>
              <legend className="mb-2 text-sm font-medium text-muted">Icon</legend>
              <div className="flex flex-wrap gap-1.5">
                {GLYPHS.map((g) => (
                  <button key={g} type="button" aria-label={g} aria-pressed={glyph === g} onClick={() => setGlyph(g)} className={`flex h-10 w-10 items-center justify-center rounded-xl transition ${glyph === g ? "bg-paper text-night" : "bg-cell-2 text-soft hover:bg-edge-2"}`}>
                    <Glyph name={g} size={18} />
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="mb-2 text-sm font-medium text-muted">Colour</legend>
              <div className="flex flex-wrap gap-1.5">
                {HUES.map((h) => (
                  <button key={h} type="button" aria-label={`Colour ${h}`} aria-pressed={hue === h} onClick={() => setHue(h)} className={`h-10 w-10 rounded-xl border-2 transition ${hue === h ? "border-paper" : "border-transparent"}`} style={{ background: `hsl(${h} 70% 55%)` }} />
                ))}
              </div>
            </fieldset>
          </div>
        </Card>

        <Card className="flex flex-col gap-5" label="Brain">
          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium text-muted">Instructions</span>
            <textarea className={`${field} min-h-32 resize-y leading-relaxed`} value={instructions} onChange={(e) => setInstructions(e.target.value)} maxLength={4000} required placeholder="How should your agent work? What should it always do, and never do?" />
          </label>
          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium text-muted">
              Knowledge <span className="text-ghost">· optional notes it can look up</span>
            </span>
            <textarea className={`${field} min-h-24 resize-y leading-relaxed`} value={knowledge} onChange={(e) => setKnowledge(e.target.value)} maxLength={20000} placeholder="Paste facts, prices, a style guide…" />
          </label>
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-muted">Tools</legend>
            <div className="flex flex-wrap gap-2">
              {TOOLS.map((t) => {
                const on = tools.includes(t);
                return (
                  <button key={t} type="button" aria-pressed={on} onClick={() => setTools(on ? tools.filter((x) => x !== t) : [...tools, t])} className={`min-h-10 rounded-full px-4 text-sm font-semibold transition ${on ? "bg-honey text-night" : "bg-cell-2 text-soft hover:bg-edge-2"}`}>
                    {TOOL_LABEL[t]}
                  </button>
                );
              })}
            </div>
          </fieldset>
        </Card>

        <Card className="flex flex-col gap-6" label="Fuel">
          <div className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-medium text-muted" id="fuel-label">
                Fuel <span className="text-ghost">· pays for its AI</span>
              </span>
              <span className="font-display text-2xl font-semibold text-honey">{fuel} NEAR</span>
            </div>
            <input type="range" min={live ? 0.15 : 0.5} max={live ? 5 : 20} step={live ? 0.05 : 0.5} value={fuel} onChange={(e) => setFuel(Number(e.target.value))} aria-labelledby="fuel-label" className="w-full accent-[var(--color-honey)]" />
          </div>
          <div className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-medium text-muted" id="split-label">
                From each payout
              </span>
              <span className="text-sm text-soft">
                20% fuel · <span className="text-paper">{Math.round(creatorPct * 0.8)}% you</span> · <span className="text-mint-soft">{Math.round((100 - creatorPct) * 0.8)}% funders</span>
              </span>
            </div>
            <input type="range" min={0} max={100} step={5} value={creatorPct} onChange={(e) => setCreatorPct(Number(e.target.value))} aria-labelledby="split-label" className="w-full accent-[var(--color-honey)]" />
          </div>
        </Card>

        {error && <p className="rounded-2xl bg-rose-deep px-4 py-3 text-sm text-rose-soft">{error}</p>}
        <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
          <p className="flex-1 text-sm text-muted">If it doesn&apos;t pass the safety check, your fuel comes straight back.</p>
          {live && !wallet.account ? (
            <button type="button" className={btn.honey} onClick={wallet.connect}>
              Connect wallet
            </button>
          ) : (
            <button className={btn.honey} disabled={busy || !name.trim() || instructions.trim().length < 10}>
              {busy ? (live ? "Confirm in your wallet…" : "Adding…") : live ? `Confirm in wallet · ${fuel} NEAR` : `Add · ${fuel} NEAR`}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
