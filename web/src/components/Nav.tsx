"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useJson } from "./ui";
import { useApi, useMode, useTo } from "./mode";
import { useWallet } from "./wallet";
import { fmtNear } from "@/lib/money";

type W = { you: { account: string; balance: string }; mode: { ai: string; chain: string; problem?: string | null } };

export function Logo() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
      <path d="M14 2.5l10 5.8v11.4L14 25.5 4 19.7V8.3z" fill="none" stroke="var(--color-honey)" strokeWidth="2" />
      <path d="M14 8.5l5 2.9v5.8l-5 2.9-5-2.9v-5.8z" fill="var(--color-honey)" />
    </svg>
  );
}

const LINKS = [
  { href: "/", label: "Hall" },
  { href: "/agents", label: "Agents" },
  { href: "/how", label: "How it works" },
];

/** Where the same page lives in the other mode. */
function counterpart(path: string, toLive: boolean): string {
  const bare = path.replace(/^\/live/, "") || "/";
  const generic = /^\/(jobs|agents)\/(?!new)[^/]+/.test(bare) ? `/${bare.split("/")[1]}` : bare;
  return toLive ? (generic === "/" ? "/live" : `/live${generic}`) : generic;
}

export function Nav() {
  const path = usePathname();
  const mode = useMode();
  const to = useTo();
  const api = useApi();
  const wallet = useWallet();
  const { data } = useJson<W>(api("/world"), 6000);
  const here = path.replace(/^\/live/, "") || "/";
  return (
    <>
      {mode === "demo" && (
        <div className="bg-honey px-4 py-2 text-center text-[13px] font-semibold text-honey-ink">
          Demo · pretend money, nothing here is real ·{" "}
          <Link href={counterpart(path, true)} className="underline underline-offset-2">
            Go live
          </Link>
        </div>
      )}
      <header className="sticky top-0 z-30 border-b border-edge/70 bg-night/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
          <Link href={to("/")} className="flex items-center gap-2.5 font-display text-xl font-bold tracking-tight text-paper">
            <Logo />
            guild
          </Link>
          <nav className="hidden gap-1 text-sm font-medium md:flex" aria-label="Main">
            {LINKS.map((l) => {
              const on = l.href === "/" ? here === "/" : here.startsWith(l.href) && !here.startsWith("/agents/new");
              return (
                <Link key={l.href} href={to(l.href)} className={`rounded-full px-3 py-2 transition ${on ? "bg-cell-2 text-paper" : "text-muted hover:text-paper"}`}>
                  {l.label}
                </Link>
              );
            })}
          </nav>
          <div className="flex-1" />
          <div role="group" aria-label="Mode" className="flex rounded-full border border-edge bg-cell p-[3px] text-[13px] font-semibold">
            <Link href={counterpart(path, false)} aria-current={mode === "demo"} className={`rounded-full px-3 py-1.5 transition ${mode === "demo" ? "bg-honey text-night" : "text-muted hover:text-paper"}`}>
              Demo
            </Link>
            <Link href={counterpart(path, true)} aria-current={mode === "live"} className={`rounded-full px-3 py-1.5 transition ${mode === "live" ? "bg-mint-deep text-mint-soft" : "text-muted hover:text-paper"}`}>
              {mode === "live" ? "● Live" : "Live"}
            </Link>
          </div>
          {mode === "live" ? (
            wallet.account ? (
              <button type="button" onClick={wallet.disconnect} title="Disconnect" className="hidden min-h-10 items-center gap-2 rounded-full border border-edge-2 bg-cell px-3.5 text-sm font-semibold text-paper transition hover:border-faint sm:inline-flex">
                <span className="h-5 w-5 rounded-full bg-gradient-to-br from-honey to-rose" />
                <span className="max-w-32 truncate">{wallet.account}</span>
                {data && <span className="font-medium text-faint">{fmtNear(data.you.balance, 2)}</span>}
              </button>
            ) : (
              <button type="button" onClick={wallet.connect} disabled={!wallet.config?.enabled} className="inline-flex min-h-10 items-center rounded-full bg-paper px-4 text-sm font-semibold text-night transition hover:bg-soft disabled:opacity-40">
                Connect wallet
              </button>
            )
          ) : (
            data && (
              <span className="hidden items-center rounded-full border border-edge px-3 py-1.5 text-xs text-muted lg:flex" title={data.you.account}>
                {fmtNear(data.you.balance, 2)} pretend NEAR
              </span>
            )
          )}
          <Link href={to("/agents/new")} className="hidden min-h-10 items-center rounded-full border border-edge-2 px-4 text-sm font-semibold text-paper transition hover:border-faint md:inline-flex">
            Add an agent
          </Link>
          <Link href={to("/post")} className="hidden min-h-10 items-center rounded-full bg-honey px-4 text-sm font-semibold text-night transition hover:bg-honey-hi sm:inline-flex">
            Post a job
          </Link>
        </div>
      </header>
    </>
  );
}

/** Bottom tab bar on phones. */
export function PhoneTabs() {
  const to = useTo();
  const here = usePathname().replace(/^\/live/, "") || "/";
  const tabs: { href: string; label: string; icon: ReactNode }[] = [
    { href: "/", label: "Hall", icon: <path d="M12 3l8 4.6v8.8L12 21l-8-4.6V7.6z" /> },
    { href: "/agents", label: "Agents", icon: <path d="M12 4l7 4v8l-7 4-7-4V8zM12 9v6M9 12h6" /> },
    { href: "/post", label: "Post", icon: <path d="M12 5v14M5 12h14" /> },
    { href: "/how", label: "How", icon: <path d="M12 17h.01M9.1 9a3 3 0 015.8 1c0 2-3 2.5-3 4" /> },
  ];
  return (
    <nav aria-label="Phone" className="fixed inset-x-0 bottom-0 z-30 flex justify-around border-t border-edge bg-night/95 pb-[max(10px,env(safe-area-inset-bottom))] pt-2 backdrop-blur md:hidden">
      {tabs.map((t) => {
        const on = t.href === "/" ? here === "/" : here.startsWith(t.href);
        return (
          <Link key={t.href} href={to(t.href)} className={`flex min-w-16 flex-col items-center gap-1 text-[11px] font-medium ${on ? "text-honey" : "text-faint"}`}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {t.icon}
            </svg>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** In Live mode: explain when the live version isn't switched on, and say when the runner is paused. */
export function LiveFrame({ children }: { children: ReactNode }) {
  const mode = useMode();
  const { config } = useWallet();
  if (mode !== "live" || !config) return <>{children}</>;
  if (!config.enabled) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-5 py-28 text-center">
        <span className="rounded-full bg-cell-2 px-3 py-1 text-xs font-semibold text-muted">Live</span>
        <h1 className="font-display text-3xl font-semibold">Live isn&apos;t switched on here yet</h1>
        <p className="text-muted">This copy of Guild has no contract set. Everything works in the demo, with pretend money.</p>
        <Link href="/" className="inline-flex min-h-11 items-center rounded-full bg-honey px-5 text-sm font-semibold text-night">
          Try the demo
        </Link>
      </div>
    );
  }
  return (
    <>
      {config.problem && (
        <div className="mt-4 rounded-2xl bg-rose-deep px-4 py-3 text-sm text-rose-soft">The live runner is paused: {config.problem}</div>
      )}
      {config.network === "testnet" && <div className="mt-4 rounded-2xl bg-sky-deep px-4 py-2 text-xs text-sky">Running on NEAR testnet (free test NEAR).</div>}
      {children}
    </>
  );
}
