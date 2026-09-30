"use client";

import { Map as MLMap, Marker, Popup, type GeoJSONSource, type StyleSpecification } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { categoryFromIndex, type CategoryKey } from "@/lib/aqi";
import { CATEGORY_LABEL, COPY, type Lang } from "@/lib/copy";
import { DEFAULT_ZOOM, INDIA_GATE, type LatLng } from "@/lib/geo";

const LIGHT_STYLE = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const GLYPHS = "https://tiles.basemaps.cartocdn.com/fonts/{fontstack}/{range}.pbf";
const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services";

const SATELLITE_STYLE: StyleSpecification = {
  version: 8,
  glyphs: GLYPHS,
  sources: {
    imagery: {
      type: "raster",
      tiles: [`${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`],
      tileSize: 256,
      maxzoom: 19,
    },
    places: {
      type: "raster",
      tiles: [`${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`],
      tileSize: 256,
      maxzoom: 19,
    },
  },
  layers: [
    { id: "bg", type: "background", paint: { "background-color": "#0d1614" } },
    { id: "imagery", type: "raster", source: "imagery", paint: { "raster-saturation": -0.3, "raster-brightness-max": 0.88 } },
    { id: "places", type: "raster", source: "places", paint: { "raster-opacity": 0.9 } },
  ],
};

/** Vivid India AQI colours for map overlays; the card uses the softer CATEGORY_COLORS. */
export const MAP_COLORS: Record<CategoryKey, string> = {
  good: "#3fb56b",
  satisfactory: "#a6c94f",
  moderate: "#f2cf3a",
  poor: "#f2913a",
  very_poor: "#e4472f",
  severe: "#a3214a",
};

const US_AQI_STOPS: [string, string][] = [
  ["0", "#00e400"],
  ["50", "#ffff00"],
  ["100", "#ff7e00"],
  ["150", "#ff0000"],
  ["200", "#8f3f97"],
  ["300+", "#7e0023"],
];

const INDIA_STOPS: [string, CategoryKey][] = [
  ["0", "good"],
  ["51", "satisfactory"],
  ["101", "moderate"],
  ["201", "poor"],
  ["301", "very_poor"],
  ["401+", "severe"],
];

const aqiColor = (prop: string) =>
  [
    "case",
    ["==", ["get", prop], null],
    "#9aa3a0",
    ["step", ["get", prop], MAP_COLORS.good, 51, MAP_COLORS.satisfactory, 101, MAP_COLORS.moderate, 201, MAP_COLORS.poor, 301, MAP_COLORS.very_poor, 401, MAP_COLORS.severe],
  ] as unknown as string;

export type FlyTarget = LatLng & { zoom?: number; seq: number };
export type Basemap = "satellite" | "light";
export type LayerKey = "aqi" | "stations" | "fires" | "reports";
export type Layers = Record<LayerKey, boolean>;
export type LayerStatus = { googleHeatmap: boolean; stations: boolean; fires: boolean; news: boolean; insight: boolean };

type Props = {
  lang: Lang;
  visible: boolean;
  flyTo: FlyTarget | null;
  pin: LatLng | null;
  onPick: (p: LatLng) => void;
  basemap: Basemap;
  onBasemap: (b: Basemap) => void;
  layers: Layers;
  onToggleLayer: (k: LayerKey) => void;
  status: LayerStatus | null;
  reportsVersion: number;
};

type FC = GeoJSON.FeatureCollection;
const EMPTY: FC = { type: "FeatureCollection", features: [] };
type StationRow = { id: string; name: string; city: string; lat: number; lng: number; aqi: number | null; dominant: string | null; updatedAt: string | null };

const LAYER_IDS: Record<LayerKey, string[]> = {
  aqi: ["aq-tiles", "heat-fill"],
  stations: ["station-circle", "station-label"],
  fires: ["fire-glow", "fire-dot"],
  reports: ["report-dots"],
};

