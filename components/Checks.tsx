"use client";

import { COPY, type Lang } from "@/lib/copy";
import type { Check } from "@/lib/reportChecks";

export type Review = { description: string; observations: string[]; visible: string | null; checks: Check[] };

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
  const hasText = review.description || review.observations.length > 0;
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
