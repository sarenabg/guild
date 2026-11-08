import { liveWorldView } from "@/lib/live/views";
import { accountParam, handle } from "@/lib/http";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return handle(() => liveWorldView(accountParam(req)));
}
