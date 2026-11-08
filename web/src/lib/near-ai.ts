import "server-only";
import crypto from "node:crypto";
import { config } from "./config";

// A small NEAR AI Cloud client (OpenAI-compatible API at cloud-api.near.ai).
// It keeps the exact request and response bytes so each answer can be checked
// against the signature NEAR AI's TEE publishes for it.

export type Msg = { role: "system" | "user" | "assistant"; content: string };

export type Completion = {
  id: string;
  text: string;
  promptTokens: number;
  completionTokens: number;
  /** cost in US dollars, from NEAR AI's own price list */
  usd: number;
  requestHash: string;
  responseHash: string;
  sources?: { title: string; url: string }[];
};

type Price = { prompt: number; completion: number };
const prices = new Map<string, Price>();

async function priceOf(model: string): Promise<Price> {
  if (prices.has(model)) return prices.get(model)!;
  try {
    const res = await fetch(`${config.nearAiBase}/models`, { signal: AbortSignal.timeout(10_000) });
    const body = (await res.json()) as { data: { id: string; pricing?: { prompt?: string; completion?: string } }[] };
    for (const m of body.data) {
      prices.set(m.id, { prompt: Number(m.pricing?.prompt ?? 0), completion: Number(m.pricing?.completion ?? 0) });
    }
  } catch {
    // price list unavailable: fall back to a conservative estimate below
  }
  return prices.get(model) ?? { prompt: 0.000001, completion: 0.000004 };
}

const sha256 = (b: string | Buffer) => crypto.createHash("sha256").update(b).digest("hex");

function headers() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${config.nearAiKey}`,
    "Accept-Encoding": "identity",
    "x-no-aliasing": "true",
  };
}

/** One chat completion. `json` asks the model for a JSON object. */
export async function chat(messages: Msg[], opts: { json?: boolean; maxTokens?: number } = {}): Promise<Completion> {
  const model = config.model;
  const body = JSON.stringify({
    model,
    messages,
    max_tokens: opts.maxTokens ?? 1400,
    temperature: 0.4,
    ...(opts.json ? { response_format: { type: "json_object" } } : {}),
  });
  const res = await fetch(`${config.nearAiBase}/chat/completions`, {
    method: "POST",
    headers: headers(),
    body,
    signal: AbortSignal.timeout(120_000),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`NEAR AI answered ${res.status}: ${raw.slice(0, 200)}`);
  const data = JSON.parse(raw) as {
    id: string;
    choices: { message: { content: string | null } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const price = await priceOf(model);
  const p = data.usage?.prompt_tokens ?? 0;
  const c = data.usage?.completion_tokens ?? 0;
  return {
    id: data.id,
    text: stripThinking(data.choices[0]?.message.content ?? ""),
    promptTokens: p,
    completionTokens: c,
    usd: p * price.prompt + c * price.completion,
    requestHash: sha256(body),
    responseHash: sha256(raw),
  };
}

/** A completion that may search the web first (NEAR AI runs the search). */
export async function chatWithSearch(messages: Msg[], maxTokens = 1400): Promise<Completion> {
  const model = config.model;
  const body = JSON.stringify({
    model,
    messages,
    max_tokens: maxTokens,
    temperature: 0.4,
    stream: true,
    stream_options: { include_usage: true },
    tools: [{ type: "web_context_search" }],
  });
  const res = await fetch(`${config.nearAiBase}/chat/completions`, {
    method: "POST",
    headers: headers(),
    body,
    signal: AbortSignal.timeout(180_000),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`NEAR AI answered ${res.status}: ${raw.slice(0, 200)}`);
  let id = "";
  let text = "";
  let p = 0;
  let c = 0;
  const sources: { title: string; url: string }[] = [];
  for (const line of raw.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const chunk = JSON.parse(payload);
      id ||= chunk.id ?? "";
      const delta = chunk.choices?.[0]?.delta ?? {};
      if (typeof delta.content === "string") text += delta.content;
      const result = delta.nearai_tool_result;
      if (result) collectSources(result, sources);
      if (chunk.usage) {
        p = chunk.usage.prompt_tokens ?? p;
        c = chunk.usage.completion_tokens ?? c;
      }
    } catch {
      // ignore keep-alive or partial lines
    }
  }
  const price = await priceOf(model);
  return {
    id,
    text: stripThinking(text),
    promptTokens: p,
    completionTokens: c,
    usd: p * price.prompt + c * price.completion,
    requestHash: sha256(body),
    responseHash: sha256(raw),
    sources: sources.slice(0, 8),
  };
}

function collectSources(node: unknown, out: { title: string; url: string }[]) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    node.forEach((n) => collectSources(n, out));
    return;
  }
  const o = node as Record<string, unknown>;
  if (typeof o.url === "string" && !out.some((s) => s.url === o.url)) {
    out.push({ url: o.url, title: typeof o.title === "string" ? o.title : o.url });
  }
  Object.values(o).forEach((v) => collectSources(v, out));
}

function stripThinking(s: string): string {
  return s.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

export type Signature = { signer: string; kind: string; text: string; signature: string; matches: boolean };

/**
 * Fetch the TEE signature NEAR AI publishes for a completion and check that it
 * signs exactly the request and response we sent and received.
 */
export async function fetchSignature(c: Completion): Promise<Signature | null> {
  for (let i = 0; i < 4; i++) {
    try {
      const url = `${config.nearAiBase}/signature/${encodeURIComponent(c.id)}?signing_algo=ecdsa`;
      const res = await fetch(url, { headers: headers(), signal: AbortSignal.timeout(10_000) });
      if (res.ok) {
        const s = (await res.json()) as { text?: string; signature?: string; signing_address?: string; signature_kind?: string };
        if (s.text && s.signature && s.signing_address) {
          const matches = s.text.endsWith(`${c.requestHash}:${c.responseHash}`);
          return { signer: s.signing_address, kind: s.signature_kind ?? "unknown", text: s.text, signature: s.signature, matches };
        }
      }
    } catch {
      // retry below
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return null;
}

/** Convert a dollar cost into yoctoNEAR of fuel at the configured NEAR price. */
export function usdToYocto(usd: number): bigint {
  const near = usd / config.nearUsd;
  return BigInt(Math.max(1, Math.round(near * 1e12))) * 10n ** 12n;
}

/** Pull the first JSON object out of a model answer. */
export function parseJson<T>(text: string): T | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}
