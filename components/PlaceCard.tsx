"use client";

import { CATEGORY_COLORS, categoryFromIndex } from "@/lib/aqi";
import type { Band, Claim } from "@/lib/confidence";
import { CATEGORY_LABEL, COPY, type Lang } from "@/lib/copy";
import { formatCoords, formatIstTime, formatKm, type LatLng } from "@/lib/geo";

export type AirData = {
  placeName: string | null;
  pm25: number;
  aqi: number;
  source: "google_air_quality" | "open_meteo_cams";
  observedAt: string;
  forecastPm25: number | null;
  forecastAt: string | null;
  estimate: { pm25: number; modelVersion: string } | null;
};

export type NearbyRow = {
  id: string;
  claim: Claim;
  km: number;
  createdAt: string;
  band: Band | null;
  status: "draft" | "published" | "rejected";
  mine: boolean;
};

export type NearbyData = { reports: NearbyRow[]; mine: NearbyRow[]; sentence: string };

export type Loadable<T> = { state: "loading" } | { state: "ok"; data: T } | { state: "error" };

type Props = {
  lang: Lang;
  point: LatLng;
  isUser: boolean;
  placeName: string | null | undefined;
  air: Loadable<AirData>;
  nearby: Loadable<NearbyData>;
  heatmapOn: boolean;
  stationsOn: boolean;
  onReport: () => void;
  onHow: () => void;
};

const ISTDAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" });
const DAYMONTH = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" });

function when(iso: string) {
  const d = new Date(iso);
  const time = `${formatIstTime(d)} IST`;
  return ISTDAY.format(d) === ISTDAY.format(new Date()) ? time : `${DAYMONTH.format(d)}, ${time}`;
}

export default function PlaceCard(props: Props) {
  const { lang, point, isUser, air, nearby } = props;
  const t = COPY[lang];
  const place = props.placeName === undefined ? t.loading : props.placeName ?? t.placeUnknown;

  return (
    <div className="card-body">
      <p className="eyebrow">{isUser ? t.nearYou : t.selectedPoint}</p>
      <h2 className="place">{place}</h2>
      <p className="coords">{formatCoords(point)}</p>

      <section className="reading" aria-live="polite">
        {air.state === "loading" && (
          <div className="skeleton" aria-label={t.loading}>
            <span className="sk sk-num" />
            <span className="sk sk-line" />
          </div>
        )}
        {air.state === "error" && <p className="unavailable">{t.airUnavailable}</p>}
        {air.state === "ok" && <Reading lang={lang} air={air.data} />}
      </section>

      {props.heatmapOn && <p className="layer-note">{t.heatmapLabel}</p>}
      {props.stationsOn && <p className="layer-note">{t.stationsLabel}</p>}

      <p className="context">
        {nearby.state === "ok" ? nearby.data.sentence : nearby.state === "loading" ? "\u00a0" : t.ctxNothing}
      </p>

      <section className="nearby">
        <h3 className="section-title">{t.nearbyReports}</h3>
        {nearby.state === "loading" && <p className="muted">{t.loading}</p>}
        {nearby.state !== "loading" && <NearbyList lang={lang} data={nearby.state === "ok" ? nearby.data : null} />}
      </section>

      <div className="actions">
        <button type="button" className="btn-primary" onClick={props.onReport}>
          {t.reportWhatYouSee}
        </button>
        <button type="button" className="btn-text" onClick={props.onHow}>
          {t.howNumberMade}
        </button>
      </div>
    </div>
  );
}

function Reading({ lang, air }: { lang: Lang; air: AirData }) {
  const t = COPY[lang];
  const cat = categoryFromIndex(air.aqi);
  const colors = CATEGORY_COLORS[cat];
  const isCams = air.source === "open_meteo_cams";
  const sourceLine = isCams
    ? `${t.hourlyPm25} ${air.pm25} µg/m³ · ${t.srcCams}`
    : `${t.hourlyPm25} ${air.pm25} µg/m³ · ${t.srcGoogle} · ${formatIstTime(air.observedAt)} IST`;
  return (
    <>
      <p className="scale-caption">{t.hourlyScaleCaption}</p>
      <div className="number-row">
        <span className="aqi-number" style={{ color: colors.ink }}>
          {air.aqi}
        </span>
        <span className="pill" style={{ color: colors.ink, background: colors.pill }}>
          {CATEGORY_LABEL[lang][cat]}
        </span>
      </div>
      <p className="source-line">{sourceLine}</p>
      {isCams && <p className="source-note">{t.camsNote}</p>}
      {air.forecastPm25 !== null && air.forecastAt && (
        <p className="source-note">{t.laterToday(air.forecastPm25, formatIstTime(air.forecastAt))}</p>
      )}
      {air.estimate && <p className="source-note">{t.estimateLine(air.estimate.pm25, air.estimate.modelVersion)}</p>}
      <div className="scale" aria-hidden="true">
        <div className="scale-bar">
          <span className="scale-mark" style={{ left: `${Math.min(100, (air.aqi / 500) * 100)}%` }} />
        </div>
        <div className="scale-labels">
          <span>{t.scaleGood}</span>
          <span>{t.scaleSevere}</span>
        </div>
      </div>
    </>
  );
}

function NearbyList({ lang, data }: { lang: Lang; data: NearbyData | null }) {
  const t = COPY[lang];
  const rows = [...(data?.reports ?? []), ...(data?.mine ?? [])].slice(0, 3);
  return (
    <>
      {!data?.reports.length && <p className="muted">{t.noNearbyReports}</p>}
      {rows.length > 0 && (
        <ul className="rows">
          {rows.map((r) => {
            const rejected = r.status === "rejected";
            const label = rejected ? t.rejectedLabel : r.band ? t.bandLabel[r.band] : "";
            return (
              <li key={r.id} className="row">
                <span className="row-type">{t.claim[r.claim]}</span>
                <span className="row-meta">
                  {formatKm(r.km)} km · {when(r.createdAt)}
                </span>
                <span className={`row-band band-${rejected ? "rejected" : r.band}`}>
                  {r.mine ? `${t.yours} · ${label}` : label}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
