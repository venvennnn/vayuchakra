import { NextResponse, type NextRequest } from "next/server";
import { publishReport, UUID_RE } from "@/lib/reports";
import { supabaseAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Publishes a draft if it has a soft-pass attempt. Idempotent; verify calls the same rule. */
export async function POST(req: NextRequest) {
  if (!supabaseAdmin()) return NextResponse.json({ error: "reports_unavailable" }, { status: 503 });
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }
  const reportId = String(body.reportId ?? "");
  const filerToken = String(body.filerToken ?? "");
  if (!UUID_RE.test(reportId) || !UUID_RE.test(filerToken)) {
    return NextResponse.json({ error: "bad_ids" }, { status: 400 });
  }
  const result = await publishReport(reportId, filerToken);
  if (result.ok) return NextResponse.json(result);
  const status = { not_found: 404, forbidden: 403, not_draft: 409, no_passing_attempt: 422, db_error: 503 }[result.error];
  return NextResponse.json(result, { status });
}
