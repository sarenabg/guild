// Agent tools. Each one is small, safe and allow-listed (see guardrails.ts).
// knowledge, calculator and near_lookup run for real in every mode.
// web_search runs on NEAR AI (its built-in search) when a key is set.

import { keyTerms } from "./guardrails";

/** Find the paragraphs of an agent's own notes that best match a question. */
export function knowledgeLookup(knowledge: string, question: string, max = 3): string[] {
  const paras = knowledge
    .split(/\n\s*\n|\n(?=[-•*] )/)
    .map((p) => p.trim())
    .filter((p) => p.length > 20);
  const terms = keyTerms(question);
  return paras
    .map((p) => ({ p, score: terms.filter((t) => p.toLowerCase().includes(t)).length }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((x) => x.p.slice(0, 600));
}

/** A tiny, safe calculator: numbers, + - * / % ^ and brackets. No eval. */
export function calculate(expr: string): number {
  const src = expr.replace(/,/g, "").replace(/\s+/g, "");
  if (!/^[\d.+\-*/%^()]+$/.test(src)) throw new Error("Only numbers and + - * / % ^ ( ) are allowed");
  let i = 0;
  const peek = () => src[i];
  const num = (): number => {
    if (peek() === "(") {
      i++;
      const v = add();
      if (src[i++] !== ")") throw new Error("Missing )");
      return v;
    }
    if (peek() === "-") {
      i++;
      return -num();
    }
    const m = /^\d+(\.\d+)?/.exec(src.slice(i));
    if (!m) throw new Error("Expected a number");
    i += m[0].length;
    return Number(m[0]);
  };
  const pow = (): number => {
    const b = num();
    if (peek() === "^") {
      i++;
      return b ** pow();
    }
    return b;
  };
  const mul = (): number => {
    let v = pow();
    while (peek() === "*" || peek() === "/" || peek() === "%") {
      const op = src[i++];
      const r = pow();
      v = op === "*" ? v * r : op === "/" ? v / r : v % r;
    }
    return v;
  };
  const add = (): number => {
    let v = mul();
    while (peek() === "+" || peek() === "-") {
      const op = src[i++];
      const r = mul();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  };
  const v = add();
  if (i !== src.length) throw new Error("Unexpected text in the sum");
  if (!Number.isFinite(v)) throw new Error("The answer is not a finite number");
  return Math.round(v * 1e9) / 1e9;
}

/** Pull simple sums like "12 * 4.5" out of a brief. */
export function findSums(text: string): string[] {
  return [...text.matchAll(/(?:\d[\d.,]*\s*[-+*/x×%^]\s*)+\d[\d.,]*/g)]
    .map((m) => m[0].replace(/[x×]/g, "*").trim())
    .filter((s) => /[-+*/%^]/.test(s))
    .slice(0, 4);
}

/** NEAR account names mentioned in text, e.g. "alice.near". */
export function findAccounts(text: string): string[] {
  return [...new Set([...text.matchAll(/\b[a-z0-9][a-z0-9_-]*(?:\.[a-z0-9_-]+)*\.(?:near|testnet)\b/g)].map((m) => m[0]))].slice(0, 3);
}

/** Read a NEAR account's balance from a public RPC node. */
export async function nearLookup(account: string): Promise<string> {
  const net = account.endsWith(".testnet") ? "testnet" : "mainnet";
  const res = await fetch(`https://rpc.${net}.near.org`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "guild",
      method: "query",
      params: { request_type: "view_account", finality: "final", account_id: account },
    }),
    signal: AbortSignal.timeout(8_000),
  });
  const body = (await res.json()) as { result?: { amount: string; code_hash: string; storage_usage: number }; error?: { cause?: { name?: string } } };
  if (!body.result) return `${account}: not found on ${net} (${body.error?.cause?.name ?? "unknown error"})`;
  const amount = Number(BigInt(body.result.amount) / 10n ** 21n) / 1000;
  const isContract = body.result.code_hash !== "11111111111111111111111111111111";
  return `${account} on ${net}: ${amount.toLocaleString("en-US")} NEAR, ${isContract ? "has a smart contract" : "a regular account"}, ${body.result.storage_usage.toLocaleString("en-US")} bytes stored`;
}
