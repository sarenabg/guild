"use client";

import "@near-wallet-selector/modal-ui/styles.css";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import type { WalletSelector } from "@near-wallet-selector/core";
import type { WalletSelectorModal } from "@near-wallet-selector/modal-ui";

// The Live version's wallet. The person's own wallet (Meteor, HOT,
// MyNearWallet) signs every call that moves their money. Guild never sees keys.

export type LiveConfig = { enabled: boolean; network: "mainnet" | "testnet"; contract: string; council: string | null; problem: string | null; model: string };

type Ctx = {
  config: LiveConfig | null;
  account: string | null;
  connect: () => void;
  disconnect: () => void;
  /** Sign and send one call to the Guild contract. Returns the method's return value, if any. */
  call: (method: string, args: Record<string, unknown>, opts?: { deposit?: bigint; tgas?: number }) => Promise<{ value?: unknown; hash?: string }>;
};

const WalletCtx = createContext<Ctx>({
  config: null,
  account: null,
  connect: () => {},
  disconnect: () => {},
  call: async () => ({}),
});

export const useWallet = () => useContext(WalletCtx);

export function WalletProvider({ children }: { children: ReactNode }) {
  const onLive = usePathname().startsWith("/live");
  const [config, setConfig] = useState<LiveConfig | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const selector = useRef<WalletSelector | null>(null);
  const modal = useRef<WalletSelectorModal | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (!onLive || started.current) return;
    started.current = true;
    (async () => {
      const cfg = (await fetch("/api/live/config").then((r) => r.json())) as LiveConfig;
      setConfig(cfg);
      if (!cfg.enabled) return;
      const [{ setupWalletSelector }, { setupModal }, { setupMeteorWallet }, { setupHotWallet }, { setupMyNearWallet }] = await Promise.all([
        import("@near-wallet-selector/core"),
        import("@near-wallet-selector/modal-ui"),
        import("@near-wallet-selector/meteor-wallet"),
        import("@near-wallet-selector/hot-wallet"),
        import("@near-wallet-selector/my-near-wallet"),
      ]);
      const s = await setupWalletSelector({ network: cfg.network, modules: [setupMeteorWallet(), setupHotWallet(), setupMyNearWallet()] });
      selector.current = s;
      modal.current = setupModal(s, { contractId: cfg.contract, description: "Connect a wallet to post jobs, add agents and back them with real NEAR." });
      const pick = () => setAccount(s.store.getState().accounts.find((a) => a.active)?.accountId ?? null);
      pick();
      s.store.observable.subscribe(pick);
    })().catch((e) => console.error("wallet setup failed", e));
  }, [onLive]);

  const connect = useCallback(() => modal.current?.show(), []);
  const disconnect = useCallback(async () => {
    const w = await selector.current?.wallet();
    await w?.signOut();
    setAccount(null);
  }, []);

  const call = useCallback<Ctx["call"]>(
    async (method, args, opts = {}) => {
      const s = selector.current;
      if (!s || !config) throw new Error("The live version isn't ready yet");
      if (!account) {
        modal.current?.show();
        throw new Error("Connect a wallet first");
      }
      const { actionCreators } = await import("@near-wallet-selector/core");
      const wallet = await s.wallet();
      const outcome = await wallet.signAndSendTransaction({
        receiverId: config.contract,
        actions: [actionCreators.functionCall(method, args, BigInt(opts.tgas ?? 100) * 10n ** 12n, opts.deposit ?? 0n)],
      });
      await fetch("/api/live/refresh", { method: "POST" }).catch(() => undefined);
      const out = (outcome ?? {}) as { status?: { SuccessValue?: string; Failure?: unknown }; transaction?: { hash?: string } };
      if (out.status && "Failure" in out.status) {
        const msg = JSON.stringify(out.status.Failure);
        throw new Error(/panicked: ([^"\\]+)/.exec(msg)?.[1] ?? "The transaction failed");
      }
      let value: unknown;
      if (out.status?.SuccessValue) {
        try {
          value = JSON.parse(atob(out.status.SuccessValue));
        } catch {
          value = undefined;
        }
      }
      return { value, hash: out.transaction?.hash };
    },
    [account, config],
  );

  return <WalletCtx.Provider value={{ config, account, connect, disconnect, call }}>{children}</WalletCtx.Provider>;
}

/** NEAR → yoctoNEAR without floating-point surprises. */
export function yocto(nearAmount: number): bigint {
  const [w, f = ""] = nearAmount.toFixed(6).split(".");
  return BigInt(w) * 10n ** 24n + BigInt((f + "0".repeat(24)).slice(0, 24));
}
