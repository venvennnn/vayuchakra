import "server-only";
import { CATEGORY_LABEL_EN, categoryFromIndex, pm25SubIndex } from "./aqi";
import { cached, cellKey, fetchJson, hourBucket } from "./cache";
import { COPY, type Lang } from "./copy";
import { compassFromDeg, formatKm, haversineKm, type Compass } from "./geo";
import { supabaseAdmin } from "./supabase/server";

const AIR_TTL = 30 * 60 * 1000;
const OPEN_METEO = () => process.env.OPEN_METEO_BASE || "https://api.open-meteo.com";
const OPEN_METEO_AIR = () => process.env.AIR_QUALITY_OPEN_METEO_BASE || "https://air-quality-api.open-meteo.com";

export type AirSource = "google_air_quality" | "open_meteo_cams";

type HourPoint = { at: string; pm25: number };
type SourceReading = { pm25: number; observedAt: string; hourly: HourPoint[] };

export type Estimate = { pm25: number; modelVersion: string; observationDate: string };

export type AirResponse = {
  placeName: string | null;
  pm25: number;
  pm25Unit: "µg/m³";
  aqi: number;
  category: string;
  source: AirSource;
  sourceLabel: string;
  observedAt: string;
  hourlyNotOfficial: true;
  forecastPm25: number | null;
  forecastAt: string | null;
  windFromDeg: number | null;
  windKmh: number | null;
  estimate: Estimate | null;
};

type GooglePollutant = { code: string; concentration?: { value: number; units: string } };
type GoogleCurrent = { dateTime: string; pollutants?: GooglePollutant[] };
type GoogleForecast = { hourlyForecasts?: { dateTime: string; pollutants?: GooglePollutant[] }[] };

/** PM is a mass concentration; only µg/m³ is usable. */
function googlePm25(pollutants: GooglePollutant[] | undefined): number | null {
  const p = pollutants?.find((x) => x.code === "pm25");
  if (!p?.concentration || p.concentration.units !== "MICROGRAMS_PER_CUBIC_METER") return null;
  const v = Number(p.concentration.value);
  return Number.isFinite(v) && v >= 0 ? v : null;
}

async function googleCurrent(lat: number, lng: number): Promise<{ pm25: number; observedAt: string } | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return null;
  return cached(`gaq_current:${cellKey(lat, lng)}:${hourBucket()}`, "google_current", AIR_TTL, async () => {
    const data = await fetchJson<GoogleCurrent>(
      `https://airquality.googleapis.com/v1/currentConditions:lookup?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          universalAqi: true,
          location: { latitude: lat, longitude: lng },
          extraComputations: ["LOCAL_AQI", "POLLUTANT_CONCENTRATION", "HEALTH_RECOMMENDATIONS", "DOMINANT_POLLUTANT_CONCENTRATION"],
          languageCode: "en",
        }),
      },
    );
    const pm25 = googlePm25(data.pollutants);
    return pm25 === null ? null : { pm25, observedAt: new Date(data.dateTime).toISOString() };
  });
}

async function googleForecast(lat: number, lng: number): Promise<HourPoint[]> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return [];
  const result = await cached(`gaq_forecast:${cellKey(lat, lng)}:${hourBucket()}`, "google_forecast", AIR_TTL, async () => {
    const start = new Date();
    start.setUTCMinutes(0, 0, 0);
    start.setUTCHours(start.getUTCHours() + 1);
    const end = new Date(start.getTime() + 24 * 3600 * 1000);
    const data = await fetchJson<GoogleForecast>(`https://airquality.googleapis.com/v1/forecast:lookup?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        universalAqi: true,
        location: { latitude: lat, longitude: lng },
        extraComputations: ["POLLUTANT_CONCENTRATION"],
        pageSize: 24,
        period: { startTime: start.toISOString(), endTime: end.toISOString() },
      }),
    });
    const hours = (data.hourlyForecasts ?? [])
      .map((h) => ({ at: new Date(h.dateTime).toISOString(), pm25: googlePm25(h.pollutants) }))
      .filter((h): h is HourPoint => h.pm25 !== null);
    return hours;
  }).catch(() => null);
  return result ?? [];
}

