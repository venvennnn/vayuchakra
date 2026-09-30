"use client";

import { Map as MLMap, Marker, type GeoJSONSource } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { CATEGORY_COLORS, categoryFromIndex } from "@/lib/aqi";
import { COPY, type Lang } from "@/lib/copy";
import { DEFAULT_ZOOM, INDIA_GATE, type LatLng } from "@/lib/geo";

const STYLE_URL = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";

export const STATIONS: { name: string; lat: number; lng: number }[] = [
  { name: "Anand Vihar", lat: 28.6508, lng: 77.3152 },
  { name: "ITO", lat: 28.628, lng: 77.241 },
  { name: "Mandir Marg", lat: 28.6362, lng: 77.2011 },
  { name: "R.K. Puram", lat: 28.5633, lng: 77.1869 },
  { name: "Punjabi Bagh", lat: 28.674, lng: 77.131 },
  { name: "Dwarka Sector 8", lat: 28.571, lng: 77.0719 },
  { name: "IGI Airport area", lat: 28.5628, lng: 77.118 },
  { name: "Gurugram Sector 51 area", lat: 28.4595, lng: 77.0266 },
  { name: "Noida Sector 62 area", lat: 28.6271, lng: 77.3649 },
  { name: "Vasundhara, Ghaziabad", lat: 28.6609, lng: 77.3714 },
];

export type FlyTarget = LatLng & { zoom?: number; seq: number };

type Props = {
  lang: Lang;
  visible: boolean;
  flyTo: FlyTarget | null;
  pin: LatLng | null;
  onPick: (p: LatLng) => void;
  heatmapOn: boolean;
  stationsOn: boolean;
  onToggleHeatmap: () => void;
  onToggleStations: () => void;
  reportsVersion: number;
};

type HeatPoint = { geometry: { coordinates: [number, number] }; properties: { pm25: number } };

const EMPTY = { type: "FeatureCollection" as const, features: [] };

