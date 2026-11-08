"use client";

import { usePathname } from "next/navigation";
import { useWallet } from "./wallet";

// Demo pages live at /…, Live pages at /live/…. Both use the same screens.

export type Mode = "demo" | "live";

export function useMode(): Mode {
  return usePathname().startsWith("/live") ? "live" : "demo";
}

/** A link inside the current mode. */
export function useTo() {
  const mode = useMode();
  return (path: string) => (mode === "live" ? (path === "/" ? "/live" : `/live${path}`) : path);
}

/** The API address for the current mode (live reads include the connected account). */
export function useApi() {
  const mode = useMode();
  const { account } = useWallet();
  return (path: string) => {
    if (mode === "demo") return `/api${path}`;
    const sep = path.includes("?") ? "&" : "?";
    return `/api/live${path}${account ? `${sep}account=${encodeURIComponent(account)}` : ""}`;
  };
}