type OpenMeteoAir = {
  utc_offset_seconds: number;
  current?: { time: string; pm2_5: number | null };
  hourly?: { time: string[]; pm2_5: (number | null)[] };
};

/** Open-Meteo returns local wall-clock times; convert with its reported UTC offset. */
function omTimeToIso(local: string, offsetSeconds: number): string {
  return new Date(new Date(`${local}:00Z`).getTime() - offsetSeconds * 1000).toISOString();
}

export async function openMeteoAir(lat: number, lng: number): Promise<SourceReading | null> {
  return cached(`om_air:${cellKey(lat, lng)}:${hourBucket()}`, "open_meteo_air", AIR_TTL, async () => {
    const url =
      `${OPEN_METEO_AIR()}/v1/air-quality?latitude=${lat}&longitude=${lng}` +
      `&current=pm2_5,pm10,us_aqi&hourly=pm2_5,pm10&forecast_days=2&timezone=Asia%2FKolkata`;
    const data = await fetchJson<OpenMeteoAir>(url);
    const pm25 = data.current?.pm2_5;
    if (pm25 === null || pm25 === undefined || !Number.isFinite(pm25)) return null;
    const hourly: HourPoint[] = [];
    data.hourly?.time.forEach((t, i) => {
      const v = data.hourly?.pm2_5[i];
      if (v !== null && v !== undefined) hourly.push({ at: omTimeToIso(t, data.utc_offset_seconds), pm25: v });
    });
    return { pm25, observedAt: omTimeToIso(data.current!.time, data.utc_offset_seconds), hourly };
  });
}

/** Forecast value about 6 h ahead, if the source has one within 90 min of that mark. */
function aboutSixHoursAhead(hours: HourPoint[]): HourPoint | null {
  const target = Date.now() + 6 * 3600 * 1000;
  let best: HourPoint | null = null;
  for (const h of hours) {
    const d = Math.abs(new Date(h.at).getTime() - target);
    if (d <= 90 * 60 * 1000 && (!best || d < Math.abs(new Date(best.at).getTime() - target))) best = h;
  }
  return best;
}

type Weather = { windKmh: number; windFromDeg: number; temperatureC: number };

export async function getWeather(lat: number, lng: number): Promise<Weather | null> {
  return cached(`weather:${cellKey(lat, lng)}:${hourBucket()}`, "weather", AIR_TTL, async () => {
    const url =
      `${OPEN_METEO()}/v1/forecast?latitude=${lat}&longitude=${lng}` +
      `&current=temperature_2m,wind_speed_10m,wind_direction_10m&timezone=Asia%2FKolkata`;
    const data = await fetchJson<{
      current?: { temperature_2m: number; wind_speed_10m: number; wind_direction_10m: number };
    }>(url);
    const c = data.current;
    if (!c || !Number.isFinite(c.wind_speed_10m) || !Number.isFinite(c.wind_direction_10m)) return null;
    return { windKmh: c.wind_speed_10m, windFromDeg: c.wind_direction_10m, temperatureC: c.temperature_2m };
  }).catch(() => null);
}

function istDate(offsetDays = 0): string {
  const d = new Date(Date.now() + 5.5 * 3600 * 1000 - offsetDays * 86400 * 1000);
  return d.toISOString().slice(0, 10);
}

