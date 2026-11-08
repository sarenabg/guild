import "server-only";
import fs from "node:fs";
import os from "node:os";

/** Read a private key from a near CLI credentials file, so it never has to be pasted anywhere. */
function readKeyFile(file?: string): string {
  if (!file) return "";
  try {
    const p = file.replace(/^~(?=\/)/, os.homedir());
    const j = JSON.parse(fs.readFileSync(p, "utf8")) as { private_key?: string; secret_key?: string };
    return (j.private_key ?? j.secret_key ?? "").trim();
  } catch {
    return "";
  }
}

// Everything the app reads from the environment, in one place.
// With no settings at all, Guild runs fully in demo mode.

export const config = {
  /** NEAR AI Cloud key. Without it, agents and the reviewer use the built-in demo AI. */
  nearAiKey: process.env.NEARAI_API_KEY?.trim() || "",
  nearAiBase: process.env.NEARAI_BASE_URL?.trim() || "https://cloud-api.near.ai/v1",
  /** A NEAR-hosted open model that runs inside a TEE and supports JSON output. */
  model: process.env.NEARAI_MODEL?.trim() || "Qwen/Qwen3.6-35B-A3B-FP8",
  /** Used to turn NEAR AI's dollar prices into NEAR fuel. */
  nearUsd: Number(process.env.NEAR_USD || "3"),
  /** How long finished work waits for the poster before it pays out by itself. */
  releaseAfterMs: Number(process.env.GUILD_RELEASE_AFTER_SECONDS || "90") * 1000,
  /** Demo pacing: 1 = normal, 0 = instant (tests). */
  pace: Number(process.env.GUILD_PACE ?? "1"),
  dataDir: process.env.GUILD_DATA_DIR || "data",
  // ---- Live version (real NEAR) ----
  /** "mainnet" for the real thing, "testnet" to rehearse with free NEAR. */
  network: (process.env.NEAR_NETWORK === "testnet" ? "testnet" : "mainnet") as "mainnet" | "testnet",
  /** The deployed Guild contract. Empty = no live version. */
  liveContract: process.env.GUILD_CONTRACT?.trim() || "",
  /** The runner/reviewer account and its function-call key (only allowed to call the Guild contract). */
  operatorId: process.env.GUILD_OPERATOR_ID?.trim() || "",
  operatorKey: process.env.GUILD_OPERATOR_KEY?.trim() || readKeyFile(process.env.GUILD_OPERATOR_KEY_FILE),
  nearRpc:
    process.env.NEAR_RPC?.trim() ||
    (process.env.NEAR_NETWORK === "testnet" ? "https://test.rpc.fastnear.com" : "https://free.rpc.fastnear.com"),
  /** Let demo visitors use real NEAR AI (costs your credits). Off by default. */
  demoRealAi: process.env.GUILD_DEMO_REAL_AI === "1",
  /** The demo visitor's account. */
  you: "you.testnet",
};

export const liveAi = () => config.nearAiKey.length > 0;
/** The live version is switched on (a contract is set). */
export const liveOn = () => config.liveContract.length > 0;
/** Why the live runner can't run yet, or null when it can. */
export function liveProblem(): string | null {
  if (!config.liveContract) return "No contract set (GUILD_CONTRACT).";
  if (!config.operatorId || !config.operatorKey) return "No runner account set (GUILD_OPERATOR_ID / GUILD_OPERATOR_KEY).";
  if (!config.nearAiKey) return "No NEAR AI key set (NEARAI_API_KEY).";
  return null;
}
export const explorer = (hash: string) =>
  `https://${config.network === "testnet" ? "testnet." : ""}nearblocks.io/txns/${hash}`;
