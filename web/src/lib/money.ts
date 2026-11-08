// NEAR amounts are kept as yoctoNEAR strings (1 NEAR = 10^24 yocto), like the contract.

export const YOCTO = 10n ** 24n;
export const MILLI = 10n ** 21n;
export const BPS = 10_000n;

export function near(n: number | string): bigint {
  const s = typeof n === "number" ? n.toFixed(6) : n;
  const [whole, frac = ""] = s.split(".");
  return BigInt(whole || "0") * YOCTO + BigInt((frac + "0".repeat(24)).slice(0, 24));
}

export function toNear(yocto: string | bigint): number {
  const v = typeof yocto === "bigint" ? yocto : BigInt(yocto || "0");
  return Number(v / 10n ** 18n) / 1e6;
}

/** "12", "0.42", "0.0031": short and readable, never scientific. */
export function fmtNear(yocto: string | bigint, digits?: number): string {
  const n = toNear(yocto);
  if (n === 0) return "0";
  const d = digits ?? (n >= 100 ? 0 : n >= 1 ? 2 : n >= 0.01 ? 3 : 5);
  return n.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: 0 });
}

export function add(a: string, b: bigint | string): string {
  return (BigInt(a) + BigInt(b)).toString();
}
export function sub(a: string, b: bigint | string): string {
  return (BigInt(a) - BigInt(b)).toString();
}