/** Nearest pm25_estimates row within about 5 km, from today or yesterday (IST). */
export async function getEstimate(lat: number, lng: number): Promise<Estimate | null> {
  const sb = supabaseAdmin();
  if (!sb) return null;
  const { data, error } = await sb
    .from("pm25_estimates")
    .select("lat, lng, observation_date, predicted_pm25, model_version")
    .gte("observation_date", istDate(1))
    .lte("observation_date", istDate(0))
    .gte("lat", lat - 0.05)
    .lte("lat", lat + 0.05)
    .gte("lng", lng - 0.05)
    .lte("lng", lng + 0.05)
    .limit(200);
  if (error || !data?.length) return null;
  const best = data
    .map((r) => ({ r, d: haversineKm({ lat, lng }, { lat: r.lat, lng: r.lng }) }))
    .sort((a, b) => (b.r.observation_date > a.r.observation_date ? 1 : b.r.observation_date < a.r.observation_date ? -1 : a.d - b.d))[0];
  return {
    pm25: Math.round(best.r.predicted_pm25),
    modelVersion: best.r.model_version,
    observationDate: best.r.observation_date,
  };
}

export type LiveReading = { source: AirSource; pm25: number; observedAt: string; forecast: HourPoint | null };

export async function getLiveReading(lat: number, lng: number): Promise<LiveReading | null> {
  try {
    const g = await googleCurrent(lat, lng);
    if (g) {
      const hours = await googleForecast(lat, lng);
      return { source: "google_air_quality", pm25: g.pm25, observedAt: g.observedAt, forecast: aboutSixHoursAhead(hours) };
    }
  } catch {
    // Fall through to CAMS.
  }
  try {
    const om = await openMeteoAir(lat, lng);
    if (om) return { source: "open_meteo_cams", pm25: om.pm25, observedAt: om.observedAt, forecast: aboutSixHoursAhead(om.hourly) };
  } catch {
    // Total failure handled by caller.
  }
  return null;
}

export const SOURCE_LABEL: Record<AirSource, string> = {
  google_air_quality: "Google Air Quality",
  open_meteo_cams: "CAMS via Open-Meteo",
};

export function toAirResponse(
  live: LiveReading,
  placeName: string | null,
  weather: Weather | null,
  estimate: Estimate | null,
): AirResponse {
  const pm25 = Math.round(live.pm25);
  const aqi = pm25SubIndex(live.pm25);
  return {
    placeName,
    pm25,
    pm25Unit: "µg/m³",
    aqi,
    category: CATEGORY_LABEL_EN[categoryFromIndex(aqi)],
    source: live.source,
    sourceLabel: SOURCE_LABEL[live.source],
    observedAt: live.observedAt,
    hourlyNotOfficial: true,
    forecastPm25: live.forecast ? Math.round(live.forecast.pm25) : null,
    forecastAt: live.forecast?.at ?? null,
    windFromDeg: weather ? Math.round(weather.windFromDeg) : null,
    windKmh: weather ? Math.round(weather.windKmh) : null,
    estimate,
  };
}

export type ContextInput = {
  reportCount: number;
  windKmh: number | null;
  windFrom: Compass | null;
  fire: { km: number; direction: Compass; hoursAgo: number } | null;
};

export function buildContextSentence(lang: Lang, c: ContextInput): string {
  const t = COPY[lang];
  const hasWind = c.windKmh !== null && c.windFrom !== null;
  if (c.reportCount > 0 && c.fire && hasWind) {
    return t.ctxReportsFire(c.reportCount, formatKm(c.fire.km), t.compass[c.fire.direction], c.fire.hoursAgo, t.compass[c.windFrom!], c.windKmh!);
  }
  if (c.reportCount > 0 && hasWind) return t.ctxReports(c.reportCount, t.compass[c.windFrom!], c.windKmh!);
  if (c.reportCount === 0 && c.fire) return t.ctxFire(formatKm(c.fire.km), c.fire.hoursAgo);
  if (c.reportCount > 0) return t.ctxReportsNoWind(c.reportCount);
  return t.ctxNothing;
}

export function windCompass(deg: number | null): Compass | null {
  return deg === null ? null : compassFromDeg(deg);
}
