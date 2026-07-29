import { NextRequest } from "next/server";
import type { StreamEvent } from "@/lib/types";
import { ensureRun } from "@/lib/engine/runner";
import { userFromRequest } from "@/lib/auth/session";
import { runWithUser } from "@/lib/auth/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/tasks/[id]/stream — Server-Sent Events. Runs the task (once) and
// streams honest progress. If the task already ran, replays its final state.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = userFromRequest(req);
  if (!user) return new Response("Not authenticated", { status: 401 });
  const { id } = await params;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (event: StreamEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true;
        }
      };
      // keep-alive comment so proxies don't drop the connection
      send({ type: "status", status: "understanding" });
      try {
        // Scope the entire run (and all its DB reads/writes) to this user.
        await runWithUser(user.id, () => ensureRun(id, send));
      } catch (e) {
        send({ type: "error", message: e instanceof Error ? e.message : "stream error" });
      } finally {
        if (!closed) {
          controller.enqueue(encoder.encode(`event: end\ndata: {}\n\n`));
          closed = true;
          controller.close();
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
