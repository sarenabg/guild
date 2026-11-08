// The demo AI. Used when no NEAR AI key is set, so the whole flow can be tried
// without any account. Example jobs get hand-written sample work; any other
// job gets a clearly labelled outline built from its brief.

import type { Skill } from "./types";
import { SAMPLE_JOBS } from "./samples";

type Ctx = {
  title: string;
  brief: string;
  skill: Skill;
  agentName: string;
  previous: { agent: string; skill: Skill; text: string }[];
  toolNotes: string[];
};

const S: Record<string, Partial<Record<"first" | "write" | "check", string>>> = {
  wallets: {
    first: `Notes for the guide (3 wallets that suit a first-time user):

- **Meteor Wallet**: browser extension and phone app. Setup about 2 minutes. Shows a clear preview before you approve anything.
- **HOT Wallet**: lives inside Telegram, so there is nothing new to install. Setup about 1 minute. Easiest start for people already on Telegram.
- **MyNearWallet**: works in any web browser. Setup about 3 minutes. Good on a shared or work computer where you can't install apps.
- **Fees**: a normal NEAR transfer costs a fraction of a cent, whatever the wallet.
- **Safety basics**: each wallet gives you a recovery phrase. Write it on paper and never type it into a website or chat.`,
    write: `# Your first NEAR wallet: 3 good choices

A wallet is an app that holds your NEAR and lets you approve payments. All three below are free and take a few minutes to set up.

## Meteor Wallet
A browser extension and phone app. **Setup: about 2 minutes.** Before you approve anything, it shows a clear summary of what will happen.

## HOT Wallet
Opens inside Telegram, so there's nothing new to install. **Setup: about 1 minute.** The quickest start if you already use Telegram.

## MyNearWallet
Runs in any web browser. **Setup: about 3 minutes.** Handy on a computer where you can't install apps.

## Fees
Sending NEAR costs a fraction of a cent in every wallet.

## Staying safe
Each wallet gives you a recovery phrase: a list of words that can restore your wallet. Write it on paper. Never type it into a website, email or chat.

## Our pick
**Start with HOT Wallet if you use Telegram, otherwise Meteor Wallet.**`,
    check: `# Your first NEAR wallet: 3 good choices

A wallet is an app that holds your NEAR and lets you approve payments. All three below are free and take only a few minutes to set up.

| Wallet | Where it runs | Setup |
|---|---|---|
| Meteor Wallet | Browser extension, phone | ~2 min |
| HOT Wallet | Inside Telegram | ~1 min |
| MyNearWallet | Any web browser | ~3 min |

## Meteor Wallet
Shows a plain summary before you approve anything, which helps you avoid mistakes.

## HOT Wallet
Nothing new to install if you already use Telegram. The quickest way to get started.

## MyNearWallet
Works in any browser, so it's handy on a computer where you can't install apps.

## Fees
A normal NEAR transfer costs a fraction of a cent, whichever wallet you pick.

## Staying safe
Your wallet gives you a recovery phrase. Write it on paper and keep it private. No real company will ever ask for it.

## Our pick
**Use HOT Wallet if you're on Telegram. Otherwise, Meteor Wallet.**

_Checked: setup times, fees and the safety advice match the research notes. The brief's three asks (setup, safety, fees) and the recommendation are all covered._`,
  },
  freelancer: {
    first: `Cost of sending 500 USD to a freelancer abroad (typical figures, rounded):

- **Bank transfer (SWIFT)**: about 25 USD sending fee plus ~3% currency markup. 500 × 0.03 + 25 = **40 USD**. Arrives in 2–5 working days.
- **PayPal**: about 5% for an international payment plus ~3.5% currency markup. 500 × 0.085 = **42.5 USD**. Arrives within minutes, but the freelancer may wait 1–3 days to withdraw.
- **Stablecoins (USDC on NEAR)**: network fee is under 0.01 USD. Turning USDC into local money at an exchange costs about 1%. 500 × 0.01 = **5 USD**. Arrives in seconds.`,
    write: `# Paying a freelancer abroad: what 500 USD really costs

| Method | Cost | Arrives |
|---|---|---|
| Bank transfer | ~40 USD | 2–5 working days |
| PayPal | ~42.50 USD | Minutes (1–3 days to withdraw) |
| USDC on NEAR | ~5 USD | Seconds |

## Bank transfer
A fixed sending fee (about 25 USD) plus a hidden currency markup of around 3%.

## PayPal
Fast to send, but international fees and currency conversion add up to about 8.5%.

## Stablecoins on NEAR
USDC is a digital dollar. Sending it on NEAR costs under a cent. The freelancer pays about 1% to turn it into local money at an exchange.

## Bottom line
For 500 USD, **USDC on NEAR is about 8 times cheaper and by far the fastest**, as long as the freelancer can use an exchange in their country.`,
    check: `# Paying a freelancer abroad: what 500 USD really costs

| Method | Cost | Arrives |
|---|---|---|
| Bank transfer | ~40 USD | 2–5 working days |
| PayPal | ~42.50 USD | Minutes (1–3 days to withdraw) |
| USDC on NEAR | ~5 USD | Seconds |

## Bank transfer
About 25 USD to send, plus a currency markup of around 3% (15 USD on 500).

## PayPal
Sending is quick, but the international fee (~5%) and conversion (~3.5%) add up to about 42.50 USD.

## Stablecoins on NEAR
USDC is a digital dollar. A transfer on NEAR costs under a cent. The freelancer then pays about 1% (5 USD) to turn it into local money.

## Bottom line
For 500 USD, **USDC on NEAR costs about 5 USD versus about 40 USD, and arrives in seconds.** It's the best choice when the freelancer can use an exchange locally. If not, a bank transfer is the safest fallback.

_Checked with the calculator: 500 × 0.03 + 25 = 40, 500 × 0.085 = 42.5, 500 × 0.01 = 5. Fees are typical figures and vary by bank and country._`,
  },
  cafe: {
    first: `Ideas for the café's posts:

- Lead with the everyday moment: coffee, croissant, tap to pay.
- Mention it's optional: cards and cash still welcome.
- Keep it local: "your neighbourhood café".
- Avoid price predictions or "to the moon" language.
- One post can explain how: show the QR at the till, pay from your phone.`,
    write: `**1.** Your usual flat white, now payable in crypto. Cards and cash still welcome. ☕

**2.** New at the counter: scan, pay from your crypto wallet, done. Same coffee, same smile.

**3.** We tried it so you don't have to worry: paying with crypto here takes about ten seconds.

**4.** Crypto curious? Come by on a quiet morning and we'll show you how it works over a coffee.

**5.** Your neighbourhood café, now open to one more way to pay. See you soon.`,
    check: `**1.** Your usual flat white, now payable in crypto. Cards and cash are still welcome. ☕

**2.** New at the counter: scan the code, pay from your crypto wallet, done. Same coffee, same smile.

**3.** Paying with crypto here takes about ten seconds. We timed it.

**4.** Crypto curious? Drop by on a quiet morning and we'll walk you through it over a coffee.

**5.** Your neighbourhood café now takes one more way to pay. See you soon. 👋

_Checked: five posts, friendly tone, no hype or price talk, at most one emoji each._`,
  },
};

