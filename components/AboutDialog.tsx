"use client";

import { useEffect, useRef } from "react";
import { COPY, type Lang } from "@/lib/copy";

type Props = { lang: Lang; open: boolean; section: "about" | "how"; onClose: () => void };

export default function AboutDialog({ lang, open, section, onClose }: Props) {
  const closeBtn = useRef<HTMLButtonElement>(null);
  const howRef = useRef<HTMLElement>(null);
  const returnFocus = useRef<Element | null>(null);
  const t = COPY[lang];

  useEffect(() => {
    if (!open) return;
    returnFocus.current = document.activeElement;
    closeBtn.current?.focus();
    if (section === "how") howRef.current?.scrollIntoView({ block: "start" });
    return () => {
      (returnFocus.current as HTMLElement | null)?.focus?.();
    };
  }, [open, section]);

  if (!open) return null;

  const trapTab = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab") return;
    const nodes = e.currentTarget.querySelectorAll<HTMLElement>("button, a[href]");
    if (!nodes.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="about-title" onKeyDown={trapTab}>
        <div className="dialog-head">
          <h2 id="about-title">{t.aboutTitle}</h2>
          <button ref={closeBtn} type="button" className="btn-close" onClick={onClose} aria-label={t.close}>
            <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
              <path d="M5 5l10 10M15 5 5 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="dialog-body">
          <p>{t.aboutIntro}</p>
          <p className="disclaimer">{t.aboutDisclaimer}</p>

          <section>
            <h3>{t.aboutMapTitle}</h3>
            {t.aboutMap.map((p) => (
              <p key={p}>{p}</p>
            ))}
          </section>

          <section>
            <h3>{t.aboutLiveTitle}</h3>
            {t.aboutLive.map((p) => (
              <p key={p}>{p}</p>
            ))}
          </section>

          <section ref={howRef}>
            <h3>{t.howTitle}</h3>
            {t.howBody.map((p) => (
              <p key={p}>{p}</p>
            ))}
          </section>

          <section>
            <h3>{t.aboutAiTitle}</h3>
            {t.aboutAi.map((p) => (
              <p key={p}>{p}</p>
            ))}
          </section>

          <section>
            <h3>{t.photosTitle}</h3>
            <p>{t.photosBody}</p>
          </section>

          <section>
            <h3>{t.aboutPrivacyTitle}</h3>
            <p>{t.aboutPrivacy}</p>
          </section>

          <section>
            <h3>{t.sourcesTitle}</h3>
            <ul>
              {t.sources.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
