"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import AboutDialog from "@/components/AboutDialog";
import Intro from "@/components/Intro";
import MapView, { type Basemap, type FlyTarget, type LayerKey, type Layers, type LayerStatus } from "@/components/MapView";
import { CityTab, InsightTab, NewsTab, ReportsTab, type CityData, type FeedData } from "@/components/PanelTabs";
import PlaceCard, { type AirData, type Loadable, type NearbyData, type NewsData } from "@/components/PlaceCard";
import ReportFlow from "@/components/ReportFlow";
import { COPY, type Lang, type PanelTab } from "@/lib/copy";
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
  const [basemap, setBasemap] = useState<Basemap>("satellite");
  const [layers, setLayers] = useState<Layers>({ aqi: true, stations: true, fires: true, reports: true });
  const [status, setStatus] = useState<LayerStatus | null>(null);
  const [news, setNews] = useState<Loadable<NewsData>>({ state: "loading" });
  const [refreshKey, setRefreshKey] = useState(0);
  const [filerToken, setFilerToken] = useState("");
  const [placeName, setPlaceName] = useState<string | null | undefined>(undefined);
  const [air, setAir] = useState<Loadable<AirData>>({ state: "loading" });
  const [nearby, setNearby] = useState<Loadable<NearbyData>>({ state: "loading" });
  const [tab, setTab] = useState<PanelTab>("overview");
  const [wide, setWide] = useState(false);
  const [city, setCity] = useState<Loadable<CityData>>({ state: "loading" });
  const [feed, setFeed] = useState<Loadable<FeedData>>({ state: "loading" });
  const [focusReport, setFocusReport] = useState<string | null>(null);
  const cardRef = useRef<HTMLElement>(null);
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
    fetch("/api/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus({ googleHeatmap: false, stations: false, fires: false, news: false, insight: false }));
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

  // News and the Gemini explanation are slower, so they load after the reading.
  useEffect(() => {
    if (!point) return;
    const ctrl = new AbortController();
    setNews({ state: "loading" });
    const timer = setTimeout(() => {
      fetch(`/api/news?lat=${point.lat.toFixed(4)}&lng=${point.lng.toFixed(4)}&lang=${lang}`, { signal: ctrl.signal })
        .then(async (r) => {
          if (!r.ok) throw new Error(String(r.status));
          setNews({ state: "ok", data: await r.json() });
        })
        .catch((e) => e.name !== "AbortError" && setNews({ state: "error" }));
    }, 400);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [point, lang]);

  // City stats and the report feed load only when their tab is open, once per point.
  const cityFor = useRef<string | null>(null);
  const feedFor = useRef<string | null>(null);
  const pointKey = point ? `${point.lat.toFixed(4)},${point.lng.toFixed(4)}` : null;
  useEffect(() => {
    if (!point || !pointKey || tab !== "city" || cityFor.current === pointKey) return;
    cityFor.current = pointKey;
    setCity({ state: "loading" });
    fetch(`/api/city?lat=${point.lat.toFixed(5)}&lng=${point.lng.toFixed(5)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        setCity({ state: "ok", data: await r.json() });
      })
      .catch(() => {
        cityFor.current = null;
        setCity({ state: "error" });
      });
  }, [point, pointKey, tab]);

  useEffect(() => {
    const key = pointKey && `${pointKey}:${refreshKey}`;
    if (!point || !key || tab !== "reports" || feedFor.current === key) return;
    feedFor.current = key;
    setFeed({ state: "loading" });
    fetch(`/api/reports/feed?lat=${point.lat.toFixed(5)}&lng=${point.lng.toFixed(5)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        setFeed({ state: "ok", data: await r.json() });
      })
      .catch(() => {
        feedFor.current = null;
        setFeed({ state: "error" });
      });
  }, [point, pointKey, tab, refreshKey]);

  const openTab = useCallback((next: PanelTab) => {
    setTab(next);
    cardRef.current?.scrollTo({ top: 0 });
  }, []);

  const onPick = useCallback(
    (p: LatLng, meta?: { reportId?: string }) => {
      if (mode === "report" && pinLocked) return;
      userPicked.current = true;
      setPoint(p);
      setFocusReport(meta?.reportId ?? null);
      if (meta?.reportId) openTab("reports");
    },
    [mode, pinLocked, openTab],
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
    <main className={`app basemap-${basemap}${wide && mode === "place" ? " is-wide" : ""}`}>
      <MapView
        lang={lang}
        visible={docked}
        flyTo={flyTo}
        pin={point}
        onPick={onPick}
        basemap={basemap}
        onBasemap={setBasemap}
        layers={layers}
        onToggleLayer={(k: LayerKey) => setLayers((l) => ({ ...l, [k]: !l[k] }))}
        status={status}
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
        <aside ref={cardRef} className="card" aria-label={mode === "report" ? t.reportTitle : t.nearYou}>
          {mode === "place" && (
            <div className="tab-bar">
              <div className="tabs" role="tablist">
                {(["overview", "city", "news", "insight", "reports"] as PanelTab[]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    role="tab"
                    aria-selected={tab === k}
                    className={tab === k ? "is-on" : ""}
                    onClick={() => openTab(k)}
                  >
                    {t.tabs[k]}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="tab-expand"
                aria-pressed={wide}
                aria-label={wide ? t.collapse : t.expand}
                title={wide ? t.collapse : t.expand}
                onClick={() => setWide((w) => !w)}
              >
                <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
                  {wide ? (
                    <path d="M8 4v4H4M12 16v-4h4M8 8 3 3M12 12l5 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  ) : (
                    <path d="M3 8V3h5M17 12v5h-5M3 3l5 5M17 17l-5-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  )}
                </svg>
              </button>
            </div>
          )}
          <div key={mode === "place" ? tab : mode} className="card-swap">
            {mode === "report" ? (
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
            ) : tab === "city" ? (
              <CityTab lang={lang} city={city} placeName={placeName} onPick={(p) => onPick(p)} />
            ) : tab === "news" ? (
              <NewsTab lang={lang} news={news} />
            ) : tab === "insight" ? (
              <InsightTab lang={lang} news={news} />
            ) : tab === "reports" ? (
              <ReportsTab lang={lang} feed={feed} focusId={focusReport} />
            ) : (
              <PlaceCard
                lang={lang}
                point={point}
                isUser={isUser}
                placeName={placeName}
                air={air}
                nearby={nearby}
                news={news}
                onReport={() => setMode("report")}
                onHow={() => setAbout({ open: true, section: "how" })}
                onOpenTab={openTab}
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
