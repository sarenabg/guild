import { liveConfig } from "@/lib/live/views";
import { handle } from "@/lib/http";

export const dynamic = "force-dynamic";

export function GET() {
  return handle(() => liveConfig());
}
