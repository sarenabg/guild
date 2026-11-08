import { liveAgentView } from "@/lib/live/views";
import { accountParam, handle } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(() => liveAgentView(id, accountParam(req)));
}
