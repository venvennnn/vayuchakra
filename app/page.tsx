"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import AboutDialog from "@/components/AboutDialog";
import Intro from "@/components/Intro";
import MapView, { type FlyTarget } from "@/components/MapView";
import PlaceCard, { type AirData, type Loadable, type NearbyData } from "@/components/PlaceCard";
import ReportFlow from "@/components/ReportFlow";
import { COPY, type Lang } from "@/lib/copy";
import { DEFAULT_ZOOM, INDIA_GATE, type LatLng } from "@/lib/geo";
import { ensureAnonymousSession } from "@/lib/supabase/client";

const LOCATION_TIMEOUT_MS = 8000;
const USER_ZOOM = 13;

function getFilerToken(): string {
  try {
    let tok = localStorage.getItem("vc_filer_token");
    if (!tok) {
      tok = crypto.randomUUID();
      localStorage.setItem("vc_filer_token", tok);
    }
    return tok;
  } catch {
    return crypto.randomUUID();
  }
}

export default function Page() {
  const [lang, setLang] = useState<Lang>("en");
  const [docked, setDocked] = useState(false);
  const [locationOff, setLocationOff] = useState(false);
  const [userLoc, setUserLoc] = useState<LatLng | null>(null);
  const [point, setPoint] = useState<LatLng | null>(null);
  const [flyTo, setFlyTo] = useState<FlyTarget | null>(null);
  const [mode, setMode] = useState<"place" | "report">("place");
  const [pinLocked, setPinLocked] = useState(false);
  const [checking, setChecking] = useState(false);
  const [about, setAbout] = useState<{ open: boolean; section: "about" | "how" }>({ open: false, section: "about" });
  const [heatmapOn, setHeatmapOn] = useState(false);
  const [stationsOn, setStationsOn] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [filerToken, setFilerToken] = useState("");
  const [placeName, setPlaceName] = useState<string | null | undefined>(undefined);
  const [air, setAir] = useState<Loadable<AirData>>({ state: "loading" });
  const [nearby, setNearby] = useState<Loadable<NearbyData>>({ state: "loading" });
  const userPicked = useRef(false);
  const seq = useRef(0);
  const t = COPY[lang];

  useEffect(() => {
    setFilerToken(getFilerToken());
    try {
      const saved = localStorage.getItem("vc_lang");
      if (saved === "hi" || saved === "en") setLang(saved);
    } catch {}
    void ensureAnonymousSession();
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
    try {
      localStorage.setItem("vc_lang", lang);
    } catch {}
  }, [lang]);

  const fly = (p: LatLng, zoom?: number) => setFlyTo({ ...p, zoom, seq: ++seq.current });

  const onDock = useCallback(() => {
    setDocked(true);
    let settled = false;
    const fallback = () => {
      if (settled) return;
      settled = true;
      setLocationOff(true);
      if (!userPicked.current) {
        setPoint(INDIA_GATE);
        fly(INDIA_GATE, DEFAULT_ZOOM);
      }
    };
    if (!("geolocation" in navigator)) return fallback();
    const timer = setTimeout(fallback, LOCATION_TIMEOUT_MS);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer);
        settled = true;
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setUserLoc(p);
        setLocationOff(false);
        // A late fix still recentres, unless the visitor already picked a point.
        if (!userPicked.current) {
          setPoint(p);
          fly(p, USER_ZOOM);
        }
      },
      () => {
        clearTimeout(timer);
        fallback();
      },
      { enableHighAccuracy: false, timeout: LOCATION_TIMEOUT_MS, maximumAge: 5 * 60 * 1000 },
    );
  }, []);

  // Place name, live air, and nearby context for the selected point.
  useEffect(() => {
    if (!point) return;
    const ctrl = new AbortController();
    const q = `lat=${point.lat.toFixed(5)}&lng=${point.lng.toFixed(5)}`;
    setPlaceName(undefined);
    setAir({ state: "loading" });
    fetch(`/api/geocode?${q}`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((d: { placeName: string | null }) => setPlaceName(d.placeName ?? null))
      .catch((e) => e.name !== "AbortError" && setPlaceName(null));
    fetch(`/api/air?${q}`, { signal: ctrl.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        const d: AirData = await r.json();
        setAir({ state: "ok", data: d });
      })
      .catch((e) => e.name !== "AbortError" && setAir({ state: "error" }));
    return () => ctrl.abort();
  }, [point]);

  useEffect(() => {
    if (!point || !filerToken) return;
    const ctrl = new AbortController();
    const q = `lat=${point.lat.toFixed(5)}&lng=${point.lng.toFixed(5)}&lang=${lang}&filerToken=${filerToken}`;
    setNearby((n) => (n.state === "ok" ? n : { state: "loading" }));
    fetch(`/api/nearby?${q}`, { signal: ctrl.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        setNearby({ state: "ok", data: await r.json() });
      })
      .catch((e) => e.name !== "AbortError" && setNearby({ state: "error" }));
    return () => ctrl.abort();
  }, [point, lang, filerToken, refreshKey]);

  useEffect(() => {
    setNearby({ state: "loading" });
  }, [point]);

  const onPick = useCallback(
    (p: LatLng) => {
      if (mode === "report" && pinLocked) return;
      userPicked.current = true;
      setPoint(p);
    },
    [mode, pinLocked],
  );

  const closeReport = useCallback(() => {
    setMode("place");
    setPinLocked(false);
    setChecking(false);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (about.open) setAbout((a) => ({ ...a, open: false }));
      else if (mode === "report" && !checking) closeReport();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [about.open, mode, checking, closeReport]);

  const isUser =
    !!userLoc && !!point && Math.abs(userLoc.lat - point.lat) < 1e-9 && Math.abs(userLoc.lng - point.lng) < 1e-9;

  return (
    <main className="app">
      <MapView
        lang={lang}
        visible={docked}
        flyTo={flyTo}
        pin={point}
        onPick={onPick}
        heatmapOn={heatmapOn}
        stationsOn={stationsOn}
        onToggleHeatmap={() => setHeatmapOn((v) => !v)}
        onToggleStations={() => setStationsOn((v) => !v)}
        reportsVersion={refreshKey}
      />

      <Intro lang={lang} onDock={onDock} />

      {docked && (
        <div className="header-actions">
          <button
            type="button"
            className="lang-toggle"
            onClick={() => setLang((l) => (l === "en" ? "hi" : "en"))}
            aria-label={t.langToggleLabel}
          >
            <span className={lang === "en" ? "is-on" : ""}>EN</span>
            <span aria-hidden="true">/</span>
            <span className={lang === "hi" ? "is-on" : ""} lang="hi">
              हिं
            </span>
          </button>
          <button type="button" className="btn-header" onClick={() => setAbout({ open: true, section: "about" })}>
            {t.about}
          </button>
        </div>
      )}

      {docked && locationOff && (
        <p className="banner" role="status">
          {t.locationOff}
        </p>
      )}

      {docked && point && (
        <aside className="card" aria-label={mode === "report" ? t.reportTitle : t.nearYou}>
          <div key={mode} className="card-swap">
            {mode === "place" ? (
              <PlaceCard
                lang={lang}
                point={point}
                isUser={isUser}
                placeName={placeName}
                air={air}
                nearby={nearby}
                heatmapOn={heatmapOn}
                stationsOn={stationsOn}
                onReport={() => setMode("report")}
                onHow={() => setAbout({ open: true, section: "how" })}
              />
            ) : (
              <ReportFlow
                lang={lang}
                point={point}
                placeName={placeName}
                filerToken={filerToken}
                onBack={closeReport}
                onFinished={() => {
                  closeReport();
                  setRefreshKey((k) => k + 1);
                }}
                onLockChange={setPinLocked}
                onBusyChange={setChecking}
              />
            )}
          </div>
        </aside>
      )}

      <AboutDialog
        lang={lang}
        open={about.open}
        section={about.section}
        onClose={() => setAbout((a) => ({ ...a, open: false }))}
      />
    </main>
  );
}
