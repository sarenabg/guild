import "server-only";
import { Account, KeyPairSigner, providers } from "near-api-js";
import type { KeyPairString } from "@near-js/crypto";
import { config, explorer } from "../config";
import { mockBalance, mockCall, mockHash, mockView } from "./mock-chain";

// Talking to the real Guild contract: free reads over RPC, and signed calls
// from the runner/reviewer account. That account holds only a function-call
// key limited to the Guild contract, so it can't move anyone's money.

type Provider = InstanceType<typeof providers.JsonRpcProvider>;
type G = { provider?: Provider; operator?: Account };
const g = globalThis as unknown as { __guildNear?: G };
const state: G = (g.__guildNear ??= {});

function provider() {
  return (state.provider ??= new providers.JsonRpcProvider({ url: config.nearRpc }, { retries: 3, backoff: 1.5, wait: 400 }));
}

export async function view<T>(method: string, args: Record<string, unknown> = {}): Promise<T> {
  if (config.liveMock) return mockView(method, args) as T;
  return (await provider().callFunction(config.liveContract, method, args)) as T;
}

export async function balanceOf(account: string): Promise<string> {
  if (config.liveMock) return mockBalance(account);
  try {
    const a = await provider().viewAccount(account);
    return String(a.amount);
  } catch {
    return "0";
  }
}

function operator(): Account {
  if (!state.operator) {
    const signer = KeyPairSigner.fromSecretKey(config.operatorKey as KeyPairString);
    state.operator = new Account(config.operatorId, provider(), signer);
  }
  return state.operator;
}

export type Sent = { hash: string; url: string; ok: boolean; error?: string; value?: unknown };

/** Call a contract method as the runner/reviewer. Never throws: failures come back as `ok: false`. */
export async function call(method: string, args: Record<string, unknown>, tgas = 100): Promise<Sent> {
  if (config.liveMock) {
    try {
      const value = mockCall(config.operatorId, method, args);
      return { hash: mockHash(), url: "", ok: true, value };
    } catch (e) {
      return { hash: "", url: "", ok: false, error: (e as Error).message };
    }
  }
  try {
    const out = await operator().callFunctionRaw({
      contractId: config.liveContract,
      methodName: method,
      args,
      gas: BigInt(tgas) * 10n ** 12n,
      deposit: 0n,
    });
    const hash = out.transaction_outcome?.id ?? out.transaction?.hash ?? "";
    const status = out.status as { Failure?: unknown; SuccessValue?: string };
    if (status && typeof status === "object" && "Failure" in status) {
      return { hash, url: explorer(hash), ok: false, error: describe(status.Failure) };
    }
    let value: unknown;
    if (status && typeof status === "object" && status.SuccessValue) {
      try {
        value = JSON.parse(Buffer.from(status.SuccessValue, "base64").toString());
      } catch {
        value = undefined;
      }
    }
    return { hash, url: hash ? explorer(hash) : "", ok: true, value };
  } catch (e) {
    return { hash: "", url: "", ok: false, error: describe(e) };
  }
}

function describe(e: unknown): string {
  const s = typeof e === "string" ? e : e instanceof Error ? e.message : JSON.stringify(e);
  return (/Smart contract panicked: ([^"\\]+)/.exec(s)?.[1] ?? s).slice(0, 240);
}