export default function MapView(props: Props) {
  const { lang, visible, flyTo, pin, onPick, basemap, layers, status, reportsVersion } = props;
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const pinMarker = useRef<Marker | null>(null);
  const popup = useRef<Popup | null>(null);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const data = useRef<Record<"heat" | "stations" | "fires" | "reports", FC>>({ heat: EMPTY, stations: EMPTY, fires: EMPTY, reports: EMPTY });
  const statusRef = useRef(status);
  statusRef.current = status;
  const langRef = useRef(lang);
  langRef.current = lang;
  const firstBasemap = useRef(basemap);
  const styleReady = useRef(false);
  const [styleVersion, setStyleVersion] = useState(0);
  const [counts, setCounts] = useState<{ stations: number | null; fires: number | null }>({ stations: null, fires: null });
  const [panelOpen, setPanelOpen] = useState(false);
  const t = COPY[lang];

  useEffect(() => {
    if (!container.current || map.current) return;
    const m = new MLMap({
      container: container.current,
      style: firstBasemap.current === "satellite" ? SATELLITE_STYLE : LIGHT_STYLE,
      center: [INDIA_GATE.lng, INDIA_GATE.lat],
      zoom: DEFAULT_ZOOM,
      minZoom: 4,
      maxZoom: 18,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
    });
    m.touchZoomRotate.disableRotation();
    map.current = m;
    popup.current = new Popup({ closeButton: false, closeOnClick: false, offset: 12, className: "map-popup" });

    m.on("style.load", () => {
      styleReady.current = true;
      addOverlays(m, data.current, statusRef.current);
      setStyleVersion((v) => v + 1);
    });

    m.on("mousemove", (e) => {
      const hit = m.getLayer("station-circle")
        ? m.queryRenderedFeatures(e.point, { layers: ["station-circle"] })[0]
        : undefined;
      const fire = !hit && m.getLayer("fire-dot") ? m.queryRenderedFeatures(e.point, { layers: ["fire-dot"] })[0] : undefined;
      const report = !hit && !fire && m.getLayer("report-dots") ? m.queryRenderedFeatures(e.point, { layers: ["report-dots"] })[0] : undefined;
      m.getCanvas().style.cursor = hit || report ? "pointer" : "";
      const tt = COPY[langRef.current];
      if (hit && hit.geometry.type === "Point") {
        const p = hit.properties as { name: string; city: string; aqi?: number; dominant?: string; updatedAt?: string };
        const aqi = typeof p.aqi === "number" ? p.aqi : null;
        const cat = aqi === null ? null : categoryFromIndex(aqi);
        popup.current
          ?.setLngLat(hit.geometry.coordinates as [number, number])
          .setHTML(
            `<strong>${escapeHtml(p.name)}</strong><span>${escapeHtml(p.city)}</span>` +
              `<span class="pop-aqi">${
                cat ? `<i style="background:${MAP_COLORS[cat]}"></i>${escapeHtml(CATEGORY_LABEL[langRef.current][cat])} · ` : ""
              }${escapeHtml(tt.stationPopup(aqi, p.dominant ?? null))}</span>`,
          )
          .addTo(m);
      } else if (fire && fire.geometry.type === "Point") {
        const p = fire.properties as { frp: number; acqAt: string };
        popup.current
          ?.setLngLat(fire.geometry.coordinates as [number, number])
          .setHTML(`<strong>${escapeHtml(tt.layerFires)}</strong><span>FRP ${Math.round(p.frp)} MW · ${escapeHtml(timeLabel(p.acqAt))}</span>`)
          .addTo(m);
      } else {
        popup.current?.remove();
      }
    });
    m.on("mouseout", () => popup.current?.remove());

    m.on("click", (e) => {
      const ids = ["station-circle", "report-dots"].filter((id) => m.getLayer(id));
      const hit = ids.length ? m.queryRenderedFeatures(e.point, { layers: ids })[0] : undefined;
      if (hit && hit.geometry.type === "Point") {
        const [lng, lat] = hit.geometry.coordinates as [number, number];
        onPickRef.current({ lat, lng });
        return;
      }
      onPickRef.current({ lat: e.lngLat.lat, lng: e.lngLat.lng });
    });

    return () => {
      m.remove();
      map.current = null;
    };
  }, []);

  const ready = styleVersion > 0;

  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const want = basemap === "satellite" ? SATELLITE_STYLE : LIGHT_STYLE;
    if (firstBasemap.current === basemap) return;
    firstBasemap.current = basemap;
    styleReady.current = false;
    popup.current?.remove();
    m.setStyle(want, { diff: false });
  }, [basemap, ready]);

  useEffect(() => {
    if (visible) map.current?.resize();
  }, [visible]);

  useEffect(() => {
    const m = map.current;
    if (!m || !flyTo) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    m.easeTo({ center: [flyTo.lng, flyTo.lat], zoom: flyTo.zoom ?? m.getZoom(), duration: reduce ? 0 : 900 });
  }, [flyTo]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (!pin) {
      pinMarker.current?.remove();
      pinMarker.current = null;
      return;
    }
    if (!pinMarker.current) {
      const el = document.createElement("div");
      el.className = "map-pin";
      el.innerHTML = '<span class="map-pin-pulse"></span><span class="map-pin-dot"></span>';
      pinMarker.current = new Marker({ element: el }).setLngLat([pin.lng, pin.lat]).addTo(m);
    } else {
      pinMarker.current.setLngLat([pin.lng, pin.lat]);
    }
  }, [pin]);

  // Overlays are re-added after each style swap, and the AQ tile layer once status arrives.
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !styleReady.current) return;
    addOverlays(m, data.current, status);
    for (const [key, ids] of Object.entries(LAYER_IDS) as [LayerKey, string[]][]) {
      for (const id of ids) {
        if (m.getLayer(id)) m.setLayoutProperty(id, "visibility", layers[key] ? "visible" : "none");
      }
    }
  }, [layers, status, styleVersion, ready]);

  const setData = (key: keyof typeof data.current, fc: FC) => {
    data.current[key] = fc;
    (map.current?.getSource(key) as GeoJSONSource | undefined)?.setData(fc);
  };

  // CAMS grid, only when Google tiles are not available.
  const heatRequested = useRef(false);
  useEffect(() => {
    if (!ready || !status || status.googleHeatmap || !layers.aqi || heatRequested.current) return;
    heatRequested.current = true;
    fetch("/api/heatmap")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((grid: { step: number; features: { geometry: { coordinates: [number, number] }; properties: { pm25: number; aqi?: number } }[] }) => {
        const h = grid.step / 2;
        setData("heat", {
          type: "FeatureCollection",
          features: grid.features.map((f) => {
            const [lng, lat] = f.geometry.coordinates;
            return {
              type: "Feature",
              properties: { aqi: f.properties.aqi ?? null, pm25: f.properties.pm25 },
              geometry: {
                type: "Polygon",
                coordinates: [[[lng - h, lat - h], [lng + h, lat - h], [lng + h, lat + h], [lng - h, lat + h], [lng - h, lat - h]]],
              },
            };
          }),
        });
      })
      .catch(() => {
        heatRequested.current = false;
      });
  }, [ready, status, layers.aqi]);

  useEffect(() => {
    if (!ready || !status?.stations) return;
    let cancelled = false;
    fetch("/api/stations")
      .then((r) => r.json())
      .then((d: { available: boolean; stations: StationRow[] }) => {
        if (cancelled || !d.available) return;
        setCounts((c) => ({ ...c, stations: d.stations.length }));
        setData("stations", {
          type: "FeatureCollection",
          features: d.stations.map((s) => ({
            type: "Feature",
            properties: { id: s.id, name: s.name, city: s.city, aqi: s.aqi, dominant: s.dominant, updatedAt: s.updatedAt },
            geometry: { type: "Point", coordinates: [s.lng, s.lat] },
          })),
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [ready, status?.stations]);

  useEffect(() => {
    if (!ready || !status?.fires) return;
    let cancelled = false;
    fetch("/api/fires")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((fc: FC) => {
        if (cancelled) return;
        setCounts((c) => ({ ...c, fires: fc.features.length }));
        setData("fires", fc);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [ready, status?.fires]);

  // Report dots for the current view, refreshed on move and after a report is filed.
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    let ctrl: AbortController | null = null;
    const load = async () => {
      ctrl?.abort();
      ctrl = new AbortController();
      const b = m.getBounds();
      const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((n) => n.toFixed(4)).join(",");
      try {
        const res = await fetch(`/api/reports?bbox=${bbox}`, { signal: ctrl.signal });
        const d: { reports: { id: string; lat: number; lng: number; band: string }[] } = await res.json();
        setData("reports", {
          type: "FeatureCollection",
          features: (d.reports ?? []).map((r) => ({
            type: "Feature",
            properties: { id: r.id, band: r.band },
            geometry: { type: "Point", coordinates: [r.lng, r.lat] },
          })),
        });
      } catch {}
    };
    void load();
    m.on("moveend", load);
    return () => {
      m.off("moveend", load);
      ctrl?.abort();
    };
  }, [ready, reportsVersion]);

  const google = !!status?.googleHeatmap;
  const rows: { key: LayerKey; label: string; swatch: string; count?: number | null; disabled?: boolean }[] = [
    { key: "aqi", label: t.layerAqi, swatch: "swatch-heat" },
    { key: "stations", label: t.layerCpcb, swatch: "swatch-station", count: counts.stations, disabled: status ? !status.stations : false },
    { key: "fires", label: t.layerFires, swatch: "swatch-fire", count: counts.fires, disabled: status ? !status.fires : false },
    { key: "reports", label: t.layerReports, swatch: "swatch-report" },
  ];

  return (
    <>
      <div ref={container} className={`map${visible ? " is-visible" : ""}`} aria-label="Map" />

      <div className={`map-panel${visible ? " is-visible" : ""}${panelOpen ? " is-open" : ""}`}>
        <button type="button" className="panel-toggle" aria-expanded={panelOpen} onClick={() => setPanelOpen((o) => !o)}>
          <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
            <path d="M10 3 2.5 7 10 11l7.5-4L10 3Z" fill="currentColor" opacity=".9" />
            <path d="m2.5 10.5 7.5 4 7.5-4M2.5 13.5l7.5 4 7.5-4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
          </svg>
          {t.layers}
        </button>
        <div className="panel-body">
          <div className="segmented" role="radiogroup" aria-label={t.layers}>
            {(["satellite", "light"] as const).map((b) => (
              <button
                key={b}
                type="button"
                role="radio"
                aria-checked={basemap === b}
                className={basemap === b ? "is-on" : ""}
                onClick={() => props.onBasemap(b)}
              >
                {b === "satellite" ? t.basemapSatellite : t.basemapMap}
              </button>
            ))}
          </div>

          <ul className="layer-list">
            {rows.map((r) => (
              <li key={r.key}>
                <label className={`layer-row${r.disabled ? " is-disabled" : ""}`}>
                  <input type="checkbox" checked={layers[r.key] && !r.disabled} disabled={r.disabled} onChange={() => props.onToggleLayer(r.key)} />
                  <span className={`swatch ${r.swatch}`} aria-hidden="true" />
                  <span className="layer-name">{r.label}</span>
                  {r.count != null && <span className="layer-count">{r.count}</span>}
                </label>
              </li>
            ))}
          </ul>

          {google && layers.aqi && (
            <div className="legend">
              <p className="legend-title">{t.heatSourceGoogle}</p>
              <div className="legend-bar" style={{ background: `linear-gradient(90deg, ${US_AQI_STOPS.map((s) => s[1]).join(", ")})` }} />
              <div className="legend-ticks">
                {US_AQI_STOPS.map(([l]) => (
                  <span key={l}>{l}</span>
                ))}
              </div>
            </div>
          )}
          <div className="legend">
            <p className="legend-title">
              {t.legendScale}
              {!google && layers.aqi ? ` · ${t.heatSourceCams}` : ""}
            </p>
            <div className="legend-steps">
              {INDIA_STOPS.map(([l, c]) => (
                <span key={c} title={CATEGORY_LABEL[lang][c]}>
                  <i style={{ background: MAP_COLORS[c] }} />
                  {l}
                </span>
              ))}
            </div>
          </div>

          <p className="panel-note">
            {status && !status.stations ? t.stationsMissing : t.stationsSource}
            <br />
            {t.firesSource}
          </p>
        </div>
      </div>

      <div className={`map-controls${visible ? " is-visible" : ""}`}>
        <div className="zoom">
          <button type="button" className="icon-btn" aria-label={t.zoomIn} title={t.zoomIn} onClick={() => map.current?.zoomIn()}>
            <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
              <path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
          <button type="button" className="icon-btn" aria-label={t.zoomOut} title={t.zoomOut} onClick={() => map.current?.zoomOut()}>
            <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
              <path d="M4 10h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      <div className={`attribution${visible ? " is-visible" : ""}`}>
        {basemap === "satellite" ? (
          <a href="https://www.esri.com/" target="_blank" rel="noreferrer">
            Imagery © Esri, Maxar, Earthstar Geographics
          </a>
        ) : (
          <>
            <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
              © OpenStreetMap
            </a>{" "}
            <a href="https://carto.com/attributions" target="_blank" rel="noreferrer">
              © CARTO
            </a>
          </>
        )}
        {google && " · Air data © Google"}
        {" · CPCB · NASA FIRMS"}
      </div>
    </>
  );
}

function addOverlays(m: MLMap, data: Record<"heat" | "stations" | "fires" | "reports", FC>, status: LayerStatus | null) {
  const layers = m.getStyle().layers ?? [];
  const below = m.getLayer("places") ? "places" : layers.find((l) => l.type === "symbol")?.id;
  const satellite = !!m.getLayer("imagery");

  if (status?.googleHeatmap && !m.getSource("aq")) {
    m.addSource("aq", {
      type: "raster",
      tiles: [`${window.location.origin}/api/aqtiles/{z}/{x}/{y}`],
      tileSize: 256,
      maxzoom: 12,
      attribution: "Air data © Google",
    });
  }
  if (m.getSource("aq") && !m.getLayer("aq-tiles")) {
    m.addLayer(
      { id: "aq-tiles", type: "raster", source: "aq", paint: { "raster-opacity": satellite ? 0.6 : 0.5, "raster-fade-duration": 200 } },
      below,
    );
  }

  if (!m.getSource("heat")) m.addSource("heat", { type: "geojson", data: data.heat });
  if (!m.getLayer("heat-fill")) {
    m.addLayer(
      {
        id: "heat-fill",
        type: "fill",
        source: "heat",
        paint: { "fill-color": aqiColor("aqi"), "fill-opacity": satellite ? 0.45 : 0.35, "fill-antialias": false },
      },
      below,
    );
  }

  if (!m.getSource("fires")) m.addSource("fires", { type: "geojson", data: data.fires });
  if (!m.getLayer("fire-glow")) {
    m.addLayer({
      id: "fire-glow",
      type: "circle",
      source: "fires",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 5, 9, 12, 13, 22],
        "circle-color": "#ff5a1f",
        "circle-opacity": 0.28,
        "circle-blur": 0.9,
      },
    });
  }
  if (!m.getLayer("fire-dot")) {
    m.addLayer({
      id: "fire-dot",
      type: "circle",
      source: "fires",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 1.6, 9, 3, 13, 5],
        "circle-color": "#ffd166",
        "circle-stroke-color": "#ff3d00",
        "circle-stroke-width": 1,
      },
    });
  }

  if (!m.getSource("stations")) m.addSource("stations", { type: "geojson", data: data.stations });
  if (!m.getLayer("station-circle")) {
    m.addLayer({
      id: "station-circle",
      type: "circle",
      source: "stations",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 3, 7, 5, 9, 9, 12, 14],
        "circle-color": aqiColor("aqi"),
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 4, 0.8, 9, 1.8],
        "circle-opacity": 0.95,
      },
    });
  }
  if (!m.getLayer("station-label")) {
    m.addLayer({
      id: "station-label",
      type: "symbol",
      source: "stations",
      minzoom: 8.5,
      filter: ["!=", ["get", "aqi"], null],
      layout: {
        "text-field": ["to-string", ["get", "aqi"]],
        "text-font": ["Open Sans Bold"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 8.5, 9, 12, 12],
        "text-allow-overlap": true,
      },
      paint: {
        "text-color": ["case", ["<=", ["get", "aqi"], 200], "#1c2422", "#ffffff"],
      },
    });
  }

  if (!m.getSource("reports")) m.addSource("reports", { type: "geojson", data: data.reports });
  if (!m.getLayer("report-dots")) {
    m.addLayer({
      id: "report-dots",
      type: "circle",
      source: "reports",
      paint: {
        "circle-radius": 6,
        "circle-color": "#2f7de1",
        "circle-stroke-width": 2,
        "circle-stroke-color": "#ffffff",
      },
    });
  }
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function timeLabel(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : `${new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(d)} IST`;
}
