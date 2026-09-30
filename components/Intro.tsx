"use client";

import { useEffect, useRef, useState } from "react";
import { COPY, type Lang } from "@/lib/copy";

const TITLE = "Project Vayuchakra";
const CHAR_MS = 150;
const HOLD_MS = 400;
const ELLIPSIS_MS = 3000;
const ELLIPSIS_STEP_MS = 400;
const SESSION_KEY = "vc_intro_done";

type Phase = "typing" | "ellipsis" | "docked";

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * The wordmark. Types itself once per session, shows an animated ellipsis, then docks
 * top-left and calls onDock — the caller requests geolocation in that same turn.
 */
export default function Intro({ lang, onDock }: { lang: Lang; onDock: () => void }) {
  const [phase, setPhase] = useState<Phase | null>(null);
  const [typed, setTyped] = useState(0);
  const [dots, setDots] = useState(1);
  const [soundOn, setSoundOn] = useState(false);
  const audio = useRef<AudioContext | null>(null);
  const soundRef = useRef(false);
  const docked = useRef(false);
  const onDockRef = useRef(onDock);
  onDockRef.current = onDock;

  const dock = () => {
    if (docked.current) return;
    docked.current = true;
    try {
      sessionStorage.setItem(SESSION_KEY, "1");
    } catch {}
    setPhase("docked");
    onDockRef.current();
  };

  useEffect(() => {
    let skip = prefersReducedMotion();
    try {
      skip ||= sessionStorage.getItem(SESSION_KEY) === "1";
    } catch {}
    if (skip) {
      setTyped(TITLE.length);
      dock();
    } else {
      setPhase("typing");
    }
  }, []);

  useEffect(() => {
    if (phase !== "typing") return;
    if (typed >= TITLE.length) {
      const t = setTimeout(() => setPhase("ellipsis"), HOLD_MS);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => {
      setTyped((n) => n + 1);
      if (soundRef.current && TITLE[typed] !== " ") tick(audio.current);
    }, CHAR_MS);
    return () => clearTimeout(t);
  }, [phase, typed]);

  useEffect(() => {
    if (phase !== "ellipsis") return;
    const step = setInterval(() => setDots((d) => (d % 3) + 1), ELLIPSIS_STEP_MS);
    const done = setTimeout(dock, ELLIPSIS_MS);
    return () => {
      clearInterval(step);
      clearTimeout(done);
    };
  }, [phase]);

  const enableSound = () => {
    try {
      audio.current ??= new AudioContext();
      void audio.current.resume();
      soundRef.current = true;
      setSoundOn(true);
    } catch {}
  };

  const isDocked = phase === "docked";
  const t = COPY[lang];

  return (
    <>
      <div className={`intro-veil${isDocked ? " is-gone" : ""}`} aria-hidden={isDocked} />
      <h1 className={`wordmark${isDocked ? " is-docked" : ""}`} aria-label={TITLE}>
        <span aria-hidden="true">{TITLE.slice(0, typed)}</span>
        {phase === "typing" && <span className="type-caret" aria-hidden="true" />}
        {phase === "ellipsis" && (
          <span className="type-ellipsis" aria-hidden="true">
            {".".repeat(dots)}
          </span>
        )}
      </h1>
      {(phase === "typing" || phase === "ellipsis") && (
        <button type="button" className="intro-sound" onClick={enableSound} disabled={soundOn}>
          {soundOn ? t.soundOn : t.enableSound}
        </button>
      )}
    </>
  );
}

function tick(ctx: AudioContext | null) {
  if (!ctx) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = 880;
  gain.gain.setValueAtTime(0.04, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.028);
  osc.connect(gain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.028);
}
