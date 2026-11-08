import { worldView } from "@/lib/actions";
import { handle, visitor } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  const wid = await visitor();
  return handle(() => worldView(wid));
}
