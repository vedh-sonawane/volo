import { NextRequest, NextResponse } from "next/server";
import { resolveModel } from "@/lib/providers/model";
import { refineObjective } from "@/lib/engine/refine";

export const runtime = "nodejs";

// POST /api/refine { objective } — return a clearer rewrite of the user's prompt.
// Stateless: the client shows the result for review before applying it. Refining
// needs a connected model; without one, Volo says so honestly (never fabricates).
export async function POST(req: NextRequest) {
  let body: { objective?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  const objective = (body.objective || "").trim();
  if (objective.length < 4) {
    return NextResponse.json({ ok: false, error: "Nothing to refine yet — write a few words first." }, { status: 400 });
  }

  const model = await resolveModel();
  if (!(await model.available())) {
    return NextResponse.json({ ok: false, error: "Refine needs a connected AI model (Ollama). Connect one in Settings, then try again." });
  }
  const refined = await refineObjective(objective, model);
  if (!refined) {
    return NextResponse.json({ ok: false, error: "Couldn't produce a clean rewrite just now — your prompt is unchanged." });
  }
  return NextResponse.json({ ok: true, refined });
}
