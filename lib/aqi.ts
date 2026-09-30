export type CategoryKey =
  | "good"
  | "satisfactory"
  | "moderate"
  | "poor"
  | "very_poor"
  | "severe";

type Breakpoint = { bpLo: number; bpHi: number; iLo: number; iHi: number };

// CPCB 2014 National AQI, PM2.5 (µg/m³). CPCB applies these to a 24 h mean;
// we apply them to an hourly value and label the result accordingly.
export const PM25_BREAKPOINTS: Breakpoint[] = [
  { bpLo: 0, bpHi: 30, iLo: 0, iHi: 50 },
  { bpLo: 31, bpHi: 60, iLo: 51, iHi: 100 },
  { bpLo: 61, bpHi: 90, iLo: 101, iHi: 200 },
  { bpLo: 91, bpHi: 120, iLo: 201, iHi: 300 },
  { bpLo: 121, bpHi: 250, iLo: 301, iHi: 400 },
  { bpLo: 251, bpHi: 380, iLo: 401, iHi: 500 },
];

export function pm25SubIndex(pm25: number): number {
  if (!Number.isFinite(pm25) || pm25 < 0) return 0;
  // Breakpoints are integers with 1-unit gaps (30 → 31); CPCB rounds the concentration first.
  const c = Math.round(pm25);
  if (c > 380) return 500;
  const band = PM25_BREAKPOINTS.find((b) => c <= b.bpHi) ?? PM25_BREAKPOINTS[0];
  const sub = ((band.iHi - band.iLo) / (band.bpHi - band.bpLo)) * (c - band.bpLo) + band.iLo;
  return Math.min(500, Math.max(0, Math.round(sub)));
}

export function categoryFromIndex(aqi: number): CategoryKey {
  if (aqi <= 50) return "good";
  if (aqi <= 100) return "satisfactory";
  if (aqi <= 200) return "moderate";
  if (aqi <= 300) return "poor";
  if (aqi <= 400) return "very_poor";
  return "severe";
}

export const CATEGORY_LABEL_EN: Record<CategoryKey, string> = {
  good: "Good",
  satisfactory: "Satisfactory",
  moderate: "Moderate",
  poor: "Poor",
  very_poor: "Very poor",
  severe: "Severe",
};

export const CATEGORY_COLORS: Record<CategoryKey, { ink: string; pill: string }> = {
  good: { ink: "#1f7a4d", pill: "#e7f4ec" },
  satisfactory: { ink: "#3d8b4a", pill: "#eef6e4" },
  moderate: { ink: "#9a7b12", pill: "#f8f1d8" },
  poor: { ink: "#c46a1a", pill: "#fde8d4" },
  very_poor: { ink: "#c4482d", pill: "#fde3dc" },
  severe: { ink: "#8d2f4a", pill: "#f8e3ea" },
};
