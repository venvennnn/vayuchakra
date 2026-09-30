"use client";

import { categoryFromIndex, type CategoryKey } from "@/lib/aqi";
import type { Band, Claim } from "@/lib/confidence";
import { CATEGORY_LABEL, COPY, type Lang } from "@/lib/copy";
import { formatIstTime, formatKm, type LatLng } from "@/lib/geo";
import type { Check } from "@/lib/reportChecks";
import { BriefCard, ReviewBlock } from "@/components/Checks";
import { MAP_COLORS } from "@/components/MapView";
import { CAUSE_COLOR, ago, type Loadable, type NewsData } from "@/components/PlaceCard";

const CATS: CategoryKey[] = ["good", "satisfactory", "moderate", "poor", "very_poor", "severe"];
const DAYTIME = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export type CityData = {
  stationsAvailable: boolean;
  city: string | null;
  state: string | null;
  stations: {
    id: string;
    name: string;
    lat: number;
    lng: number;
    aqi: number | null;
    dominant: string | null;
    updatedAt: string | null;
    km: number;
    subIndex: Record<string, number>;
  }[];
  summary: {
    count: number;
    reporting: number;
    avg: number | null;
    max: { name: string; aqi: number } | null;
    min: { name: string; aqi: number } | null;
    categories: Partial<Record<CategoryKey, number>>;
    dominant: { pollutant: string; count: number }[];
    updatedAt: string | null;
  } | null;
  fires: { within25km: number; within50km: number; within100km: number; upwind: number };
  reports: { last7days: number; total: number };
};

export type FeedItem = {
  id: string;
  claim: Claim;
  createdAt: string;
  km: number;
  band: Band;
  confidence: number | null;
  placeName: string | null;
  description: string;
  observations: string[];
  visible: string | null;
  checks: Check[];
  brief?: {
    happened: string;
    where: string;
    evidence: string[];
    exposed: string;
    action: string;
    uncertainty: string;
  } | null;
};

export type FeedData = { available: boolean; reports: FeedItem[] };

function Loading({ lang }: { lang: Lang }) {
  return (
    <div className="tab-loading" aria-label={COPY[lang].loading}>
      <span className="sk sk-line" />
      <span className="sk sk-line" />
      <span className="sk sk-line short" />
    </div>
  );
}

function AqiBadge({ aqi }: { aqi: number | null }) {
  if (aqi === null) return <span className="aqi-badge is-empty">—</span>;
  return (
    <span className="aqi-badge" style={{ background: MAP_COLORS[categoryFromIndex(aqi)] }}>
      {aqi}
    </span>
  );
}

