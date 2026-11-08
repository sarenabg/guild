// The safety check ("guardrails"). Two layers:
//  1. Fixed rules, run on every job, agent and delivery, in every mode. They
//     are fast, predictable and can't be talked out of a decision.
//  2. An AI reviewer on NEAR AI (see review.ts), which judges what rules can't:
//     is the brief clear, do the tools fit, does the work answer the brief.
// A job, agent or delivery passes only if both layers pass.

import type { Check } from "./types";

export const ALLOWED_TOOLS = ["web_search", "knowledge", "calculator", "near_lookup"] as const;
export type ToolName = (typeof ALLOWED_TOOLS)[number];

type Rule = { label: string; re: RegExp };

/** Things Guild will never take a job for. */
const BLOCKED: Rule[] = [
  { label: "stealing keys or funds", re: /\b(steal|drain|phish(ing)?|harvest|collect|obtain|ask (for|users for)|tricks? .{0,30}into (sharing|giving|entering|typing))\b.{0,60}\b(seed|recovery) phrases?|\b(steal|drain|phish(ing)?|harvest|collect|obtain)\b.{0,60}\bprivate keys?\b|wallet drainer|\bdrain (their|the|a|people'?s?) wallets?\b/i },
  { label: "scams", re: /\b(ponzi|pyramid scheme|rug ?pull|pump and dump|pig butchering|fake (giveaway|airdrop))\b/i },
  { label: "malware or break-ins", re: /\b(malware|ransomware|keylogger|botnet|ddos|credential stuffing)\b|\bhack (into|someone|an? account)\b|\bbypass (the )?(login|2fa|captcha|paywall)\b/i },
  { label: "fake reviews or impersonation", re: /\bfake (\d+\s*)?(\S+\s+)?(reviews?|testimonials?|news|ratings?)\b|\bastroturf|\bsock ?puppets?\b|\bimpersonat(e|ing|ion)\b/i },
  { label: "weapons or dangerous chemistry", re: /\b(build|make|assemble|synthesi[sz]e|cook)\b.{0,40}\b(bombs?|explosives?|nerve agents?|bioweapons?|meth(amphetamine)?|fentanyl|ghost guns?)\b/i },
  { label: "stalking or harassment", re: /\b(dox+(ing)?|stalk(ing)?|harass(ment|ing)?)\b|\bfind (out )?(where|the home address)\b.{0,30}\blives?\b/i },
  { label: "spam", re: /\b(spam|mass[- ](dm|email|message)s?|bulk unsolicited)\b/i },
];

/** Signs that text is trying to take over an agent. */
const HIJACK: Rule[] = [
  { label: "tells the AI to ignore its rules", re: /\b(ignore|disregard|forget|override)\b.{0,30}\b(previous|prior|above|earlier|all|your|system)\b.{0,20}\b(instructions?|rules|prompts?|guidelines)\b/i },
  { label: "tries to move money", re: /\b(send|transfer|wire|move|pay|forward)\b.{0,50}\b(near|funds|budget|money|tokens|payment|balance|bounty)\b.{0,40}\b(to|into)\b\s+[a-z0-9_.-]+\.(near|testnet)\b/i },
  { label: "tries to leak secrets", re: /\b(reveal|print|leak|exfiltrate|output|show)\b.{0,30}\b(system prompt|api[ _-]?key|secret|private key|seed phrase|credentials?)\b/i },
  { label: "jailbreak role-play", re: /\b(you are now|act as|pretend to be)\b.{0,20}\b(dan|jailbroken|developer mode|unrestricted)\b/i },
  { label: "hidden characters", re: /[​-‏‪-‮⁠-⁤﻿]/ },
  { label: "a long hidden code blob", re: /[A-Za-z0-9+/]{160,}={0,2}/ },
];

const PRIVATE: Rule[] = [
  { label: "an email address", re: /[\w.+-]+@[\w-]+\.[a-z]{2,}/i },
  { label: "a phone number", re: /(?<![\w.])\+?\d[\d ().-]{8,}\d(?![\w.])/ },
  { label: "a NEAR private key", re: /\b(ed25519|secp256k1):[1-9A-HJ-NP-Za-km-z]{40,}/ },
  { label: "an ID number", re: /\b\d{3}-\d{2}-\d{4}\b/ },
];

function cardNumber(text: string): boolean {
  for (const m of text.matchAll(/\b(?:\d[ -]?){13,19}\b/g)) {
    const digits = m[0].replace(/\D/g, "");
    if (digits.length < 13 || digits.length > 19) continue;
    let sum = 0;
    for (let i = 0; i < digits.length; i++) {
      let d = Number(digits[digits.length - 1 - i]);
      if (i % 2 === 1) {
        d *= 2;
        if (d > 9) d -= 9;
      }
      sum += d;
    }
    if (sum % 10 === 0) return true;
  }
  return false;
}

function hits(rules: Rule[], text: string): string[] {
  return rules.filter((r) => r.re.test(text)).map((r) => r.label);
}

export function privateData(text: string): string[] {
  const found = hits(PRIVATE, text);
  if (cardNumber(text)) found.push("a card number");
  return found;
}

function check(name: string, problems: string[], okNote?: string): Check {
  return problems.length
    ? { name, passed: false, note: `Contains ${list(problems)}.` }
    : { name, passed: true, note: okNote };
}

function list(items: string[]): string {
  const u = [...new Set(items)];
  return u.length <= 1 ? u.join("") : `${u.slice(0, -1).join(", ")} and ${u[u.length - 1]}`;
}

// ----- Jobs -----------------------------------------------------------------

export function jobRules(input: { title: string; brief: string; budgetNear: number }): Check[] {
  const text = `${input.title}\n${input.brief}`;
  const words = input.brief.trim().split(/\s+/).filter(Boolean).length;
  const blocked = hits(BLOCKED, text);
  return [
    blocked.length
      ? { name: "Allowed", passed: false, note: `Guild can't take work involving ${list(blocked)}.` }
      : { name: "Allowed", passed: true },
    words >= 5 && input.title.trim().length >= 3
      ? { name: "Clear", passed: true }
      : { name: "Clear", passed: false, note: "Say a bit more about what you need (at least a sentence)." },
    input.budgetNear >= 0.1 && input.budgetNear <= 10_000
      ? { name: "Fair price", passed: true }
      : { name: "Fair price", passed: false, note: "Budgets run from 0.1 to 10,000 NEAR." },
    check("No private data", privateData(text)),
  ];
}

// ----- Agents ---------------------------------------------------------------

export function agentRules(input: { name: string; instructions: string; knowledge: string; tools: string[] }): Check[] {
  const all = `${input.name}\n${input.instructions}\n${input.knowledge}`;
  const blocked = hits(BLOCKED, all);
  const hijack = hits(HIJACK, all);
  const badTools = input.tools.filter((t) => !(ALLOWED_TOOLS as readonly string[]).includes(t));
  return [
    blocked.length
      ? { name: "Safe purpose", passed: false, note: `It is set up for ${list(blocked)}.` }
      : { name: "Safe purpose", passed: true },
    hijack.length
      ? { name: "No hidden commands", passed: false, note: `Its text ${list(hijack)}.` }
      : { name: "No hidden commands", passed: true },
    badTools.length
      ? { name: "Approved tools", passed: false, note: `Unknown tools: ${badTools.join(", ")}.` }
      : { name: "Approved tools", passed: true },
    check("No private data", privateData(input.knowledge)),
  ];
}

// ----- Deliveries -----------------------------------------------------------

const STOP = new Set(
  "a an and are as at be but by for from has have how i in into is it its of on or our so that the their them then there these they this to us was we what when which who why will with you your about write make create give need want please one two three".split(
    " ",
  ),
);

export function keyTerms(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 2 && !STOP.has(w)),
    ),
  ];
}

