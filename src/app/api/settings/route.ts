import { NextRequest, NextResponse } from "next/server";
import { allConfig, hasSecret, setConfig, setSecret } from "@/lib/config";

export const runtime = "nodejs";

// Only these keys can be set from the browser. Sensitive values live in SECRET_KEYS
// and are stored encrypted; their raw values are NEVER returned to the client.
const CONFIG_KEYS = [
  "MODEL_PROVIDER",
  "OLLAMA_BASE_URL",
  "OLLAMA_MODEL",
  "RESEARCH_PROVIDER",
  "RESEARCH_MAX_FETCHES",
  "ACTION_MODE",
  "SMTP_HOST",
  "SMTP_USER",
  "SMTP_PORT",
  "SMTP_FROM",
];
const SECRET_KEYS = ["SMTP_PASS"];

// GET — current settings. Config values are returned; secrets return ONLY a
// "set" boolean (+ a mask). The raw secret never leaves the server.
export async function GET() {
  const stored = allConfig();
  const config: Record<string, string> = {};
  for (const k of CONFIG_KEYS) config[k] = stored[k] ?? "";
  const secrets: Record<string, { set: boolean; mask: string }> = {};
  for (const k of SECRET_KEYS) {
    const set = hasSecret(k) || !!process.env[k];
    secrets[k] = { set, mask: set ? "••••••••" : "" };
  }
  return NextResponse.json({ config, secrets });
}

// POST — update settings. Unknown keys are ignored. A secret is only changed
// when a non-empty value is supplied; an explicit empty string clears it.
export async function POST(req: NextRequest) {
  let body: { config?: Record<string, string>; secrets?: Record<string, string> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  for (const [k, v] of Object.entries(body.config || {})) {
    if (CONFIG_KEYS.includes(k) && typeof v === "string") setConfig(k, v.trim());
  }
  for (const [k, v] of Object.entries(body.secrets || {})) {
    if (!SECRET_KEYS.includes(k) || typeof v !== "string") continue;
    // undefined/omitted = leave as-is (handled by not being present); "" = clear.
    setSecret(k, v);
  }

  return NextResponse.json({ ok: true });
}
