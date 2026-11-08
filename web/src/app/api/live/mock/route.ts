import { config } from "@/lib/config";
import { mockCall, resetMock } from "@/lib/live/mock-chain";
import { refresh } from "@/lib/live/runner";
import { body, handle } from "@/lib/http";
import { InputError } from "@/lib/actions";

/**
 * Practice chain only (GUILD_LIVE_MOCK=1): the pretend wallet signs a call here.
 * Body: { signer, method, args, deposit (yoctoNEAR string) } or { reset: true }.
 */
export async function POST(req: Request) {
  const b = await body(req);
  return handle(async () => {
    if (!config.liveMock) return null;
    if (b.reset) {
      resetMock();
      return { ok: true };
    }
    const signer = String(b.signer ?? "");
    if (!/^[a-z0-9._-]{2,64}$/.test(signer)) throw new InputError("signer is required");
    let value: unknown;
    try {
      value = mockCall(signer, String(b.method), (b.args as Record<string, unknown>) ?? {}, BigInt(String(b.deposit ?? "0")));
    } catch (e) {
      throw new InputError((e as Error).message);
    }
    await refresh(true);
    return { value };
  });
}
