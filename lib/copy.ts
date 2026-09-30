import type { CategoryKey } from "./aqi";
import type { Claim, HardFailReason } from "./confidence";
import type { Compass } from "./geo";

export type Lang = "en" | "hi";

const en = {
  wordmark: "Project Vayuchakra",
  enableSound: "Enable typing sound",
  soundOn: "Typing sound on",
  about: "About",
  close: "Close",
  langToggleLabel: "Switch language",
  locationOff: "Location off — showing Delhi. You can still tap the map.",
  nearYou: "NEAR YOU",
  selectedPoint: "SELECTED POINT",
  placeUnknown: "Unnamed place",
  loading: "Loading…",
  airUnavailable: "Air data is unavailable at this point right now.",
  hourlyScaleCaption: "Hourly PM2.5 on the India AQI scale",
  hourlyPm25: "Hourly PM2.5",
  srcGoogle: "Google Air Quality",
  srcCams: "CAMS via Open-Meteo · hourly",
  camsNote: "Global model, about 45 km grid. Not a street reading.",
  laterToday: (v: number, t: string) => `About ${v} µg/m³ around ${t} IST, from the same source.`,
  estimateLine: (v: number, model: string) =>
    `Spatial estimate ${v} µg/m³ · LightGBM ${model} · same-day reconstruction, not a forecast`,
  scaleGood: "Good",
  scaleSevere: "Severe",
  nearbyReports: "Nearby reports · 5 km",
  noNearbyReports: "No checked reports within 5 km.",
  reportWhatYouSee: "Report what you see",
  howNumberMade: "How this number is made",
  layerHeatmap: "Modelled PM2.5 field",
  layerStations: "Stations",
  heatmapLabel: "Modelled PM2.5 field · not a live sensor",
  stationsLabel: "Station areas · values from the air route, not CPCB live",
  stationArea: "station area · not CPCB live",
  zoomIn: "Zoom in",
  zoomOut: "Zoom out",
  bandLabel: { corroborated: "Checked", plausible: "Plausible", unverified: "Saved, not shown" } as Record<string, string>,
  yours: "Yours",
  rejectedLabel: "Not published",
  // Report flow
  back: "Back",
  reportTitle: "Report what you see",
  whatType: "What is it?",
  claim: {
    smoke: "Smoke or burning",
    dust: "Dust",
    traffic: "Traffic haze",
    construction: "Construction",
    unsure: "Not sure",
  } as Record<Claim, string>,
  note: "Note (optional)",
  notePlaceholder: "What do you see? Hindi or English.",
  photo: "Photo",
  takePhoto: "Take photo",
  chooseFile: "Choose file",
  photoTooBig: "That file is over 8 MB. Choose a smaller photo.",
  photoWrongType: "Use a JPEG, PNG, or WebP photo.",
  checkPhoto: "Check this photo",
  checking: (n: number) => `Checking the photo · attempt ${n} of 3`,
  attemptOf: (n: number) => `Attempt ${n} of 3`,
  tryAnother: "Choose another photo",
  done: "Done",
  pinLocked: "The report is tied to this pin. Go back to start one somewhere else.",
  networkError: "Something went wrong. Try again.",
  publishedCorroborated: "Published. It shows on the map as Checked.",
  publishedPlausible: "Published. It shows on the map as Plausible.",
  publishedUnverified: "Saved, not shown — confidence too low.",
  confidenceLine: (n: number) => `Confidence ${n} / 100`,
  rejected: "We could not verify a photo in 3 tries. Nothing was published.",
  rateLimited: "You can file 5 reports a day from this browser.",
  reportsUnavailable: "Reports are not available right now.",
  hardFail: {
    quality: "That frame is hard to read. Step back and include the sky or the source.",
    stock: "This looks like a screenshot or a downloaded picture. Take a photo here.",
    indoor: "This looks indoors. Step outside and retake it.",
    place_conflict: "This photo does not look like the pin. Retake it at the place you selected.",
    exif_far: "The photo’s location is {km} km from the pin. Retake it here, or move the pin.",
    gemini_failed: "We could not check that photo. Try another.",
  } as Record<HardFailReason, string>,
  // Context sentence
  compass: { n: "north", ne: "northeast", e: "east", se: "southeast", s: "south", sw: "southwest", w: "west", nw: "northwest" } as Record<Compass, string>,
  ctxReportsFire: (n: number, km: string, dir: string, h: number, compass: string, speed: number) =>
    `${n} checked ${n === 1 ? "report" : "reports"} within 5 km. A satellite hotspot was ${km} km ${dir} of here, ${h} h ago. Wind is from the ${compass} at ${speed} km/h, so nearby smoke can drift.`,
  ctxReports: (n: number, compass: string, speed: number) =>
    `${n} checked ${n === 1 ? "report" : "reports"} within 5 km. Wind is from the ${compass} at ${speed} km/h.`,
  ctxReportsNoWind: (n: number) => `${n} checked ${n === 1 ? "report" : "reports"} within 5 km.`,
  ctxFire: (km: string, h: number) =>
    `No checked reports within 5 km. A satellite hotspot was ${km} km away, ${h} h ago.`,
  ctxNothing: "No checked reports within 5 km. The number above is the hourly field at this point, not a street sensor.",
  // About
  aboutTitle: "About Project Vayuchakra",
  aboutIntro:
    "A single map for Delhi NCR. It shows what the air is doing at a point right now, and lets people file photo reports.",
  aboutDisclaimer:
    "Illustrative hotspot field where noted. Live air values come from Google Air Quality or CAMS. Citizen photos are checked by Gemini and are not official CPCB readings.",
  howTitle: "How this number is made",
  howBody: [
    "We take the latest hourly PM2.5 at the point from Google Air Quality. If Google has no PM2.5 value, we use the CAMS global model via Open-Meteo, which is about 45 km coarse.",
    "We place that hourly value on the CPCB 2014 India AQI breakpoints for PM2.5. CPCB’s official index uses a 24-hour average, so this is not the official CPCB AQI.",
    "If a same-day LightGBM spatial estimate exists for the point, it is shown as a separate line. It is a reconstruction, not a forecast.",
  ],
  sourcesTitle: "Data sources",
  sources: [
    "Google Air Quality API — current and hourly forecast PM2.5",
    "CAMS global forecast via Open-Meteo — fallback PM2.5",
    "Open-Meteo Forecast API — wind",
    "NASA FIRMS, VIIRS NOAA-20 — satellite fire hotspots",
    "Google Geocoding, then OpenStreetMap Nominatim — place names",
    "Map © OpenStreetMap contributors © CARTO",
  ],
  photosTitle: "Photo reports",
  photosBody:
    "Photo checks use Gemini. It looks at whether the scene is outdoors, matches what you chose, fits the pin, and agrees with nearby satellite fires. Each report gets 3 photo tries. Low-confidence reports are saved but not shown.",
};

