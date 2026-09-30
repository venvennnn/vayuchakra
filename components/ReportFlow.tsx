"use client";

import { useEffect, useRef, useState } from "react";
import { CLAIMS, type Band, type Claim } from "@/lib/confidence";
import { COPY, type Lang } from "@/lib/copy";
import { formatCoords, type LatLng } from "@/lib/geo";
import { supabaseBrowser } from "@/lib/supabase/client";
import { ReviewBlock, AssessmentPanel, type Review, type Assessment } from "@/components/Checks";

const MAX_BYTES = 8 * 1024 * 1024;
// Vercel caps function request bodies at 4.5 MB; larger photos go straight to Storage.
const DIRECT_LIMIT = 4 * 1024 * 1024;
const ACCEPT = ["image/jpeg", "image/png", "image/webp"];

type VerifyResult = {
  attempt: number;
  attemptsRemaining: number;
  outcome: "retry" | "published" | "rejected";
  reason: string | null;
  message: string;
  confidence: number | null;
  band: Band | null;
  status: string;
  checkerError?: string | null;
  review?: Review | null;
  assessment?: Assessment | null;
};

type Phase = "compose" | "checking" | "retry" | "published" | "rejected";

type Props = {
  lang: Lang;
  point: LatLng;
  placeName: string | null | undefined;
  filerToken: string;
  onBack: () => void;
  onFinished: () => void;
  onLockChange: (locked: boolean) => void;
  onBusyChange: (busy: boolean) => void;
};

