import { reset } from "@/lib/actions";
import { handle, visitor } from "@/lib/http";

export async function POST() {
  const wid = await visitor();
  return handle(() => reset(wid));
}