type Copy = typeof en;

const hi: Copy = {
  ...en,
  enableSound: "टाइपिंग की आवाज़ चालू करें",
  soundOn: "टाइपिंग की आवाज़ चालू है",
  about: "परिचय",
  close: "बंद करें",
  langToggleLabel: "भाषा बदलें",
  locationOff: "लोकेशन बंद है — दिल्ली दिखा रहे हैं। आप फिर भी नक्शे पर टैप कर सकते हैं।",
  nearYou: "आपके पास",
  selectedPoint: "चुनी गई जगह",
  placeUnknown: "अज्ञात जगह",
  loading: "लोड हो रहा है…",
  airUnavailable: "इस जगह का हवा का डेटा अभी उपलब्ध नहीं है।",
  hourlyScaleCaption: "प्रति घंटा PM2.5, भारत AQI पैमाने पर",
  hourlyPm25: "प्रति घंटा PM2.5",
  srcCams: "CAMS via Open-Meteo · प्रति घंटा",
  camsNote: "वैश्विक मॉडल, लगभग 45 किमी ग्रिड। यह सड़क का माप नहीं है।",
  laterToday: (v, t) => `लगभग ${v} µg/m³, ${t} IST के आसपास, इसी स्रोत से।`,
  estimateLine: (v, model) =>
    `स्थानिक अनुमान ${v} µg/m³ · LightGBM ${model} · उसी दिन का पुनर्निर्माण, पूर्वानुमान नहीं`,
  scaleGood: "अच्छा",
  scaleSevere: "गंभीर",
  nearbyReports: "पास की रिपोर्ट · 5 किमी",
  noNearbyReports: "5 किमी के भीतर कोई जाँची गई रिपोर्ट नहीं।",
  reportWhatYouSee: "जो दिख रहा है, बताएँ",
  howNumberMade: "यह संख्या कैसे बनती है",
  layerHeatmap: "मॉडल PM2.5 परत",
  layerStations: "स्टेशन",
  heatmapLabel: "मॉडल PM2.5 परत · लाइव सेंसर नहीं",
  stationsLabel: "स्टेशन क्षेत्र · मान हवा रूट से, CPCB लाइव नहीं",
  stationArea: "स्टेशन क्षेत्र · CPCB लाइव नहीं",
  zoomIn: "ज़ूम इन",
  zoomOut: "ज़ूम आउट",
  bandLabel: { corroborated: "जाँची गई", plausible: "संभावित", unverified: "सहेजी गई, दिखाई नहीं गई" },
  yours: "आपकी",
  rejectedLabel: "प्रकाशित नहीं",
  back: "वापस",
  reportTitle: "जो दिख रहा है, बताएँ",
  whatType: "यह क्या है?",
  claim: {
    smoke: "धुआँ या जलना",
    dust: "धूल",
    traffic: "ट्रैफ़िक धुंध",
    construction: "निर्माण",
    unsure: "पक्का नहीं",
  },
  note: "टिप्पणी (वैकल्पिक)",
  notePlaceholder: "आपको क्या दिख रहा है? हिंदी या अंग्रेज़ी में।",
  photo: "फ़ोटो",
  takePhoto: "फ़ोटो लें",
  chooseFile: "फ़ाइल चुनें",
  photoTooBig: "यह फ़ाइल 8 MB से बड़ी है। छोटी फ़ोटो चुनें।",
  photoWrongType: "JPEG, PNG या WebP फ़ोटो इस्तेमाल करें।",
  checkPhoto: "यह फ़ोटो जाँचें",
  checking: (n) => `फ़ोटो जाँची जा रही है · प्रयास ${n} / 3`,
  attemptOf: (n) => `प्रयास ${n} / 3`,
  tryAnother: "दूसरी फ़ोटो चुनें",
  done: "ठीक है",
  pinLocked: "यह रिपोर्ट इसी पिन से जुड़ी है। दूसरी जगह के लिए वापस जाएँ।",
  networkError: "कुछ गड़बड़ हुई। फिर से कोशिश करें।",
  publishedCorroborated: "प्रकाशित। नक्शे पर ‘जाँची गई’ के रूप में दिखेगी।",
  publishedPlausible: "प्रकाशित। नक्शे पर ‘संभावित’ के रूप में दिखेगी।",
  publishedUnverified: "सहेजी गई, दिखाई नहीं गई — भरोसा बहुत कम है।",
  confidenceLine: (n) => `भरोसा ${n} / 100`,
  rejected: "3 प्रयासों में फ़ोटो की पुष्टि नहीं हो सकी। कुछ भी प्रकाशित नहीं हुआ।",
  rateLimited: "इस ब्राउज़र से आप एक दिन में 5 रिपोर्ट भेज सकते हैं।",
  reportsUnavailable: "रिपोर्ट अभी उपलब्ध नहीं हैं।",
  hardFail: {
    quality: "यह फ़्रेम साफ़ नहीं है। थोड़ा पीछे हटें और आसमान या स्रोत को शामिल करें।",
    stock: "यह स्क्रीनशॉट या डाउनलोड की गई तस्वीर लगती है। यहीं फ़ोटो लें।",
    indoor: "यह अंदर की फ़ोटो लगती है। बाहर जाकर दोबारा लें।",
    place_conflict: "यह फ़ोटो पिन वाली जगह की नहीं लगती। चुनी गई जगह पर दोबारा लें।",
    exif_far: "फ़ोटो की लोकेशन पिन से {km} किमी दूर है। यहीं दोबारा लें, या पिन हटाएँ।",
    gemini_failed: "हम उस फ़ोटो की जाँच नहीं कर सके। दूसरी आज़माएँ।",
  },
  compass: { n: "उत्तर", ne: "उत्तर-पूर्व", e: "पूर्व", se: "दक्षिण-पूर्व", s: "दक्षिण", sw: "दक्षिण-पश्चिम", w: "पश्चिम", nw: "उत्तर-पश्चिम" },
  ctxReportsFire: (n, km, dir, h, compass, speed) =>
    `5 किमी के भीतर ${n} जाँची गई रिपोर्ट। ${h} घंटे पहले यहाँ से ${km} किमी ${dir} में एक सैटेलाइट हॉटस्पॉट था। हवा ${compass} से ${speed} km/h पर है, इसलिए पास का धुआँ यहाँ आ सकता है।`,
  ctxReports: (n, compass, speed) =>
    `5 किमी के भीतर ${n} जाँची गई रिपोर्ट। हवा ${compass} से ${speed} km/h पर है।`,
  ctxReportsNoWind: (n) => `5 किमी के भीतर ${n} जाँची गई रिपोर्ट।`,
  ctxFire: (km, h) =>
    `5 किमी के भीतर कोई जाँची गई रिपोर्ट नहीं। ${h} घंटे पहले ${km} किमी दूर एक सैटेलाइट हॉटस्पॉट था।`,
  ctxNothing: "5 किमी के भीतर कोई जाँची गई रिपोर्ट नहीं। ऊपर की संख्या इस जगह का प्रति घंटा मान है, सड़क का सेंसर नहीं।",
  aboutTitle: "प्रोजेक्ट वायुचक्र के बारे में",
  aboutIntro:
    "दिल्ली NCR के लिए एक नक्शा। यह बताता है कि किसी जगह पर अभी हवा कैसी है, और लोगों को फ़ोटो रिपोर्ट भेजने देता है।",
  aboutDisclaimer:
    "जहाँ लिखा है, हॉटस्पॉट परत केवल उदाहरण है। लाइव हवा के मान Google Air Quality या CAMS से आते हैं। नागरिकों की फ़ोटो Gemini से जाँची जाती हैं और ये आधिकारिक CPCB माप नहीं हैं।",
  howTitle: "यह संख्या कैसे बनती है",
  howBody: [
    "हम उस जगह का ताज़ा प्रति घंटा PM2.5 Google Air Quality से लेते हैं। अगर Google के पास PM2.5 नहीं है, तो Open-Meteo के ज़रिए CAMS वैश्विक मॉडल लेते हैं, जो लगभग 45 किमी मोटा है।",
    "इस प्रति घंटा मान को PM2.5 के CPCB 2014 भारत AQI ब्रेकपॉइंट पर रखते हैं। CPCB का आधिकारिक सूचकांक 24 घंटे का औसत लेता है, इसलिए यह आधिकारिक CPCB AQI नहीं है।",
    "अगर उस जगह के लिए उसी दिन का LightGBM स्थानिक अनुमान है, तो वह अलग पंक्ति में दिखता है। यह पुनर्निर्माण है, पूर्वानुमान नहीं।",
  ],
  sourcesTitle: "डेटा स्रोत",
  photosTitle: "फ़ोटो रिपोर्ट",
  photosBody:
    "फ़ोटो की जाँच Gemini करता है। वह देखता है कि दृश्य बाहर का है या नहीं, आपके चुने प्रकार से मेल खाता है या नहीं, पिन से मेल खाता है या नहीं, और पास की सैटेलाइट आग से सहमत है या नहीं। हर रिपोर्ट को फ़ोटो के 3 मौके मिलते हैं। कम भरोसे वाली रिपोर्ट सहेजी जाती हैं पर दिखाई नहीं जातीं।",
};

export const COPY: Record<Lang, Copy> = { en, hi };

export const CATEGORY_LABEL: Record<Lang, Record<CategoryKey, string>> = {
  en: { good: "Good", satisfactory: "Satisfactory", moderate: "Moderate", poor: "Poor", very_poor: "Very poor", severe: "Severe" },
  hi: { good: "अच्छा", satisfactory: "संतोषजनक", moderate: "मध्यम", poor: "ख़राब", very_poor: "बहुत ख़राब", severe: "गंभीर" },
};

export function hardFailMessage(lang: Lang, reason: HardFailReason, km?: number): string {
  return COPY[lang].hardFail[reason].replace("{km}", km === undefined ? "" : km < 10 ? km.toFixed(1) : String(Math.round(km)));
}