export function CityTab({
  lang,
  city,
  placeName,
  onPick,
}: {
  lang: Lang;
  city: Loadable<CityData>;
  placeName: string | null | undefined;
  onPick: (p: LatLng) => void;
}) {
  const t = COPY[lang];
  if (city.state === "loading") return <Loading lang={lang} />;
  if (city.state === "error") return <p className="unavailable">{t.airUnavailable}</p>;
  const d = city.data;
  const s = d.summary;
  const title = d.city ?? placeName?.split(",").pop()?.trim() ?? t.placeUnknown;

  return (
    <div className="tab-body">
      <h2 className="place">{title}</h2>
      {d.state && <p className="coords">{d.state}</p>}

      {!d.stationsAvailable && <p className="muted block">{t.stationsMissing}</p>}
      {d.stationsAvailable && !s && <p className="muted block">{t.cityNoStations}</p>}

      {s && (
        <>
          <div className="stat-grid">
            <div className="stat" style={{ ["--tint" as string]: s.avg !== null ? MAP_COLORS[categoryFromIndex(s.avg)] : "#c9cfcc" }}>
              <span className="stat-label">{t.cityAvg}</span>
              <span className="stat-value">{s.avg ?? "—"}</span>
              {s.avg !== null && <span className="stat-sub">{CATEGORY_LABEL[lang][categoryFromIndex(s.avg)]}</span>}
            </div>
            <div className="stat" style={{ ["--tint" as string]: s.max ? MAP_COLORS[categoryFromIndex(s.max.aqi)] : "#c9cfcc" }}>
              <span className="stat-label">{t.cityWorst}</span>
              <span className="stat-value">{s.max?.aqi ?? "—"}</span>
              <span className="stat-sub">{s.max?.name}</span>
            </div>
            <div className="stat" style={{ ["--tint" as string]: s.min ? MAP_COLORS[categoryFromIndex(s.min.aqi)] : "#c9cfcc" }}>
              <span className="stat-label">{t.cityBest}</span>
              <span className="stat-value">{s.min?.aqi ?? "—"}</span>
              <span className="stat-sub">{s.min?.name}</span>
            </div>
          </div>
          <p className="source-note">
            {t.cityStations(s.count, s.reporting)}
            {s.updatedAt ? ` · ${t.updated(`${formatIstTime(s.updatedAt)} IST`)}` : ""}
          </p>

          {s.reporting > 0 && (
            <section className="block">
              <h3 className="section-title">{t.cityCategories}</h3>
              <div className="cat-bar" role="img" aria-label={t.cityCategories}>
                {CATS.filter((c) => s.categories[c]).map((c) => (
                  <span key={c} style={{ flex: s.categories[c], background: MAP_COLORS[c] }} title={`${CATEGORY_LABEL[lang][c]}: ${s.categories[c]}`} />
                ))}
              </div>
              <div className="cat-legend">
                {CATS.filter((c) => s.categories[c]).map((c) => (
                  <span key={c}>
                    <i style={{ background: MAP_COLORS[c] }} />
                    {CATEGORY_LABEL[lang][c]} · {s.categories[c]}
                  </span>
                ))}
              </div>
            </section>
          )}

          {s.dominant.length > 0 && (
            <section className="block">
              <h3 className="section-title">{t.cityDominant}</h3>
              <div className="chips-row">
                {s.dominant.map((x) => (
                  <span key={x.pollutant} className="pollutant-chip">
                    {x.pollutant} <b>{x.count}</b>
                  </span>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      <section className="block">
        <h3 className="section-title">{t.cityFires}</h3>
        <div className="stat-grid four">
          <div className="stat mini">
            <span className="stat-value">{d.fires.within25km}</span>
            <span className="stat-sub">{t.firesWithin(25)}</span>
          </div>
          <div className="stat mini">
            <span className="stat-value">{d.fires.within50km}</span>
            <span className="stat-sub">{t.firesWithin(50)}</span>
          </div>
          <div className="stat mini">
            <span className="stat-value">{d.fires.within100km}</span>
            <span className="stat-sub">{t.firesWithin(100)}</span>
          </div>
          <div className="stat mini">
            <span className="stat-value">{d.fires.upwind}</span>
            <span className="stat-sub">{t.firesUpwindLabel}</span>
          </div>
        </div>
      </section>

      <section className="block">
        <h3 className="section-title">{t.cityReports}</h3>
        <div className="stat-grid two">
          <div className="stat mini">
            <span className="stat-value">{d.reports.last7days}</span>
            <span className="stat-sub">{t.reportsLast7}</span>
          </div>
          <div className="stat mini">
            <span className="stat-value">{d.reports.total}</span>
            <span className="stat-sub">{t.reportsAll}</span>
          </div>
        </div>
      </section>

      {d.stations.length > 0 && (
        <section className="block">
          <h3 className="section-title">{t.cityStationList}</h3>
          <p className="source-note">{t.cityIndexNote}</p>
          <ul className="station-grid">
            {d.stations.map((st) => (
              <li key={st.id}>
                <button type="button" className="station-card" onClick={() => onPick({ lat: st.lat, lng: st.lng })}>
                  <span className="station-top">
                    <AqiBadge aqi={st.aqi} />
                    <span className="station-name">{st.name}</span>
                  </span>
                  <span className="station-meta">
                    {formatKm(st.km)} km
                    {st.dominant ? ` · ${st.dominant}` : ""}
                    {st.updatedAt ? ` · ${formatIstTime(st.updatedAt)}` : ""}
                  </span>
                  {Object.keys(st.subIndex).length > 0 && (
                    <span className="sub-index">
                      {Object.entries(st.subIndex).map(([k, v]) => (
                        <span key={k} title={`${k} sub-index`}>
                          {k} <b>{Math.round(v)}</b>
                        </span>
                      ))}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export function NewsTab({ lang, news }: { lang: Lang; news: Loadable<NewsData> }) {
  const t = COPY[lang];
  if (news.state === "loading") return <Loading lang={lang} />;
  if (news.state === "error") return <p className="unavailable">{t.newsFailed.failed}</p>;
  const { area, newsAvailable, newsError, articles } = news.data;
  const shown = news.data.newsArea ?? area;
  return (
    <div className="tab-body">
      <h2 className="place">{t.newsTitle(shown)}</h2>
      {shown !== area && articles.length > 0 && <p className="muted small">{t.newsNearest(area)}</p>}
      {!newsAvailable && <p className="muted block">{t.newsMissing}</p>}
      {newsAvailable && newsError && <p className="muted block">{t.newsFailed[newsError] ?? t.newsFailed.failed}</p>}
      {newsAvailable && !newsError && !articles.length && <p className="muted block">{t.newsEmpty}</p>}
      {articles.length > 0 && (
        <ul className="news-grid">
          {articles.map((a, i) => (
            <li key={a.link}>
              <a className="news-card" href={a.link} target="_blank" rel="noreferrer">
                {a.thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" />
                ) : (
                  <span className="news-card-ph" aria-hidden="true" />
                )}
                <span className="news-card-body">
                  <span className="news-card-num">{i + 1}</span>
                  <span className="news-title">{a.title}</span>
                  <span className="news-meta">
                    {a.sourceIcon && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="news-icon" src={a.sourceIcon} alt="" loading="lazy" referrerPolicy="no-referrer" />
                    )}
                    {a.source}
                    {a.source && a.publishedAt ? " · " : ""}
                    {ago(lang, a.publishedAt)}
                  </span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function InsightTab({ lang, news }: { lang: Lang; news: Loadable<NewsData> }) {
  const t = COPY[lang];
  if (news.state === "loading") return <Loading lang={lang} />;
  if (news.state === "error") return <p className="unavailable">{t.insightUnavailable}</p>;
  const { insight, evidence, articles, area } = news.data;
  const compass = evidence?.windFrom ? t.compass[evidence.windFrom] : null;
  const cited = insight ? [...new Set(insight.causes.flatMap((c) => c.articles))].sort((a, b) => a - b).filter((n) => articles[n - 1]) : [];
  const maxAqi = evidence ? Math.max(100, ...evidence.trend.map((h) => h.aqi)) : 100;

  return (
    <div className="tab-body">
      <div className="insight-head">
        <h2 className="place">{t.insightTitle}</h2>
        <span className="badge-ai">{t.insightBadge}</span>
      </div>
      <p className="coords">{area}</p>

      {!insight && <p className="muted block">{t.insightUnavailable}</p>}
      {insight && (
        <section className="insight big">
          <p className="insight-summary">{insight.summary}</p>
          <p className="source-note">{t.insightConfidence[insight.confidence]}</p>
        </section>
      )}

      {insight && insight.causes.length > 0 && (
        <section className="block">
          <h3 className="section-title">{t.causesTitle}</h3>
          <ul className="cause-grid">
            {insight.causes.map((c, i) => (
              <li key={i} className="cause-card" style={{ ["--cause" as string]: CAUSE_COLOR[c.key] }}>
                <span className="cause-rank">{i + 1}</span>
                <span className="cause-chip">{c.label}</span>
                {c.evidence && <p className="cause-evidence">{c.evidence}</p>}
                {c.articles.filter((n) => articles[n - 1]).length > 0 && (
                  <p className="cause-cites">
                    {c.articles
                      .filter((n) => articles[n - 1])
                      .map((n) => (
                        <a key={n} className="cite" href={articles[n - 1].link} target="_blank" rel="noreferrer" title={articles[n - 1].title}>
                          {n}
                        </a>
                      ))}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {evidence && (
        <section className="block">
          <h3 className="section-title">{t.insightEvidence}</h3>
          <div className="stat-grid four">
            <div className="stat mini" style={{ ["--tint" as string]: MAP_COLORS[categoryFromIndex(evidence.aqi)] }}>
              <span className="stat-label">{t.evReading}</span>
              <span className="stat-value">{evidence.aqi}</span>
              <span className="stat-sub">PM2.5 {evidence.pm25} µg/m³</span>
            </div>
            <div className="stat mini">
              <span className="stat-label">{t.evWind}</span>
              <span className="stat-value">{evidence.windKmh ?? "—"}</span>
              <span className="stat-sub">km/h{compass ? ` · ${compass}` : ""}</span>
            </div>
            <div className="stat mini">
              <span className="stat-label">{t.evFires}</span>
              <span className="stat-value">{evidence.firesWithin50km}</span>
              <span className="stat-sub">{t.evFiresValue(evidence.firesWithin50km, evidence.firesUpwind)}</span>
            </div>
            <div className="stat mini">
              <span className="stat-label">{t.evHeadlines}</span>
              <span className="stat-value">{evidence.headlines}</span>
              <span className="stat-sub">{evidence.temperatureC !== null ? `${evidence.temperatureC}°C` : ""}</span>
            </div>
          </div>
          {evidence.basis && <p className="source-note">{t.evBasis(evidence.basis)}</p>}
          {evidence.trend.length > 1 && (
            <>
              <p className="review-label">{t.trendTitle}</p>
              <div className="trend-row">
                {evidence.trend.map((h) => (
                  <span key={h.at} className="trend-col" title={`${formatIstTime(h.at)} IST · ${h.pm25} µg/m³`}>
                    <span className="trend-bar" style={{ height: `${Math.max(6, (h.aqi / maxAqi) * 100)}%`, background: MAP_COLORS[categoryFromIndex(h.aqi)] }} />
                    <span className="trend-time">{formatIstTime(h.at)}</span>
                  </span>
                ))}
              </div>
            </>
          )}
        </section>
      )}

      {cited.length > 0 && (
        <section className="block">
          <h3 className="section-title">{t.citedTitle}</h3>
          <ol className="news-list">
            {cited.map((n) => (
              <li key={n}>
                <a href={articles[n - 1].link} target="_blank" rel="noreferrer" className="news-item">
                  <span className="news-num">{n}</span>
                  <span className="news-text">
                    <span className="news-title">{articles[n - 1].title}</span>
                    <span className="news-meta">
                      {articles[n - 1].source} {articles[n - 1].publishedAt ? `· ${ago(lang, articles[n - 1].publishedAt)}` : ""}
                    </span>
                  </span>
                </a>
              </li>
            ))}
          </ol>
        </section>
      )}

      {insight && (
        <p className="source-note block">
          {insight.model && insight.generatedAt ? `${t.insightMeta(insight.model, formatIstTime(insight.generatedAt))} · ` : ""}
          {t.insightDisclaimer}
        </p>
      )}
    </div>
  );
}

export function ReportsTab({
  lang,
  feed,
  focusId,
}: {
  lang: Lang;
  feed: Loadable<FeedData>;
  focusId: string | null;
}) {
  const t = COPY[lang];
  if (feed.state === "loading") return <Loading lang={lang} />;
  if (feed.state === "error" || !feed.data.available) return <p className="unavailable">{t.reportsUnavailable}</p>;
  const items = [...feed.data.reports].sort((a, b) => (a.id === focusId ? -1 : b.id === focusId ? 1 : 0));
  return (
    <div className="tab-body">
      <h2 className="place">{t.feedTitle}</h2>
      <p className="muted small">{t.feedPrivacy}</p>
      {items.length === 0 && <p className="muted block">{t.feedNone}</p>}
      <ul className="report-grid">
        {items.map((r) => (
          <li key={r.id} className={`report-card band-edge-${r.band}${r.id === focusId ? " is-focus" : ""}`}>
            <div className="report-card-head">
              <span className="report-claim">{t.reportedAs(t.claim[r.claim])}</span>
              <span className={`row-band band-${r.band}`}>{t.bandLabel[r.band]}</span>
            </div>
            <p className="report-meta">
              {DAYTIME.format(new Date(r.createdAt))} IST · {ago(lang, r.createdAt)}
              <br />
              {r.placeName ? `${r.placeName} · ` : ""}
              {t.kmAway(formatKm(r.km))}
              {r.confidence !== null ? ` · ${t.confidenceShort(r.confidence)}` : ""}
            </p>
            <ReviewBlock lang={lang} review={r} compact />
            {r.brief && <BriefCard lang={lang} brief={r.brief} />}
          </li>
        ))}
      </ul>
    </div>
  );
}

