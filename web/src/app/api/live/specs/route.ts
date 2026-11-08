import { saveSpec } from "@/lib/live/views";
import { body, handle } from "@/lib/http";

export async function POST(req: Request) {
  const b = await body(req);
  return handle(() => saveSpec(b));
}
