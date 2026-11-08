import { refresh, startLive } from "@/lib/live/runner";
import { handle } from "@/lib/http";

/** Called by the page right after a wallet transaction, to pick it up at once. */
export async function POST() {
  return handle(async () => {
    startLive();
    const s = await refresh(true);
    return { at: s.at, error: s.error ?? null };
  });
}