export default function ReportFlow(props: Props) {
  const { lang, point, filerToken } = props;
  const t = COPY[lang];
  const [claim, setClaim] = useState<Claim | null>(null);
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [reportId, setReportId] = useState<string | null>(null);
  const [attemptsUsed, setAttemptsUsed] = useState(0);
  const [phase, setPhase] = useState<Phase>("compose");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const { onLockChange, onBusyChange } = props;

  useEffect(() => {
    onLockChange(reportId !== null);
  }, [reportId, onLockChange]);

  useEffect(() => {
    onBusyChange(phase === "checking");
  }, [phase, onBusyChange]);

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const pickFile = (f: File | undefined) => {
    setError(null);
    if (!f) return;
    if (!ACCEPT.includes(f.type)) return setError(t.photoWrongType);
    if (f.size > MAX_BYTES) return setError(t.photoTooBig);
    setFile(f);
    if (phase === "retry") setPhase("compose");
  };

  const ensureDraft = async (): Promise<string | null> => {
    if (reportId) return reportId;
    const res = await fetch("/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filerToken, lat: point.lat, lng: point.lng, claim, note: note.trim(), language: lang }),
    });
    if (res.status === 429) {
      setError(t.rateLimited);
      return null;
    }
    if (!res.ok) {
      setError(t.reportsUnavailable);
      return null;
    }
    const data: { reportId: string } = await res.json();
    setReportId(data.reportId);
    return data.reportId;
  };

  const check = async () => {
    if (!file || !claim) return;
    setError(null);
    setMessage(null);
    setPhase("checking");
    try {
      const id = await ensureDraft();
      if (!id) {
        setPhase("compose");
        return;
      }
      const form = new FormData();
      form.set("reportId", id);
      form.set("filerToken", filerToken);
      const sb = supabaseBrowser();
      if (file.size > DIRECT_LIMIT && sb) {
        const up = await fetch("/api/reports/upload-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reportId: id, filerToken }),
        });
        if (!up.ok) throw new Error("upload_url");
        const { path, token }: { path: string; token: string } = await up.json();
        const { error: upErr } = await sb.storage.from("evidence").uploadToSignedUrl(path, token, file, { contentType: file.type });
        if (upErr) throw upErr;
        form.set("storagePath", path);
      } else {
        form.set("photo", file);
      }
      const res = await fetch("/api/reports/verify", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? (res.status === 503 ? t.reportsUnavailable : t.networkError));
        setPhase("compose");
        return;
      }
      const r = data as VerifyResult;
      setResult(r);
      setAttemptsUsed(3 - r.attemptsRemaining);
      setMessage(r.message);
      if (r.outcome === "retry") {
        setFile(null);
        setPhase("retry");
      } else {
        setPhase(r.outcome);
      }
    } catch {
      setError(t.networkError);
      setPhase("compose");
    }
  };

  const nextAttempt = Math.min(3, attemptsUsed + 1);
  const finished = phase === "published" || phase === "rejected";
  const locked = reportId !== null;

  return (
    <div className="card-body report">
      <div className="report-head">
        <button type="button" className="btn-back" onClick={finished ? props.onFinished : props.onBack} disabled={phase === "checking"}>
          <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
            <path d="M12.5 4.5 7 10l5.5 5.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {t.back}
        </button>
        {attemptsUsed > 0 && !finished && <span className="attempt-count">{t.attemptOf(nextAttempt)}</span>}
      </div>

      <h2 className="place">{t.reportTitle}</h2>
      <p className="coords">
        {props.placeName ? `${props.placeName} · ` : ""}
        {formatCoords(point)}
      </p>
      {locked && !finished && <p className="muted small">{t.pinLocked}</p>}

      {!finished && (
        <>
          <fieldset className="claims" disabled={locked || phase === "checking"}>
            <legend className="section-title">{t.whatType}</legend>
            {CLAIMS.map((c) => (
              <label key={c} className={`chip${claim === c ? " is-on" : ""}`}>
                <input type="radio" name="claim" value={c} checked={claim === c} onChange={() => setClaim(c)} />
                {t.claim[c]}
              </label>
            ))}
          </fieldset>

          <label className="field">
            <span className="section-title">{t.note}</span>
            <textarea
              value={note}
              maxLength={240}
              rows={2}
              placeholder={t.notePlaceholder}
              disabled={locked || phase === "checking"}
              onChange={(e) => setNote(e.target.value.slice(0, 240))}
            />
            <span className="counter">{note.length} / 240</span>
          </label>

          <div className="field">
            <span className="section-title">{t.photo}</span>
            {preview && (
              <div className={`preview${phase === "checking" ? " is-checking" : ""}`}>
                <img src={preview} alt="" />
              </div>
            )}
            <div className="photo-buttons">
              <button type="button" className="btn-secondary" onClick={() => cameraInput.current?.click()} disabled={phase === "checking" || !claim}>
                {phase === "retry" ? t.tryAnother : t.takePhoto}
              </button>
              <button type="button" className="btn-text" onClick={() => fileInput.current?.click()} disabled={phase === "checking" || !claim}>
                {t.chooseFile}
              </button>
            </div>
            <input
              ref={cameraInput}
              type="file"
              accept={ACCEPT.join(",")}
              capture="environment"
              hidden
              onChange={(e) => {
                pickFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <input
              ref={fileInput}
              type="file"
              accept={ACCEPT.join(",")}
              hidden
              onChange={(e) => {
                pickFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </div>
        </>
      )}

      {phase === "retry" && message && result && <AttemptNotice lang={lang} result={result} />}
      {phase === "retry" && result?.review && <ReviewBlock lang={lang} review={result.review} />}
      {phase === "retry" && result?.assessment && (
        <AssessmentPanel lang={lang} assessment={result.assessment} score={result.confidence} />
      )}
      {error && (
        <p className="notice notice-warn" role="alert">
          {error}
        </p>
      )}

      {phase === "checking" && (
        <p className="notice" role="status">
          {t.checking(nextAttempt)}
          <span className="dots" aria-hidden="true" />
        </p>
      )}

      {!finished && (
        <div className="actions">
          <button type="button" className="btn-primary" onClick={check} disabled={!file || !claim || phase === "checking"}>
            {t.checkPhoto}
          </button>
        </div>
      )}

      {finished && result && (
        <div className="outcome" role="status">
          {preview && (
            <div className="preview">
              <img src={preview} alt="" />
            </div>
          )}
          <div className={`notice ${phase === "published" && result.band !== "unverified" ? "notice-ok" : "notice-warn"}`}>
            <p className="notice-title">{phase === "published" ? t.resultPublished : t.resultRejected}</p>
            <p>{message}</p>
          </div>
          {result.confidence !== null && (
            <div className="score-row">
              <div className="score-bar">
                <span style={{ width: `${result.confidence}%` }} className={`band-fill band-${result.band ?? "unverified"}`} />
              </div>
              <span className="score-num">{t.confidenceLine(result.confidence)}</span>
            </div>
          )}
          {result.review && <ReviewBlock lang={lang} review={result.review} />}
          {result.assessment && <AssessmentPanel lang={lang} assessment={result.assessment} score={result.confidence} />}
          {result.checkerError && <p className="muted small">{t.errorCode(result.checkerError)}</p>}
          <div className="actions">
            <button type="button" className="btn-primary" onClick={props.onFinished}>
              {t.done}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function AttemptNotice({ lang, result }: { lang: Lang; result: VerifyResult }) {
  const t = COPY[lang];
  const checkerFailed = result.reason === "gemini_failed";
  return (
    <div className={`notice ${checkerFailed ? "notice-neutral" : "notice-warn"}`} role="status">
      <p className="notice-title">{checkerFailed ? t.checkerTitle : t.refusedTitle}</p>
      <p>{result.message}</p>
      {checkerFailed && result.checkerError && <p className="notice-code">{t.errorCode(result.checkerError)}</p>}
    </div>
  );
}