export default function MapView(props: Props) {
  const { lang, visible, flyTo, pin, onPick, heatmapOn, stationsOn, reportsVersion } = props;
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const pinMarker = useRef<Marker | null>(null);
  const stationMarkers = useRef<Marker[]>([]);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const [ready, setReady] = useState(false);
  const [stationValues, setStationValues] = useState<Record<string, number | null>>({});
  const heatLoaded = useRef(false);
  const t = COPY[lang];

  useEffect(() => {
    if (!container.current || map.current) return;
    const m = new MLMap({
      container: container.current,
      style: STYLE_URL,
      center: [INDIA_GATE.lng, INDIA_GATE.lat],
      zoom: DEFAULT_ZOOM,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
    });
    m.touchZoomRotate.disableRotation();
    map.current = m;

    m.on("load", () => {
      const firstSymbol = m.getStyle().layers?.find((l) => l.type === "symbol")?.id;
      m.addSource("heat", { type: "geojson", data: EMPTY });
      m.addLayer(
        {
          id: "heat-fill",
          type: "fill",
          source: "heat",
          layout: { visibility: "none" },
          paint: {
            "fill-color": ["interpolate", ["linear"], ["get", "pm25"], 30, "#ead56a", 90, "#f0a35a", 250, "#e15b3a"],
            "fill-opacity": 0.28,
            "fill-antialias": false,
          },
        },
        firstSymbol,
      );
      m.addSource("reports", { type: "geojson", data: EMPTY });
      m.addLayer({
        id: "report-dots",
        type: "circle",
        source: "reports",
        paint: {
          "circle-radius": 5,
          "circle-color": "#2f7de1",
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
        },
      });
      m.on("mouseenter", "report-dots", () => (m.getCanvas().style.cursor = "pointer"));
      m.on("mouseleave", "report-dots", () => (m.getCanvas().style.cursor = ""));
      setReady(true);
    });

    m.on("click", (e) => {
      const hit = m.getLayer("report-dots") ? m.queryRenderedFeatures(e.point, { layers: ["report-dots"] })[0] : undefined;
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
      pinMarker.current = new Marker({ element: el }).setLngLat([pin.lng, pin.lat]).addTo(m);
    } else {
      pinMarker.current.setLngLat([pin.lng, pin.lat]);
    }
  }, [pin]);

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
        const data: { reports: { id: string; lat: number; lng: number; band: string }[] } = await res.json();
        (m.getSource("reports") as GeoJSONSource | undefined)?.setData({
          type: "FeatureCollection",
          features: (data.reports ?? []).map((r) => ({
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

  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    m.setLayoutProperty("heat-fill", "visibility", heatmapOn ? "visible" : "none");
    if (!heatmapOn || heatLoaded.current) return;
    heatLoaded.current = true;
    (async () => {
      try {
        const res = await fetch("/api/heatmap");
        if (!res.ok) throw new Error();
        const grid: { step: number; features: HeatPoint[] } = await res.json();
        const h = grid.step / 2;
        (m.getSource("heat") as GeoJSONSource).setData({
          type: "FeatureCollection",
          features: grid.features.map((f) => {
            const [lng, lat] = f.geometry.coordinates;
            return {
              type: "Feature",
              properties: { pm25: f.properties.pm25 },
              geometry: {
                type: "Polygon",
                coordinates: [[[lng - h, lat - h], [lng + h, lat - h], [lng + h, lat + h], [lng - h, lat + h], [lng - h, lat - h]]],
              },
            };
          }),
        });
      } catch {
        heatLoaded.current = false;
      }
    })();
  }, [heatmapOn, ready]);

  useEffect(() => {
    if (!stationsOn) return;
    const missing = STATIONS.filter((s) => !(s.name in stationValues));
    if (!missing.length) return;
    let cancelled = false;
    Promise.all(
      missing.map(async (s) => {
        try {
          const res = await fetch(`/api/air?lat=${s.lat}&lng=${s.lng}&lite=1`);
          if (!res.ok) return [s.name, null] as const;
          const d: { aqi: number } = await res.json();
          return [s.name, d.aqi] as const;
        } catch {
          return [s.name, null] as const;
        }
      }),
    ).then((pairs) => {
      if (!cancelled) setStationValues((v) => ({ ...v, ...Object.fromEntries(pairs) }));
    });
    return () => {
      cancelled = true;
    };
  }, [stationsOn, stationValues]);

  useEffect(() => {
    const m = map.current;
    stationMarkers.current.forEach((mk) => mk.remove());
    stationMarkers.current = [];
    if (!m || !stationsOn) return;
    for (const s of STATIONS) {
      const aqi = stationValues[s.name];
      const el = document.createElement("button");
      el.type = "button";
      el.className = "station-dot";
      const label = `${s.name} ${t.stationArea}`;
      el.title = aqi == null ? label : `${label} · ${aqi}`;
      el.setAttribute("aria-label", el.title);
      if (aqi != null) {
        const c = CATEGORY_COLORS[categoryFromIndex(aqi)];
        el.textContent = String(aqi);
        el.style.color = c.ink;
        el.style.background = c.pill;
      } else {
        el.textContent = "·";
      }
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        onPickRef.current({ lat: s.lat, lng: s.lng });
      });
      stationMarkers.current.push(new Marker({ element: el }).setLngLat([s.lng, s.lat]).addTo(m));
    }
  }, [stationsOn, stationValues, t.stationArea]);

  return (
    <>
      <div ref={container} className={`map${visible ? " is-visible" : ""}`} aria-label="Map" />
      <div className={`map-controls${visible ? " is-visible" : ""}`}>
        <button
          type="button"
          className={`icon-btn${heatmapOn ? " is-on" : ""}`}
          aria-pressed={heatmapOn}
          aria-label={t.layerHeatmap}
          title={t.layerHeatmap}
          onClick={props.onToggleHeatmap}
        >
          <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
            <rect x="2.5" y="2.5" width="6" height="6" rx="1" fill="currentColor" opacity=".35" />
            <rect x="11.5" y="2.5" width="6" height="6" rx="1" fill="currentColor" opacity=".7" />
            <rect x="2.5" y="11.5" width="6" height="6" rx="1" fill="currentColor" opacity=".7" />
            <rect x="11.5" y="11.5" width="6" height="6" rx="1" fill="currentColor" />
          </svg>
        </button>
        <button
          type="button"
          className={`icon-btn${stationsOn ? " is-on" : ""}`}
          aria-pressed={stationsOn}
          aria-label={t.layerStations}
          title={t.layerStations}
          onClick={props.onToggleStations}
        >
          <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
            <circle cx="5" cy="6" r="2.2" fill="currentColor" />
            <circle cx="14.5" cy="5" r="2.2" fill="currentColor" />
            <circle cx="9.5" cy="14.5" r="2.2" fill="currentColor" />
          </svg>
        </button>
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
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
          © OpenStreetMap
        </a>{" "}
        <a href="https://carto.com/attributions" target="_blank" rel="noreferrer">
          © CARTO
        </a>
      </div>
    </>
  );
}