function sampleKey(title: string): string | null {
  return SAMPLE_JOBS.find((s) => !s.bad && s.title === title)?.key ?? null;
}

function slot(skill: Skill, isFirst: boolean): "first" | "write" | "check" {
  if (skill === "check") return "check";
  if (isFirst && (skill === "research" || skill === "analyze")) return "first";
  return "write";
}

export function demoWork(ctx: Ctx): string {
  const key = sampleKey(ctx.title);
  const which = slot(ctx.skill, ctx.previous.length === 0);
  if (key && S[key]?.[which]) return S[key][which]!;
  return generic(ctx, which);
}

function generic(ctx: Ctx, which: "first" | "write" | "check"): string {
  const notes = ctx.toolNotes.length ? `\n\nFrom my tools:\n${ctx.toolNotes.map((n) => `- ${n}`).join("\n")}` : "";
  const points = ctx.brief
    .split(/(?<=[.!?])\s+|,\s+and\s+|;\s+/)
    .map((s) => s.trim().replace(/[.!?]$/, ""))
    .filter((s) => s.length > 4)
    .slice(0, 5);
  if (which === "first") {
    return `Notes for "${ctx.title}":\n\n${points.map((p) => `- What's needed: ${p}.`).join("\n")}${notes}\n\n_Demo AI: add a NEAR AI key to get real research._`;
  }
  const body = `# ${ctx.title}\n\n${points.map((p, i) => `## ${i + 1}. ${cap(p)}\n${cap(p)}: this section answers that part of the brief in plain words.`).join("\n\n")}${notes}`;
  if (which === "check") {
    return `${body}\n\n_Checked against the brief: ${points.length} parts covered. Demo AI: add a NEAR AI key for real answers._`;
  }
  return `${body}\n\n_Demo AI draft._`;
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
