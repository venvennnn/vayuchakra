import { NextResponse, type NextRequest } from "next/server";
import { UUID_RE } from "@/lib/reports";
import { EVIDENCE_BUCKET, supabaseAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Issues a signed upload URL for the next attempt's image. Used for photos above Vercel's
 * 4.5 MB request-body limit: the browser uploads straight to the private bucket, then calls
 * /api/reports/verify with storagePath instead of the file.
 */
export async function POST(req: NextRequest) {
  const sb = supabaseAdmin();
  if (!sb) return NextResponse.json({ error: "reports_unavailable" }, { status: 503 });
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
  const { data: report } = await sb
    .from("reports")
    .select("id, status, filer_token, attempts_used")
    .eq("id", reportId)
    .maybeSingle();
  if (!report) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (report.filer_token !== filerToken) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (report.status !== "draft" || report.attempts_used >= 3) {
    return NextResponse.json({ error: "not_draft" }, { status: 409 });
  }
  const path = `${report.id}/${report.attempts_used + 1}.jpg`;
  const { data, error } = await sb.storage.from(EVIDENCE_BUCKET).createSignedUploadUrl(path, { upsert: true });
  if (error || !data) return NextResponse.json({ error: "upload_unavailable" }, { status: 503 });
  return NextResponse.json({ path, token: data.token });
}
