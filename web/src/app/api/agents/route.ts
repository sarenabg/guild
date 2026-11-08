import { addAgent } from "@/lib/actions";
import { body, handle, visitor } from "@/lib/http";

export async function POST(req: Request) {
  const b = await body(req);
  const wid = await visitor();
  return handle(() => addAgent(wid, b));
}
