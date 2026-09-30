"use client";

import { CATEGORY_COLORS, categoryFromIndex, type CategoryKey } from "@/lib/aqi";
import type { Band, Claim } from "@/lib/confidence";
import { CATEGORY_LABEL, COPY, type Lang } from "@/lib/copy";
import { compassFromDeg, formatCoords, formatIstTime, formatKm, type Compass, type LatLng } from "@/lib/geo";
import { MAP_COLORS } from "@/components/MapView";

type PollutantCode = "pm25" | "pm10" | "no2" | "o3" | "co" | "so2";

export type AirData = {
  placeName: string | null;
  pm25: number;
  aqi: number;
  source: "google_air_quality" | "open_meteo_cams";
  observedAt: string;
  forecastPm25: number | null;
  forecastAt: string | null;
  estimate: { pm25: number; modelVersion: string } | null;
  windFromDeg: number | null;
  windKmh: number | null;
  temperatureC: number | null;
  pollutants: { code: PollutantCode; value: number; unit: string }[];
  hourly: { at: string; pm25: number; aqi: number }[];
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

export type NearbyData = {
  reports: NearbyRow[];
  mine: NearbyRow[];
  sentence: string;
  fireCounts?: { within50km: number; upwind: number };
  station?: { name: string; city: string; aqi: number | null; dominant: string | null; updatedAt: string | null; km: number } | null;
  windFrom?: Compass | null;
};

type CauseKey = "crop_burning" | "other_fires" | "traffic" | "construction_dust" | "industry" | "firecrackers" | "weather" | "other";

export type NewsData = {
  area: string;
  newsAvailable: boolean;
  articles: { title: string; link: string; source: string | null; sourceIcon: string | null; publishedAt: string | null; thumbnail: string | null }[];
  insight: {
    summary: string;
    causes: { key: CauseKey; label: string; evidence: string; articles: number[] }[];
    confidence: "low" | "medium" | "high";
  } | null;
};

export type Loadable<T> = { state: "loading" } | { state: "ok"; data: T } | { state: "error" };

type Props = {
  lang: Lang;
  point: LatLng;
  isUser: boolean;
  placeName: string | null | undefined;
  air: Loadable<AirData>;
  nearby: Loadable<NearbyData>;
  news: Loadable<NewsData>;
  onReport: () => void;
  onHow: () => void;
};

const ISTDAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" });
const DAYMONTH = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" });
const ISTHOUR = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", hour12: false });

const POLLUTANT_LABEL: Record<PollutantCode, string> = {
  pm25: "PM2.5",
  pm10: "PM10",
  no2: "NO₂",
  o3: "O₃",
  co: "CO",
  so2: "SO₂",
};

const CAUSE_COLOR: Record<CauseKey, string> = {
  crop_burning: "#d9731f",
  other_fires: "#d4452b",
  traffic: "#50638a",
  construction_dust: "#a8834f",
  industry: "#6a5a8e",
  firecrackers: "#c23d7a",
  weather: "#3a86b5",
  other: "#6d7a74",
};

function when(iso: string) {
  const d = new Date(iso);
  const time = `${formatIstTime(d)} IST`;
  return ISTDAY.format(d) === ISTDAY.format(new Date()) ? time : `${DAYMONTH.format(d)}, ${time}`;
}

function ago(lang: Lang, iso: string | null) {
  if (!iso) return "";
  const t = COPY[lang];
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (!Number.isFinite(mins)) return "";
  if (mins < 60) return t.agoMinutes(mins);
  if (mins < 48 * 60) return t.agoHours(Math.round(mins / 60));
  return t.agoDays(Math.round(mins / 1440));
}

export default function PlaceCard(props: Props) {
  const { lang, point, isUser, air, nearby, news } = props;
  const t = COPY[lang];
  const place = props.placeName === undefined ? t.loading : props.placeName ?? t.placeUnknown;
  const cat: CategoryKey | null = air.state === "ok" ? categoryFromIndex(air.data.aqi) : null;
  const tint = cat ? MAP_COLORS[cat] : "#c9cfcc";

  return (
    <div className="card-body">
      <header className="hero" style={{ ["--tint" as string]: tint }}>
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
      </header>

      {air.state === "ok" && (
        <>
          <Pollutants lang={lang} air={air.data} />
          {air.data.hourly.length > 1 && <Forecast lang={lang} hourly={air.data.hourly} />}
        </>
      )}

      {nearby.state === "ok" && (nearby.data.station || nearby.data.fireCounts) && (
        <div className="facts">
          {nearby.data.station && (
            <div className="fact">
              <p className="fact-title">{t.nearestStation}</p>
              <p className="fact-main">
                {nearby.data.station.aqi !== null && (
                  <span
                    className="fact-badge"
                    style={{ background: MAP_COLORS[categoryFromIndex(nearby.data.station.aqi)] }}
                  >
                    {nearby.data.station.aqi}
                  </span>
                )}
                {nearby.data.station.name}
              </p>
              <p className="fact-sub">
                {t.stationLine(
                  formatKm(nearby.data.station.km),
                  nearby.data.station.aqi,
                  nearby.data.station.updatedAt ? formatIstTime(nearby.data.station.updatedAt) : null,
                )}
                {nearby.data.station.dominant ? ` · ${nearby.data.station.dominant}` : ""}
              </p>
            </div>
          )}
          {nearby.data.fireCounts && (
            <div className="fact">
              <p className="fact-title">{t.firesTitle}</p>
              <p className="fact-main">
                <span className="fire-icon" aria-hidden="true" />
                {t.firesLine(nearby.data.fireCounts.within50km, nearby.data.fireCounts.upwind)}
              </p>
              {nearby.data.fireCounts.upwind > 0 && <p className="fact-sub">{t.firesUpwindHint}</p>}
            </div>
          )}
        </div>
      )}

      <Insight lang={lang} news={news} />

      <p className="context">
        {nearby.state === "ok" ? nearby.data.sentence : nearby.state === "loading" ? "\u00a0" : t.ctxNothing}
      </p>

      <section className="nearby">
        <h3 className="section-title">{t.nearbyReports}</h3>
        {nearby.state === "loading" && <p className="muted">{t.loading}</p>}
        {nearby.state !== "loading" && <NearbyList lang={lang} data={nearby.state === "ok" ? nearby.data : null} />}
      </section>

      <NewsList lang={lang} news={news} />

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
  const compass = air.windFromDeg !== null ? t.compass[compassFromDeg(air.windFromDeg)] : null;
  const weather = t.weatherLine(air.temperatureC, compass, air.windKmh);
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
      <p className="health">{t.health[cat]}</p>
      <div className="scale" aria-hidden="true">
        <div className="scale-bar">
          <span className="scale-mark" style={{ left: `${Math.min(100, (air.aqi / 500) * 100)}%` }} />
        </div>
        <div className="scale-labels">
          <span>{t.scaleGood}</span>
          <span>{t.scaleSevere}</span>
        </div>
      </div>
      <p className="source-line">{sourceLine}</p>
      {weather && <p className="weather-line">{weather}</p>}
      {isCams && <p className="source-note">{t.camsNote}</p>}
      {air.forecastPm25 !== null && air.forecastAt && (
        <p className="source-note">{t.laterToday(air.forecastPm25, formatIstTime(air.forecastAt))}</p>
      )}
      {air.estimate && <p className="source-note">{t.estimateLine(air.estimate.pm25, air.estimate.modelVersion)}</p>}
    </>
  );
}

function Pollutants({ lang, air }: { lang: Lang; air: AirData }) {
  const t = COPY[lang];
  if (!air.pollutants?.length) return null;
  return (
    <section className="block">
      <h3 className="section-title">{t.pollutantsTitle}</h3>
      <ul className="pollutants">
        {air.pollutants.map((p) => (
          <li key={p.code}>
            <span className="pol-name">{POLLUTANT_LABEL[p.code]}</span>
            <span className="pol-value">{p.value < 10 ? p.value.toFixed(1) : Math.round(p.value)}</span>
            <span className="pol-unit">{p.unit}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Forecast({ lang, hourly }: { lang: Lang; hourly: AirData["hourly"] }) {
  const t = COPY[lang];
  const pts = hourly.slice(0, 24);
  const max = Math.max(100, ...pts.map((h) => h.aqi));
  const w = 100 / pts.length;
  const peak = pts.reduce((a, b) => (b.aqi > a.aqi ? b : a), pts[0]);
  return (
    <section className="block">
      <h3 className="section-title">{t.next24h}</h3>
      <svg className="forecast" viewBox="0 0 100 44" preserveAspectRatio="none" role="img" aria-label={t.next24h}>
        {pts.map((h, i) => {
          const bh = Math.max(2, (h.aqi / max) * 40);
          return (
            <rect
              key={h.at}
              x={i * w + w * 0.14}
              y={44 - bh}
              width={w * 0.72}
              height={bh}
              rx={0.8}
              fill={MAP_COLORS[categoryFromIndex(h.aqi)]}
              opacity={h === peak ? 1 : 0.82}
            >
              <title>{`${formatIstTime(h.at)} IST · ${h.aqi} · ${h.pm25} µg/m³`}</title>
            </rect>
          );
        })}
      </svg>
      <div className="forecast-ticks">
        {pts.map((h, i) =>
          i % 6 === 0 ? (
            <span key={h.at} style={{ left: `${(i + 0.5) * w}%` }}>
              {i === 0 ? t.now : `${ISTHOUR.format(new Date(h.at))}:00`}
            </span>
          ) : null,
        )}
      </div>
      <p className="source-note">
        ↑ {peak.aqi} · {formatIstTime(peak.at)} IST
      </p>
    </section>
  );
}

function Insight({ lang, news }: { lang: Lang; news: Loadable<NewsData> }) {
  const t = COPY[lang];
  const insight = news.state === "ok" ? news.data.insight : null;
  const articles = news.state === "ok" ? news.data.articles : [];
  return (
    <section className="insight" aria-live="polite">
      <div className="insight-head">
        <h3 className="section-title">{t.insightTitle}</h3>
        <span className="badge-ai">{t.insightBadge}</span>
      </div>
      {news.state === "loading" && <p className="muted shimmer">{t.insightLoading}</p>}
      {news.state !== "loading" && !insight && <p className="muted">{t.insightUnavailable}</p>}
      {insight && (
        <>
          <p className="insight-summary">{insight.summary}</p>
          {insight.causes.length > 0 && (
            <ul className="causes">
              {insight.causes.map((c, i) => (
                <li key={i} className="cause" style={{ ["--cause" as string]: CAUSE_COLOR[c.key] }}>
                  <span className="cause-chip">{c.label}</span>
                  {c.evidence && (
                    <span className="cause-evidence">
                      {c.evidence}
                      {c.articles
                        .filter((n) => articles[n - 1])
                        .map((n) => (
                          <a key={n} className="cite" href={articles[n - 1].link} target="_blank" rel="noreferrer" title={articles[n - 1].title}>
                            {n}
                          </a>
                        ))}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="source-note">{t.insightConfidence[insight.confidence]}</p>
        </>
      )}
    </section>
  );
}

function NewsList({ lang, news }: { lang: Lang; news: Loadable<NewsData> }) {
  const t = COPY[lang];
  if (news.state === "loading") return null;
  if (news.state === "error") return null;
  const { area, newsAvailable, articles } = news.data;
  return (
    <section className="block news">
      <h3 className="section-title">{t.newsTitle(area)}</h3>
      {!newsAvailable && <p className="muted">{t.newsMissing}</p>}
      {newsAvailable && !articles.length && <p className="muted">{t.newsEmpty}</p>}
      {articles.length > 0 && (
        <ol className="news-list">
          {articles.slice(0, 6).map((a, i) => (
            <li key={a.link}>
              <a href={a.link} target="_blank" rel="noreferrer" className="news-item">
                <span className="news-num">{i + 1}</span>
                <span className="news-text">
                  <span className="news-title">{a.title}</span>
                  <span className="news-meta">
                    {a.source}
                    {a.source && a.publishedAt ? " · " : ""}
                    {ago(lang, a.publishedAt)}
                  </span>
                </span>
                {a.thumbnail && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="news-thumb" src={a.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" />
                )}
              </a>
            </li>
          ))}
        </ol>
      )}
    </section>
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
