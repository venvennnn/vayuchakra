"use client";

import { COPY, type Lang } from "@/lib/copy";
import { SCORE_WEIGHTS, type ScoreParts } from "@/lib/confidence";
import type { Check } from "@/lib/reportChecks";

export type BriefView = {
  happened: string;
  where: string;
  evidence: string[];
  exposed: string;
  action: string;
  uncertainty: string;
  model?: string;
};

export type Review = {
  description: string;
  observations: string[];
  visible: string | null;
  checks: Check[];
  contradictions?: string[];
};

export type Assessment = {
  model: string;
  liveLabel: string;
  parts: ScoreParts;
  combined?: { best: number; bonus: number; penalty: number } | null;
  brief: BriefView | null;
};

const ICON: Record<Check["status"], string> = {
  pass: "M5 10.5 8.5 14 15 6.5",
  fail: "M6 6l8 8M14 6l-8 8",
  warn: "M10 5.5v5.5M10 14.2v.3",
  info: "M10 9v5M10 6.2v.3",
};

export function CheckIcon({ status }: { status: Check["status"] }) {
  return (
    <span className={`check-icon check-${status}`} aria-hidden="true">
      <svg viewBox="0 0 20 20" width="12" height="12">
        <path d={ICON[status]} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

export function ReviewBlock({ lang, review, compact = false }: { lang: Lang; review: Review; compact?: boolean }) {
  const t = COPY[lang];
  const hasText = review.description || review.observations.length > 0 || (review.contradictions && review.contradictions.length > 0);
  return (
    <div className={`review${compact ? " is-compact" : ""}`}>
      {hasText && (
        <div className="review-saw">
          <p className="review-label">
            {t.checkerSaw}
            {review.visible && review.visible !== "unclear" && <span className="review-visible">{t.visibleLabel[review.visible]}</span>}
          </p>
          {review.description && <p className="review-desc">{review.description}</p>}
          {review.observations.length > 0 && (
            <ul className="review-obs">
              {review.observations.map((o, i) => (
                <li key={i}>{o}</li>
              ))}
            </ul>
          )}
          {review.contradictions && review.contradictions.length > 0 && (
            <div className="contradictions">
              <p className="review-label">{t.contradictionsTitle}</p>
              <ul className="review-obs">
                {review.contradictions.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {review.checks.length > 0 && (
        <>
          {!compact && <p className="review-label">{t.checksTitle}</p>}
          <ul className="checks">
            {review.checks.map((c) => (
              <li key={c.key} className={`check is-${c.status}`}>
                <CheckIcon status={c.status} />
                <span className="check-name">{t.checkLabel[c.key]}</span>
                <span className="check-value">{t.checkValue(c.key, c.status, c.value)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

const WEIGHT_LABEL: Record<keyof ScoreParts, "weightQuality" | "weightEvent" | "weightLocation" | "weightSensor" | "weightReport"> = {
  quality: "weightQuality",
  event: "weightEvent",
  location: "weightLocation",
  sensor: "weightSensor",
  report: "weightReport",
};

export function AssessmentPanel({
  lang,
  assessment,
  score,
}: {
  lang: Lang;
  assessment: Assessment;
  score: number | null;
}) {
  const t = COPY[lang];
  return (
    <div className="assessment">
      <p className="live-badge">{t.verifiedLive(assessment.liveLabel)}</p>
      <details className="assess-details" open>
        <summary>{t.howAssessed}</summary>
        <p className="source-note">{t.scoreBreakdown}</p>
        {assessment.combined && (assessment.combined.bonus > 0 || assessment.combined.penalty > 0) && (
          <p className="source-note">{t.combineLine(assessment.combined.best, assessment.combined.bonus, assessment.combined.penalty)}</p>
        )}
        <ul className="score-parts">
          {(Object.keys(SCORE_WEIGHTS) as (keyof ScoreParts)[]).map((k) => (
            <li key={k}>
              <span className="part-label">{t[WEIGHT_LABEL[k]]}</span>
              <span className="part-bar">
                <i style={{ width: `${Math.min(100, (assessment.parts[k] / SCORE_WEIGHTS[k]) * 100)}%` }} />
              </span>
              <span className="part-n">{Math.round(assessment.parts[k])}/{SCORE_WEIGHTS[k]}</span>
            </li>
          ))}
        </ul>
        {score !== null && <p className="score-total">{t.confidenceLine(score)}</p>}
      </details>
      {assessment.brief && <BriefCard lang={lang} brief={assessment.brief} />}
    </div>
  );
}

export function BriefCard({ lang, brief }: { lang: Lang; brief: BriefView }) {
  const t = COPY[lang];
  return (
    <section className="brief">
      <h3 className="section-title">{t.briefTitle}</h3>
      <p className="brief-lead">{brief.happened}</p>
      {brief.where && (
        <p>
          <strong>{t.briefWhere}. </strong>
          {brief.where}
        </p>
      )}
      {brief.evidence.length > 0 && (
        <>
          <p className="review-label">{t.briefEvidence}</p>
          <ul className="review-obs">
            {brief.evidence.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </>
      )}
      {brief.exposed && (
        <p>
          <strong>{t.briefExposed}. </strong>
          {brief.exposed}
        </p>
      )}
      {brief.action && (
        <p>
          <strong>{t.briefAction}. </strong>
          {brief.action}
        </p>
      )}
      {brief.uncertainty && (
        <p className="source-note">
          <strong>{t.briefUncertainty}. </strong>
          {brief.uncertainty}
        </p>
      )}
    </section>
  );
}
