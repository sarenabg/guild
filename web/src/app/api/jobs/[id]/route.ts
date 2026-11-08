import { jobAction, jobView } from "@/lib/actions";
import { body, handle, visitor } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const wid = await visitor();
  return handle(() => jobView(wid, Number(id)));
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = await body(req);
  const wid = await visitor();
  return handle(() => jobAction(wid, Number(id), b));
}