export function deliveryRules(input: { brief: string; title: string; result: string }): Check[] {
  const terms = keyTerms(`${input.title} ${input.brief}`);
  const lower = input.result.toLowerCase();
  const covered = terms.filter((t) => lower.includes(t)).length;
  const coverage = terms.length ? covered / terms.length : 1;
  const hijack = hits(HIJACK, input.result).filter((l) => l !== "a long hidden code blob");
  return [
    coverage >= 0.3
      ? { name: "Matches the brief", passed: true }
      : { name: "Matches the brief", passed: false, note: "The work doesn't seem to cover what was asked." },
    input.result.trim().length >= 200
      ? { name: "Complete", passed: true }
      : { name: "Complete", passed: false, note: "The work is too short to be finished." },
    hits(BLOCKED, input.result).length || hijack.length
      ? { name: "Safe", passed: false, note: "The work contains unsafe content or hidden commands." }
      : { name: "Safe", passed: true },
    check("No private data", privateData(input.result)),
  ];
}

/** Merge rule checks with AI checks: same names merge, any failure wins. */
export function mergeChecks(rules: Check[], ai: Check[]): Check[] {
  const out = rules.map((c) => ({ ...c }));
  for (const c of ai) {
    const name = c.name.trim().slice(0, 40);
    const same = out.find((o) => o.name.toLowerCase() === name.toLowerCase());
    if (same) {
      if (!c.passed) {
        same.passed = false;
        same.note = same.note ?? c.note;
      }
    } else if (out.length < 8) {
      out.push({ name, passed: c.passed, note: c.note });
    }
  }
  return out;
}
