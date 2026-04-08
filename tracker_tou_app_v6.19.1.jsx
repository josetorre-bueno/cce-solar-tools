// MOD-09 tracker_analyzer — module
// Version: v6.19.1
// Part of: Wipomo / CCE Solar Tools (see TOOL_ARCHITECTURE_5.md)
// Calls: MOD-01 (pvwatts), MOD-04 (rate_engine)
// Outputs to: MOD-05 (bill_modeler), MOD-06 (battery_simulator)

// ─── REACT GLOBALS ────────────────────────────────────────────────────────────
// When loaded as an external script via Babel src=, React hooks are not
// injected automatically — they must be destructured from the React global.
const { useState, useMemo, useCallback, useRef } = React;

const VERSION = "6.19.1";

// ─── PVWATTS API CONFIG ───────────────────────────────────────────────────────
// Endpoint: NREL PVWatts v8 (domain migrated to developer.nlr.gov, Apr 2026)
// array_type=4 → dual-axis tracking | array_type=0 → fixed open rack
// tilt=15 for fixed (per Wipomo spec) | losses=14 (default)
// DC:AC 1.2 for fixed carport | DC:AC 1.1 for tracker (larger inverter captures sustained output)
const PVWATTS_BASE        = "https://developer.nlr.gov/api/pvwatts/v8.json";
const PVWATTS_KEY         = "U6uDdjf1z12nH28I5O3G3dxpghQlD3FvWMKiDiDj";
const LOSSES              = 14;

// ─── TOU RATE SCHEDULES ───────────────────────────────────────────────────────
// PURPOSE: These rates are used ONLY to weight the dollar value of hourly
// production by TOU period. This tool does NOT model demand charges, customer
// charges, non-bypassable charges, or export credits — those belong in MOD-05.
// The only rates needed here are energy rates ($/kWh) by TOU period.
const TOU_RATES = {
  "SDG&E TOU-A": {
    label: "SDG&E Schedule TOU-A — Small Commercial (< 20 kW demand)",
    rateNote: "Effective Feb 1, 2025 · Secondary voltage · Bundled service",
    ratesVerified: "2025-03-05",
    tariffUrl: "https://www.sdge.com/sites/default/files/regulatory/2-1-25%20Schedule%20TOU-A%20Total%20Rates%20Table.pdf",
    seasonalRates: {
      summer: { peak: 0.535, offpeak: 0.407 },
      winter: { peak: 0.417, offpeak: 0.333 },
    },
    schedule: (month, hour) => hour >= 16 && hour < 21 ? "peak" : "offpeak",
    getSeasonal: (month) => month >= 6 && month <= 10 ? "summer" : "winter",
  },
  "SDG&E AL-TOU": {
    label: "SDG&E Schedule AL-TOU — General Commercial (≥ 20 kW demand)",
    rateNote: "Effective Oct 1, 2025 · Secondary voltage · Bundled service",
    ratesVerified: "2025-03-05",
    tariffUrl: "https://www.sdge.com/sites/default/files/regulatory/10-1-25%20Schedule%20AL-TOU%20Total%20Rates%20Table.pdf",
    seasonalRates: {
      summer: { peak: 0.242, offpeak: 0.151, superoffpeak: 0.132 },
      winter: { peak: 0.264, offpeak: 0.154, superoffpeak: 0.121 },
    },
    schedule: (month, hour) => {
      if (hour >= 16 && hour < 21) return "peak";
      if (hour < 6 || hour >= 21) return "superoffpeak";
      return "offpeak";
    },
    getSeasonal: (month) => month >= 6 && month <= 10 ? "summer" : "winter",
  },
  "SDG&E AL-TOU-2": {
    label: "SDG&E Schedule AL-TOU-2 — Medium/Large Commercial (≥20 kW, demand ratchet)",
    rateNote: "Effective Oct 1, 2025 · Secondary voltage · Bundled service",
    ratesVerified: "2025-10-01",
    tariffUrl: "https://www.sdge.com/sites/default/files/regulatory/10-1-25%20Schedule%20AL-TOU-2%20Total%20Rates%20Table.pdf",
    seasonalRates: {
      summer: { peak: 0.221, offpeak: 0.139, superoffpeak: 0.121 },
      winter: { peak: 0.240, offpeak: 0.140, superoffpeak: 0.111 },
    },
    // isWeekend param optional — caller passes it for accurate Mar/Apr super off-peak
    schedule: (month, hour, isWeekend) => {
      if (hour >= 16 && hour < 21) return "peak";
      if (hour < 6 || hour >= 21) return "superoffpeak";
      // Mar (3) and Apr (4) weekdays: 10am–2pm is super off-peak
      if (!isWeekend && (month === 3 || month === 4) && hour >= 10 && hour < 14) return "superoffpeak";
      return "offpeak";
    },
    getSeasonal: (month) => month >= 6 && month <= 10 ? "summer" : "winter",
  },
  "SCE": {
    label: "SCE TOU-GS-1 — Small Commercial",
    rateNote: "Approximate 2025 rates · Verify with current SCE tariff",
    ratesVerified: "2025-03-05",
    tariffUrl: "https://www.sce.com/sites/default/files/inline-files/TOU-GS-1.pdf",
    seasonalRates: {
      summer: { peak: 0.52, offpeak: 0.30, superoffpeak: 0.16 },
      winter: { peak: 0.38, offpeak: 0.25, superoffpeak: 0.14 },
    },
    schedule: (month, hour) => {
      if (hour >= 16 && hour < 21) return "peak";
      if (month >= 6 && month <= 10 && hour >= 9 && hour < 16) return "superoffpeak";
      return "offpeak";
    },
    getSeasonal: (month) => month >= 6 && month <= 10 ? "summer" : "winter",
  },
  "PG&E": {
    label: "PG&E B-6 TOU — Small/Medium Commercial",
    rateNote: "Approximate 2025 rates · Verify with current PG&E tariff",
    ratesVerified: "2025-03-05",
    tariffUrl: "https://www.pge.com/tariffs/assets/pdf/tariffbook/ELEC_SCHEDS_B-6.pdf",
    seasonalRates: {
      summer: { peak: 0.48, offpeak: 0.27, superoffpeak: 0.15 },
      winter: { peak: 0.35, offpeak: 0.22, superoffpeak: 0.13 },
    },
    schedule: (month, hour) => {
      if (hour >= 16 && hour < 21) return "peak";
      if (month >= 6 && month <= 10 && hour >= 9 && hour < 16) return "superoffpeak";
      return "offpeak";
    },
    getSeasonal: (month) => month >= 6 && month <= 10 ? "summer" : "winter",
  },
  "SDG&E TOU-DR1": {
    label: "SDG&E Schedule TOU-DR1 — Standard Residential TOU",
    rateNote: "Effective Oct 1, 2025 · Bundled service · Peak 4–9 PM daily",
    ratesVerified: "2025-03-05",
    tariffUrl: "https://www.sdge.com/sites/default/files/regulatory/10-1-25%20Schedule%20TOU-DR1%20Total%20Rates%20Table.pdf",
    seasonalRates: {
      summer: { peak: 0.673, offpeak: 0.433, superoffpeak: 0.307 },
      winter: { peak: 0.522, offpeak: 0.457, superoffpeak: 0.439 },
    },
    schedule: (month, hour) => {
      if (hour >= 16 && hour < 21) return "peak";
      if (hour >= 21 || hour < 6) return "superoffpeak";
      return "offpeak";
    },
    getSeasonal: (month) => month >= 6 && month <= 10 ? "summer" : "winter",
  },
  "SDG&E DR-SES": {
    label: "SDG&E Schedule DR-SES — Residential Solar (NEM, pre-Apr 2023)",
    rateNote: "Effective Oct 1, 2025 · Bundled service · For NEM customers interconnected before Apr 14, 2023",
    ratesVerified: "2025-03-05",
    tariffUrl: "https://www.sdge.com/sites/default/files/regulatory/10-1-25%20Schedule%20DR-SES%20Total%20Rates%20Table.pdf",
    seasonalRates: {
      summer: { peak: 0.656, offpeak: 0.399, superoffpeak: 0.320 },
      winter: { peak: 0.422, offpeak: 0.374, superoffpeak: 0.314 },
    },
    schedule: (month, hour) => {
      if (hour >= 16 && hour < 21) return "peak";
      if (hour >= 21 || hour < 6) return "superoffpeak";
      return "offpeak";
    },
    getSeasonal: (month) => month >= 6 && month <= 10 ? "summer" : "winter",
  },
  "APU TOU-2": {
    label: "Anaheim Public Utilities Schedule TOU-2 — Domestic Time-of-Use",
    rateNote: "Base rates effective May 1, 2024 (Res. 2024-022) + RSA effective Dec 1, 2025 (PCA $0.010 + EMA $0.0055 = +$0.0155/kWh)",
    ratesVerified: "2026-03-28",
    tariffUrl: "https://www.anaheim.net/DocumentCenter/View/25947/Developmental-Schedule-D-TOU-2-050119",
    seasonalRates: {
      // Base rates + RSA Dec 2025 (+$0.0155/kWh all domestic periods)
      summer: { peak: 0.3475, offpeak: 0.1820 },
      // Winter has super off-peak (8am-4pm weekdays; midnight-4pm + 9pm-midnight weekends/holidays)
      winter: { peak: 0.3280, offpeak: 0.1770, superoffpeak: 0.1355 },
    },
    // Summer: on-peak 4-9pm weekdays; all other hours off-peak (no SOP in summer)
    // Winter: on-peak 4-9pm weekdays; SOP 8am-4pm weekdays + midnight-4pm/9pm-midnight weekends
    // Note: weekend/holiday distinction not modeled here — using weekday schedule as approximation
    schedule: (month, hour) => {
      const isSummer = month >= 7 && month <= 10;  // Jul 1 – Nov 1
      if (hour >= 16 && hour < 21) return "peak";
      if (!isSummer && hour >= 8 && hour < 16) return "superoffpeak";
      return "offpeak";
    },
    getSeasonal: (month) => month >= 7 && month <= 10 ? "summer" : "winter",
  },
  "SDG&E EV-TOU-5": {
    label: "SDG&E Schedule EV-TOU-5 — Residential EV / Solar Billing Plan (NEM 3.0)",
    rateNote: "Effective Jan 1, 2026 · Bundled service · For EV owners & solar interconnected after Apr 14, 2023",
    ratesVerified: "2026-01-01",
    tariffUrl: "https://www.sdge.com/sites/default/files/regulatory/1-1-26%20Schedule%20EV-TOU-5%20Total%20Rates%20Table.pdf",
    seasonalRates: {
      summer: { peak: 0.800, offpeak: 0.502, superoffpeak: 0.124 },
      winter: { peak: 0.529, offpeak: 0.473, superoffpeak: 0.117 },
    },
    schedule: (month, hour) => {
      if (hour >= 16 && hour < 21) return "peak";
      if (hour >= 21 || hour < 6) return "superoffpeak";
      return "offpeak";
    },
    getSeasonal: (month) => month >= 6 && month <= 10 ? "summer" : "winter",
  },
};

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MONTH_DAYS = [31,28,31,30,31,30,31,31,30,31,30,31];

// ─── GEOCODE + PVWATTS FETCH ──────────────────────────────────────────────────
// Step 1: Nominatim (OpenStreetMap) geocodes address → lat/lon (free, no key)
// Step 2: PVWatts v8 called with lat/lon (address param not supported in v8)
async function geocodeAddress(address) {
  const cleaned = address.trim();
  const query = /^\d{5}$/.test(cleaned) ? `${cleaned}, USA` : cleaned;
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
  let res;
  try {
    res = await fetch(url, { headers: { "Accept-Language": "en" } });
  } catch (e) {
    throw new Error(`Geocoding network error: ${e.message}`);
  }
  if (!res.ok) throw new Error(`Geocoding failed: HTTP ${res.status}`);
  const results = await res.json();
  if (!results || results.length === 0) throw new Error(`Address not found: "${address}". Try a simpler address or city/state.`);
  return { lat: parseFloat(results[0].lat), lon: parseFloat(results[0].lon), display: results[0].display_name };
}

// Map user's expected bifacial gain % → albedo value for PVWatts
// bifaciality=0.7 (standard TOPCon/PERC bifacial module property, fixed)
function bifacialToAlbedo(gainPct) {
  if (gainPct <= 0)  return 0.2;   // monofacial
  if (gainPct <= 2)  return 0.12;  // dark gravel / asphalt  ~2%
  if (gainPct <= 3)  return 0.25;  // light gravel / concrete ~3%
  return              0.45;         // white concrete / paint  ~5%
}

async function fetchPVWatts({ lat, lon, systemCapacity, arrayType, tilt, azimuth, dcAcRatio, bifacial = 0 }) {
  const params = new URLSearchParams({
    api_key:         PVWATTS_KEY,
    lat,
    lon,
    system_capacity: systemCapacity,
    array_type:      arrayType,
    tilt,
    azimuth,
    dc_ac_ratio:     dcAcRatio,
    bifaciality:     bifacial > 0 ? 0.7 : 0,
    albedo:          bifacialToAlbedo(bifacial),
    losses:          LOSSES,
    timeframe:       "hourly",
    module_type:     1,
  });
  const url = `${PVWATTS_BASE}?${params}`;
  let res;
  try {
    res = await fetch(url);
  } catch (netErr) {
    throw new Error(`Network error reaching NLR API: ${netErr.message}`);
  }
  if (!res.ok) {
    let body = "";
    try { body = await res.text(); } catch(_) {}
    throw new Error(`PVWatts API returned HTTP ${res.status}. ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  if (data.errors && data.errors.length > 0) throw new Error(data.errors.join("; "));
  const raw = data.outputs.ac;
  if (!raw || !Array.isArray(raw)) {
    throw new Error(`PVWatts returned no hourly data. Keys: ${Object.keys(data.outputs || {}).join(", ")}`);
  }
  return {
    ac_hourly:    raw.map(w => w / 1000),   // Wh → kWh
    station_info: data.station_info,
  };
}

// ─── HOURLY COMPUTATION ───────────────────────────────────────────────────────
// PVWatts hourly returns 8,760 Wh values (converted to kWh on fetch).
// Each hour is assigned its exact TOU rate (energy only — no demand charges).
// Dollar value = production kWh × TOU energy rate for that hour.

const MONTH_START_HOUR = [0,744,1416,2160,2880,3624,4344,5088,5832,6552,7296,8016];

function computeFromHourly(acHourlyFixed, acHourlyTracker, utility) {
  const tou = TOU_RATES[utility];
  let fixedKwh = 0, trackerKwh = 0;
  let fixedValue = 0, trackerValue = 0;

  const mFixed      = new Array(12).fill(0);
  const mTracker    = new Array(12).fill(0);
  const mFixedVal   = new Array(12).fill(0);
  const mTrackerVal = new Array(12).fill(0);

  // Precompute month index for each of the 8760 hours
  const hourMonth = new Array(8760);
  let mi2 = 0;
  for (let i = 0; i < 8760; i++) {
    while (mi2 < 11 && i >= MONTH_START_HOUR[mi2 + 1]) mi2++;
    hourMonth[i] = mi2;
  }

  for (let i = 0; i < 8760; i++) {
    const mi     = hourMonth[i];
    const month  = mi + 1;
    const hour   = i % 24;
    const fkwh   = acHourlyFixed[i];
    const tkwh   = acHourlyTracker[i];
    const season = tou.getSeasonal(month);
    const rates  = tou.seasonalRates[season];
    const period = tou.schedule(month, hour);
    const rate   = rates[period] ?? rates.offpeak ?? rates.peak;

    mFixed[mi]      += fkwh;
    mTracker[mi]    += tkwh;
    mFixedVal[mi]   += fkwh * rate;
    mTrackerVal[mi] += tkwh * rate;
  }

  const monthly = MONTHS.map((name, mi) => {
    fixedKwh    += mFixed[mi];
    trackerKwh  += mTracker[mi];
    fixedValue  += mFixedVal[mi];
    trackerValue+= mTrackerVal[mi];
    return {
      month:        name,
      fixedKwh:     Math.round(mFixed[mi]),
      trackerKwh:   Math.round(mTracker[mi]),
      fixedValue:   Math.round(mFixedVal[mi]),
      trackerValue: Math.round(mTrackerVal[mi]),
    };
  });

  const kwhGain    = (trackerKwh / fixedKwh - 1) * 100;
  const valGain    = (trackerValue / fixedValue - 1) * 100;
  const touPremium = valGain - kwhGain;

  return {
    fixedKwh:         Math.round(fixedKwh),
    trackerKwh:       Math.round(trackerKwh),
    fixedValue:       Math.round(fixedValue),
    trackerValue:     Math.round(trackerValue),
    kwhGain:          kwhGain.toFixed(1),
    valGain:          valGain.toFixed(1),
    touPremium:       touPremium.toFixed(1),
    fixedEffRate:     (fixedValue / fixedKwh).toFixed(3),
    trackerEffRate:   (trackerValue / trackerKwh).toFixed(3),
    extraAnnualValue: Math.round(trackerValue - fixedValue),
    monthly,
  };
}

// Build average hourly profile for a given month from actual 8760 hourly data
function buildHourlyProfile(acHourlyFixed, acHourlyTracker, utility, month) {
  const tou   = TOU_RATES[utility];
  const mi    = month - 1;
  const start = MONTH_START_HOUR[mi];
  const days  = MONTH_DAYS[mi];

  const fAvg = new Array(24).fill(0);
  const tAvg = new Array(24).fill(0);
  for (let d = 0; d < days; d++) {
    for (let h = 0; h < 24; h++) {
      fAvg[h] += acHourlyFixed[start + d * 24 + h];
      tAvg[h] += acHourlyTracker[start + d * 24 + h];
    }
  }

  return Array.from({length:24}, (_, h) => {
    const period = tou.schedule(month, h);
    return {
      hour:    `${h}:00`,
      fixed:   parseFloat((fAvg[h] / days).toFixed(2)),
      tracker: parseFloat((tAvg[h] / days).toFixed(2)),
      isPeak:  period === "peak",
      isSOP:   period === "superoffpeak",
    };
  });
}

// ─── SOLAR ELEVATION ANGLES (degrees) per lat-bin / month / hour ──────────────
// Four representative latitudes covering CA carport sites
// Source: ASHRAE solar geometry, mid-month declination, local standard time
const SOLAR_ELEVATION_BY_LAT = {
  32: {"1":[-78.2,-72.2,-60.9,-48.5,-35.9,-23.3,-11.1,0.6,11.5,21.3,29.2,34.5,36.4,34.5,29.2,21.3,11.5,0.6,-11.1,-23.3,-35.9,-48.5,-60.9,-72.2],"2":[-70.3,-66.0,-56.2,-44.5,-32.1,-19.5,-7.0,5.2,16.8,27.3,36.1,42.1,44.3,42.1,36.1,27.3,16.8,5.2,-7.0,-19.5,-32.1,-44.5,-56.2,-66.0],"3":[-59.7,-56.6,-48.7,-38.1,-26.3,-13.9,-1.3,11.2,23.4,34.9,44.9,52.1,54.9,52.1,44.9,34.9,23.4,11.2,-1.3,-13.9,-26.3,-38.1,-48.7,-56.6],"4":[-47.9,-45.5,-39.1,-29.9,-19.1,-7.3,5.1,17.7,30.2,42.5,53.8,62.9,66.7,62.9,53.8,42.5,30.2,17.7,5.1,-7.3,-19.1,-29.9,-39.1,-45.5],"5":[-38.5,-36.5,-31.1,-22.9,-13.0,-1.8,10.0,22.3,34.9,47.5,59.8,70.7,76.1,70.7,59.8,47.5,34.9,22.3,10.0,-1.8,-13.0,-22.9,-31.1,-36.5],"6":[-34.2,-32.4,-27.3,-19.6,-10.1,0.7,12.2,24.3,36.8,49.4,61.9,73.7,80.4,73.7,61.9,49.4,36.8,24.3,12.2,0.7,-10.1,-19.6,-27.3,-32.4],"7":[-36.1,-34.2,-29.0,-21.1,-11.4,-0.5,11.3,23.5,36.0,48.6,61.0,72.4,78.5,72.4,61.0,48.6,36.0,23.5,11.3,-0.5,-11.4,-21.1,-29.0,-34.2],"8":[-43.8,-41.7,-35.7,-26.9,-16.5,-4.9,7.2,19.7,32.3,44.8,56.6,66.4,70.8,66.4,56.6,44.8,32.3,19.7,7.2,-4.9,-16.5,-26.9,-35.7,-41.7],"9":[-55.1,-52.3,-45.0,-35.0,-23.5,-11.3,1.2,13.8,26.2,38.0,48.5,56.4,59.5,56.4,48.5,38.0,26.2,13.8,1.2,-11.3,-23.5,-35.0,-45.0,-52.3],"10":[-66.9,-63.1,-54.0,-42.6,-30.3,-17.7,-5.2,7.2,19.0,29.8,38.9,45.3,47.7,45.3,38.9,29.8,19.0,7.2,-5.2,-17.7,-30.3,-42.6,-54.0,-63.1],"11":[-76.2,-70.7,-59.8,-47.6,-35.0,-22.4,-10.1,1.8,12.9,22.8,31.0,36.4,38.4,36.4,31.0,22.8,12.9,1.8,-10.1,-22.4,-35.0,-47.6,-59.8,-70.7],"12":[-80.3,-73.6,-61.9,-49.4,-36.8,-24.3,-12.2,-0.6,10.1,19.6,27.3,32.4,34.3,32.4,27.3,19.6,10.1,-0.6,-12.2,-24.3,-36.8,-49.4,-61.9,-73.6]},
  34: {"1":[-76.9,-71.4,-60.5,-48.4,-35.9,-23.6,-11.5,0.0,10.8,20.4,28.1,33.3,35.1,33.3,28.1,20.4,10.8,0.0,-11.5,-23.6,-35.9,-48.4,-60.5,-71.4],"2":[-69.0,-64.9,-55.6,-44.2,-32.0,-19.5,-7.2,4.8,16.2,26.5,35.1,40.9,43.0,40.9,35.1,26.5,16.2,4.8,-7.2,-19.5,-32.0,-44.2,-55.6,-64.9],"3":[-58.4,-55.5,-47.8,-37.5,-26.0,-13.8,-1.4,11.0,23.0,34.2,43.9,50.9,53.6,50.9,43.9,34.2,23.0,11.0,-1.4,-13.8,-26.0,-37.5,-47.8,-55.5],"4":[-46.6,-44.3,-38.1,-29.1,-18.5,-6.9,5.2,17.6,30.0,42.1,53.1,61.8,65.4,61.8,53.1,42.1,30.0,17.6,5.2,-6.9,-18.5,-29.1,-38.1,-44.3],"5":[-37.2,-35.3,-30.0,-22.0,-12.3,-1.3,10.4,22.5,34.9,47.3,59.3,69.8,74.8,69.8,59.3,47.3,34.9,22.5,10.4,-1.3,-12.3,-22.0,-30.0,-35.3],"6":[-32.9,-31.2,-26.2,-18.7,-9.3,1.3,12.7,24.6,36.9,49.3,61.6,72.9,79.1,72.9,61.6,49.3,36.9,24.6,12.7,1.3,-9.3,-18.7,-26.2,-31.2],"7":[-34.8,-33.0,-27.9,-20.2,-10.6,0.1,11.7,23.7,36.1,48.5,60.6,71.6,77.2,71.6,60.6,48.5,36.1,23.7,11.7,0.1,-10.6,-20.2,-27.9,-33.0],"8":[-42.5,-40.4,-34.6,-26.1,-15.8,-4.5,7.5,19.8,32.2,44.4,55.9,65.4,69.5,65.4,55.9,44.4,32.2,19.8,7.5,-4.5,-15.8,-26.1,-34.6,-40.4],"9":[-53.8,-51.1,-44.1,-34.3,-23.1,-11.1,1.2,13.7,25.8,37.4,47.7,55.3,58.2,55.3,47.7,37.4,25.8,13.7,1.2,-11.1,-23.1,-34.3,-44.1,-51.1],"10":[-65.6,-62.0,-53.2,-42.2,-30.1,-17.7,-5.4,6.8,18.4,29.0,37.9,44.1,46.4,44.1,37.9,29.0,18.4,6.8,-5.4,-17.7,-30.1,-42.2,-53.2,-62.0],"11":[-74.9,-69.9,-59.4,-47.4,-35.0,-22.6,-10.4,1.2,12.2,21.9,29.9,35.2,37.1,35.2,29.9,21.9,12.2,1.2,-10.4,-22.6,-35.0,-47.4,-59.4,-69.9],"12":[-79.0,-72.9,-61.6,-49.3,-36.9,-24.6,-12.6,-1.2,9.4,18.7,26.2,31.2,33.0,31.2,26.2,18.7,9.4,-1.2,-12.6,-24.6,-36.9,-49.3,-61.6,-72.9]},
  37: {"1":[-74.2,-69.5,-59.5,-48.0,-36.0,-24.0,-12.3,-1.1,9.3,18.4,25.8,30.7,32.4,30.7,25.8,18.4,9.3,-1.1,-12.3,-24.0,-36.0,-48.0,-59.5,-69.5],"2":[-66.3,-62.7,-54.2,-43.4,-31.6,-19.6,-7.7,3.9,14.9,24.7,32.9,38.4,40.3,38.4,32.9,24.7,14.9,3.9,-7.7,-19.6,-31.6,-43.4,-54.2,-62.7],"3":[-55.7,-53.0,-46.0,-36.3,-25.2,-13.4,-1.4,10.5,22.0,32.8,42.0,48.5,50.9,48.5,42.0,32.8,22.0,10.5,-1.4,-13.4,-25.2,-36.3,-46.0,-53.0],"4":[-43.9,-41.8,-36.0,-27.5,-17.3,-6.1,5.6,17.6,29.6,41.1,51.5,59.5,62.7,59.5,51.5,41.1,29.6,17.6,5.6,-6.1,-17.3,-27.5,-36.0,-41.8],"5":[-34.5,-32.7,-27.7,-20.1,-10.8,-0.2,11.1,22.9,34.9,46.8,58.2,67.8,72.1,67.8,58.2,46.8,34.9,22.9,11.1,-0.2,-10.8,-20.1,-27.7,-32.7],"6":[-30.2,-28.6,-23.9,-16.7,-7.7,2.5,13.6,25.2,37.1,49.1,60.8,71.2,76.4,71.2,60.8,49.1,37.1,25.2,13.6,2.5,-7.7,-16.7,-23.9,-28.6],"7":[-32.1,-30.4,-25.6,-18.2,-9.1,1.3,12.5,24.2,36.1,48.1,59.7,69.7,74.5,69.7,59.7,48.1,36.1,24.2,12.5,1.3,-9.1,-18.2,-25.6,-30.4],"8":[-39.8,-37.9,-32.4,-24.4,-14.5,-3.6,8.0,19.9,31.9,43.7,54.5,63.2,66.8,63.2,54.5,43.7,31.9,19.9,8.0,-3.6,-14.5,-24.4,-32.4,-37.9],"9":[-51.1,-48.7,-42.1,-32.9,-22.2,-10.6,1.3,13.3,25.1,36.1,45.8,52.8,55.5,52.8,45.8,36.1,25.1,13.3,1.3,-10.6,-22.2,-32.9,-42.1,-48.7],"10":[-62.9,-59.7,-51.7,-41.2,-29.7,-17.7,-5.7,6.0,17.2,27.3,35.8,41.6,43.7,41.6,35.8,27.3,17.2,6.0,-5.7,-17.7,-29.7,-41.2,-51.7,-59.7],"11":[-72.2,-67.9,-58.3,-46.9,-35.0,-23.0,-11.2,0.1,10.7,20.0,27.6,32.6,34.4,32.6,27.6,20.0,10.7,0.1,-11.2,-23.0,-35.0,-46.9,-58.3,-67.9],"12":[-76.3,-71.2,-60.8,-49.1,-37.1,-25.1,-13.5,-2.5,7.8,16.7,23.9,28.6,30.3,28.6,23.9,16.7,7.8,-2.5,-13.5,-25.1,-37.1,-49.1,-60.8,-71.2]},
  39: {"1":[-72.3,-68.1,-58.8,-47.6,-36.0,-24.3,-12.9,-1.9,8.2,17.1,24.2,28.8,30.5,28.8,24.2,17.1,8.2,-1.9,-12.9,-24.3,-36.0,-47.6,-58.8,-68.1],"2":[-64.4,-61.1,-53.1,-42.7,-31.4,-19.7,-8.0,3.3,13.9,23.5,31.3,36.6,38.4,36.6,31.3,23.5,13.9,3.3,-8.0,-19.7,-31.4,-42.7,-53.1,-61.1],"3":[-53.8,-51.3,-44.6,-35.3,-24.6,-13.2,-1.5,10.1,21.4,31.7,40.5,46.7,49.0,46.7,40.5,31.7,21.4,10.1,-1.5,-13.2,-24.6,-35.3,-44.6,-51.3],"4":[-42.0,-40.0,-34.4,-26.3,-16.5,-5.6,5.9,17.6,29.2,40.3,50.3,57.9,60.8,57.9,50.3,40.3,29.2,17.6,5.9,-5.6,-16.5,-26.3,-34.4,-40.0],"5":[-32.6,-30.9,-26.1,-18.8,-9.7,0.5,11.6,23.1,34.8,46.4,57.3,66.3,70.2,66.3,57.3,46.4,34.8,23.1,11.6,0.5,-9.7,-18.8,-26.1,-30.9],"6":[-28.3,-26.7,-22.2,-15.3,-6.6,3.4,14.2,25.5,37.2,48.9,60.1,69.9,74.5,69.9,60.1,48.9,37.2,25.5,14.2,3.4,-6.6,-15.3,-22.2,-26.7],"7":[-30.2,-28.6,-23.9,-16.8,-8.0,2.1,13.0,24.5,36.1,47.8,58.9,68.3,72.6,68.3,58.9,47.8,36.1,24.5,13.0,2.1,-8.0,-16.8,-23.9,-28.6],"8":[-37.9,-36.1,-30.9,-23.1,-13.6,-3.0,8.3,20.0,31.7,43.0,53.5,61.6,64.9,61.6,53.5,43.0,31.7,20.0,8.3,-3.0,-13.6,-23.1,-30.9,-36.1],"9":[-49.2,-46.9,-40.7,-31.9,-21.5,-10.3,1.4,13.1,24.5,35.2,44.5,51.1,53.6,51.1,44.5,35.2,24.5,13.1,1.4,-10.3,-21.5,-31.9,-40.7,-46.9],"10":[-61.0,-58.0,-50.5,-40.5,-29.3,-17.7,-6.0,5.5,16.3,26.2,34.3,39.8,41.8,39.8,34.3,26.2,16.3,5.5,-6.0,-17.7,-29.3,-40.5,-50.5,-58.0],"11":[-70.3,-66.4,-57.4,-46.5,-34.9,-23.2,-11.7,-0.6,9.6,18.7,26.0,30.8,32.5,30.8,26.0,18.7,9.6,-0.6,-11.7,-23.2,-34.9,-46.5,-57.4,-66.4],"12":[-74.4,-69.9,-60.1,-48.8,-37.1,-25.5,-14.1,-3.3,6.6,15.3,22.2,26.8,28.4,26.8,22.2,15.3,6.6,-3.3,-14.1,-25.5,-37.1,-48.8,-60.1,-69.9]},
};

function getElevTable(lat) {
  const bins = [32, 34, 37, 39];
  const closest = bins.reduce((a, b) => Math.abs(b - lat) < Math.abs(a - lat) ? b : a);
  return SOLAR_ELEVATION_BY_LAT[closest];
}

// Apply minimum elevation constraint to a full 8760-hour tracker array.
// When the sun is above the horizon but below minElev, the tracker holds at minElev.
// Panel points above the sun — AOI = (minElev − solarElev).
// Output = true_tracking_output × cos(AOI) — always ≤ true tracking.
function applyElevLimitToHourly(trackerHourly, lat, minElev) {
  if (minElev <= 0) return trackerHourly;
  const elevTable = getElevTable(lat);
  const MS = [0,744,1416,2160,2880,3624,4344,5088,5832,6552,7296,8016];
  const hourToMonth = new Array(8760);
  for (let mi = 0; mi < 12; mi++) {
    const end = mi < 11 ? MS[mi+1] : 8760;
    for (let i = MS[mi]; i < end; i++) hourToMonth[i] = mi + 1;
  }
  const result = new Array(8760);
  for (let i = 0; i < 8760; i++) {
    const month    = hourToMonth[i];
    const hour     = i % 24;
    const solarElev = elevTable[String(month)][hour];
    const tkwh     = trackerHourly[i];
    if (solarElev > 0 && solarElev < minElev) {
      const aoi = (minElev - solarElev) * Math.PI / 180;
      result[i] = tkwh * Math.cos(aoi);
    } else {
      result[i] = tkwh;
    }
  }
  return result;
}

// ─── CSV EXPORT ───────────────────────────────────────────────────────────────
// Produces TWO separate CSV files matching PVWatts v8 download format:
//   one for the tracker array, one for the fixed carport array.
// All input parameters are recorded in the metadata header.
// IMPORTANT: all header strings must be plain ASCII — no degree signs,
// box-drawing characters, or em-dashes. Excel opens CSV as Latin-1 by default
// and will mangle any non-ASCII characters.

function buildCommonMeta({ addressInput, geocodedLat, geocodedLon, units,
                            utility, tilt, azimuth, dateStr }) {
  const tou = TOU_RATES[utility];
  return [
    ["# MOD-09 tracker_analyzer -- Hourly AC Output Export"],
    ["# Tool version",        "v" + VERSION],
    ["# Generated",           dateStr],
    ["# --- Site ---"],
    ["# Address input",       addressInput],
    ["# Geocoded lat",        geocodedLat.toFixed(6) + " deg N"],
    ["# Geocoded lon",        Math.abs(geocodedLon).toFixed(6) + " deg W"],
    ["# --- Common parameters ---"],
    ["# System DC capacity",  units + " kW"],
    ["# Rate schedule",       utility],
    ["# Rate label",          tou.label],
    ["# Rates verified",      tou.ratesVerified],
    ["# System losses",       LOSSES + "%"],
    ["# Module type",         "1 (Premium)"],
    ["# Carport tilt",        tilt + " deg"],
    ["# Carport azimuth",     azimuth + " deg (180=south)"],
  ];
}

// PVWatts v8 format: Month,Day,Hour,AC System Output (W)
// Hour is 1-based in the PVWatts download format
function buildPVWattsRows(acHourly) {
  const rows = [["Month", "Day", "Hour", "AC System Output (W)"]];
  let dayOfYear = 0;
  for (let mi = 0; mi < 12; mi++) {
    const month = mi + 1;
    const days  = MONTH_DAYS[mi];
    for (let d = 0; d < days; d++) {
      for (let h = 0; h < 24; h++) {
        const idx = MONTH_START_HOUR[mi] + d * 24 + h;
        rows.push([month, d + 1, h + 1, ((acHourly[idx] || 0) * 1000).toFixed(1)]);
      }
    }
  }
  return rows;
}

function buildTrackerCSV({ addressInput, geocodedLat, geocodedLon, units,
                            utility, trackerDcAc, trackerBifacial, minElev,
                            carportDcAc, carportBifacial, tilt, azimuth,
                            hourlyTracker }) {
  const dateStr    = new Date().toISOString().slice(0, 10);
  const trackerLim = applyElevLimitToHourly(hourlyTracker, geocodedLat, minElev);
  const commonMeta = buildCommonMeta({ addressInput, geocodedLat, geocodedLon,
                                       units, utility, tilt, azimuth, dateStr });
  const trackerMeta = [
    ["# --- Tracker (Dual-Axis) ---"],
    ["# Array type",             "4 (dual-axis)"],
    ["# DC:AC ratio",            trackerDcAc],
    ["# Bifacial gain",          trackerBifacial + "%"],
    ["# Min elevation limit",    minElev + " deg (" + (minElev === 0 ? "unlimited" : "constrained") + ")"],
    ["# --- Also computed with ---"],
    ["# Carport DC:AC ratio",    carportDcAc],
    ["# Carport bifacial gain",  carportBifacial + "%"],
    ["# --- Notes ---"],
    ["# Production source",      "NREL PVWatts v8 API -- NSRDB PSM V3 TMY"],
    ["# Dollar value",           "NOT included -- use MOD-05 bill_modeler"],
    ["# Demand charges",         "NOT included -- use MOD-05 bill_modeler"],
    ["#"],
  ];
  const dataRows = buildPVWattsRows(trackerLim);
  return [...commonMeta, ...trackerMeta, ...dataRows].map(r => r.join(",")).join("\n");
}

function buildFixedCSV({ addressInput, geocodedLat, geocodedLon, units,
                          utility, trackerDcAc, trackerBifacial, minElev,
                          carportDcAc, carportBifacial, tilt, azimuth,
                          hourlyFixed }) {
  const dateStr    = new Date().toISOString().slice(0, 10);
  const commonMeta = buildCommonMeta({ addressInput, geocodedLat, geocodedLon,
                                       units, utility, tilt, azimuth, dateStr });
  const fixedMeta = [
    ["# --- Carport (Fixed Array) ---"],
    ["# Array type",             "0 (fixed open rack)"],
    ["# Tilt",                   tilt + " deg"],
    ["# Azimuth",                azimuth + " deg (180=south)"],
    ["# DC:AC ratio",            carportDcAc],
    ["# Bifacial gain",          carportBifacial + "%"],
    ["# --- Also computed with ---"],
    ["# Tracker DC:AC ratio",    trackerDcAc],
    ["# Tracker bifacial gain",  trackerBifacial + "%"],
    ["# Tracker min elevation",  minElev + " deg (" + (minElev === 0 ? "unlimited" : "constrained") + ")"],
    ["# --- Notes ---"],
    ["# Production source",      "NREL PVWatts v8 API -- NSRDB PSM V3 TMY"],
    ["# Dollar value",           "NOT included -- use MOD-05 bill_modeler"],
    ["# Demand charges",         "NOT included -- use MOD-05 bill_modeler"],
    ["#"],
  ];
  const dataRows = buildPVWattsRows(hourlyFixed);
  return [...commonMeta, ...fixedMeta, ...dataRows].map(r => r.join(",")).join("\n");
}


// ─── COMBINED HOURLY CSV ──────────────────────────────────────────────────────
// Single file with both arrays side-by-side + TOU period label and rate.
// 8,760 data rows; simpler format than the PVWatts-style exports.
function buildCombinedHourlyCSV({ addressInput, geocodedLat, geocodedLon,
                                   units, utility, tilt, azimuth, minElev,
                                   trackerDcAc, trackerBifacial,
                                   carportDcAc, carportBifacial,
                                   hourlyFixed, hourlyTracker }) {
  const tou      = TOU_RATES[utility];
  const dateStr  = new Date().toISOString().slice(0, 10);
  const trackerLim = applyElevLimitToHourly(hourlyTracker, geocodedLat, minElev);
  const header = [
    '# MOD-09 tracker_analyzer -- Combined Hourly Output',
    '# Tool version,' + 'v' + VERSION,
    '# Generated,' + dateStr,
    '# Address,' + addressInput,
    '# Geocoded lat (deg N),' + geocodedLat.toFixed(6),
    '# Geocoded lon (deg W),' + Math.abs(geocodedLon).toFixed(6),
    '# System DC capacity (kW),' + units,
    '# Rate schedule,' + utility,
    '# Carport tilt (deg),' + tilt,
    '# Carport azimuth (deg),' + azimuth,
    '# Tracker min elevation (deg),' + minElev,
    '# Tracker DC:AC,' + trackerDcAc + '  Carport DC:AC,' + carportDcAc,
    '#',
    'Month,Day,Hour,Fixed_kWh,Tracker_kWh,TOU_Period,Rate_$/kWh',
  ];
  const rows = [...header];
  for (let mi = 0; mi < 12; mi++) {
    const month = mi + 1;
    const days  = MONTH_DAYS[mi];
    for (let d = 0; d < days; d++) {
      for (let h = 0; h < 24; h++) {
        const idx    = MONTH_START_HOUR[mi] + d * 24 + h;
        const season = tou.getSeasonal(month);
        const period = tou.schedule(month, h);
        const rate   = tou.seasonalRates[season][period] ?? tou.seasonalRates[season].offpeak;
        rows.push([
          month, d + 1, h + 1,
          (hourlyFixed[idx] || 0).toFixed(4),
          (trackerLim[idx]  || 0).toFixed(4),
          period,
          rate.toFixed(4),
        ].join(','));
      }
    }
  }
  return rows.join('\n');
}

function downloadCSV(csv, filename) {
  const blob = new Blob([csv], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ─── SUMMARY CSV EXPORT ───────────────────────────────────────────────────────
// Exports one flat CSV with all input parameters and the computed KPI tile values.
// Intended as a quick record of what was run and what the results were.
function buildSummaryCSV({ addressInput, geocodedLat, geocodedLon, utility, units,
                            trackerDcAc, trackerBifacial, carportDcAc, carportBifacial,
                            tilt, azimuth, minElev, results }) {
  const tou     = TOU_RATES[utility];
  const dateStr = new Date().toISOString().slice(0, 10);
  const rows = [
    ["# MOD-09 tracker_analyzer -- Summary Export"],
    ["# Tool version",                              "v" + VERSION],
    ["# Generated",                                 dateStr],
    [],
    ["--- INPUTS ---"],
    ["Address input",                               addressInput],
    ["Geocoded lat (deg N)",                        geocodedLat.toFixed(6)],
    ["Geocoded lon (deg W)",                        Math.abs(geocodedLon).toFixed(6)],
    ["Rate schedule",                               utility],
    ["Rate label",                                  tou.label],
    ["System DC capacity (kW)",                     units],
    ["Tracker DC:AC ratio",                         trackerDcAc],
    ["Tracker bifacial gain (%)",                   trackerBifacial],
    ["Carport DC:AC ratio",                         carportDcAc],
    ["Carport bifacial gain (%)",                   carportBifacial],
    ["Carport tilt (deg)",                          tilt],
    ["Carport azimuth (deg)",                       azimuth],
    ["Tracker min elevation limit (deg)",           minElev],
    [],
    ["--- OUTPUTS ---"],
    ["Tracker annual kWh",                          results.trackerKwh],
    ["Tracker annual value ($)",                    results.trackerValue],
    ["Tracker effective rate ($/kWh)",              results.trackerEffRate],
    ["Fixed carport annual kWh",                    results.fixedKwh],
    ["Fixed carport annual value ($)",              results.fixedValue],
    ["Fixed carport effective rate ($/kWh)",        results.fixedEffRate],
    ["kWh gain -- tracker vs fixed (%)",            results.kwhGain],
    ["Value gain -- tracker vs fixed (%)",          results.valGain],
    ["TOU premium (percentage points)",             results.touPremium],
    ["Extra annual value -- tracker vs fixed ($)",  results.extraAnnualValue],
  ];
  return rows.map(r =>
    r.length === 0 ? "" :
    r.map(v => {
      const s = String(v ?? "");
      return s.includes(",") || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(",")
  ).join("\n");
}

// ─── SUMMARY CSV PARSER (Restore Parameters) ─────────────────────────────────
// Reads a tracker summary CSV written by buildSummaryCSV and returns a params
// object. Only the INPUTS section key-value pairs are used.
function parseSummaryCSV(text) {
  const kv = {};
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('#') || line.startsWith('-') || line.trim() === '') continue;
    const comma = line.indexOf(',');
    if (comma < 0) continue;
    const key = line.slice(0, comma).trim();
    const val = line.slice(comma + 1).trim().replace(/^"|"$/g, '');
    kv[key] = val;
  }
  const result = {};
  if (kv['Address input'])                     result.addressInput    = kv['Address input'];
  if (kv['Rate schedule'])                     result.utility         = kv['Rate schedule'];
  if (kv['System DC capacity (kW)'])           result.units           = parseFloat(kv['System DC capacity (kW)']);
  if (kv['Tracker DC:AC ratio'])               result.trackerDcAc     = parseFloat(kv['Tracker DC:AC ratio']);
  if (kv['Tracker bifacial gain (%)'])         result.trackerBifacial = parseFloat(kv['Tracker bifacial gain (%)']);
  if (kv['Carport DC:AC ratio'])               result.carportDcAc     = parseFloat(kv['Carport DC:AC ratio']);
  if (kv['Carport bifacial gain (%)'])         result.carportBifacial = parseFloat(kv['Carport bifacial gain (%)']);
  if (kv['Carport tilt (deg)'])                result.tilt            = parseFloat(kv['Carport tilt (deg)']);
  if (kv['Carport azimuth (deg)'])             result.azimuth         = parseFloat(kv['Carport azimuth (deg)']);
  if (kv['Tracker min elevation limit (deg)']) result.minElev         = parseFloat(kv['Tracker min elevation limit (deg)']);
  return result;
}

// ─── VALIDATED INPUT COMPONENT ────────────────────────────────────────────────
function ValidatedInput({ label, value, unit, min, max, step, hint, onChange }) {
  const num = parseFloat(value);
  const outOfRange = !isNaN(num) && (num < min || num > max);

  return (
    <div>
      <div style={{fontSize:11,color:"#8b949e",marginBottom:5,textTransform:"uppercase",letterSpacing:"0.06em",fontWeight:600}}>
        {label}
      </div>
      <div style={{display:"flex",alignItems:"center",gap:6}}>
        <input
          type="number" min={min} max={max} step={step} value={value}
          onChange={e => {
            const raw = e.target.value;
            const n = parseFloat(raw);
            const valid = !isNaN(n) && n >= min && n <= max;
            onChange({ raw, num: n, valid });
          }}
          style={{
            background:"#161b22",
            border:`1px solid ${outOfRange ? "#f78166" : "#30363d"}`,
            color: outOfRange ? "#f78166" : "#e6edf3",
            padding:"7px 10px", borderRadius:6,
            fontSize:13, width:90, textAlign:"right",
            boxShadow: outOfRange ? "0 0 0 2px #f7816630" : "none",
          }}
        />
        {unit && <span style={{fontSize:11,color:"#8b949e"}}>{unit}</span>}
      </div>
      {outOfRange
        ? <div style={{fontSize:10,color:"#f78166",marginTop:3,fontWeight:600}}>Max {max}{unit} · Min {min}{unit}</div>
        : hint && <div style={{fontSize:10,color:"#9ca8b4",marginTop:3}}>{hint}</div>
      }
    </div>
  );
}

// ─── DESIGN TOKENS ────────────────────────────────────────────────────────────
const C = {
  bg:      "#0d1117",
  surface: "#161b22",
  border:  "#30363d",
  text:    "#e6edf3",
  muted:   "#8b949e",
  faint:   "#9ca8b4",
  blue:    "#58a6ff",
  green:   "#3fb950",
  purple:  "#bc8cff",
  orange:  "#f78166",
  yellow:  "#e3b341",
  teal:    "#39d353",
};

const fmt$  = (v) => "$" + v.toLocaleString();
const fmtK  = (v) => v >= 1000 ? (v/1000).toFixed(1)+"k" : String(v);

// ─── USER MANUAL DATA ─────────────────────────────────────────────────────────
const TRACKER_MANUAL = [
  {
    heading: "OVERVIEW",
    body: "The Dual-Axis Tracker Analyzer compares annual solar production between a dual-axis tracking array and a fixed-tilt carport array at the same site. It fetches 8,760-hour TMY weather data from NREL PVWatts v8, assigns each hour a TOU energy rate, and reports the total dollar value each system would earn — revealing both the kWh gain and the TOU premium from tracking.",
    body2: "Results are energy values only. Demand charges, customer charges, and NEM export credits are not modeled here — use MOD-05 (bill_modeler) for full bill analysis.",
  },
  {
    heading: "SITE ADDRESS & RATE SCHEDULE",
    bullets: [
      "Site Address — type any US address or city. The tool geocodes it via OpenStreetMap Nominatim to obtain lat/lon, then calls PVWatts v8 with those coordinates.",
      "Rate Schedule — select the customer's utility tariff. Energy rates by TOU period are shown in the Rate Schedule card below. SDG&E commercial (TOU-A, AL-TOU, AL-TOU-2), residential (TOU-DR1, DR-SES, EV-TOU-5), APU TOU-2, and approximate SCE/PG&E rates are included.",
      "System kW DC — DC nameplate capacity. Both arrays use the same DC size for an apples-to-apples comparison.",
      "Load Parameters — click the 📂 Load Parameters button to restore a previously saved Summary CSV. All numeric inputs are filled in; click Compute to re-run.",
    ],
  },
  {
    heading: "TRACKER PARAMETERS",
    bullets: [
      "Tracker DC:AC — ratio of DC nameplate to AC inverter capacity. Trackers typically use 1.0–1.1 (larger inverter captures sustained high output at midday).",
      "Tracker Bifacial Gain — additional production from the rear face of bifacial modules. 0 = monofacial. Typical: 2% dark gravel/asphalt, 3% light concrete, 5% white concrete. Mapped to PVWatts albedo internally.",
      "Min Elevation Limit — stow angle for the tracker. When the sun is below this angle, the tracker holds at that elevation instead of following. 0 = true dual-axis (unlimited). 5–15° models stow constraints from neighboring rows or structural limits. The dashed line on the hourly chart shows unlimited output for comparison.",
    ],
  },
  {
    heading: "CARPORT (FIXED ARRAY) PARAMETERS",
    bullets: [
      "Carport DC:AC — typically 1.2 (more clipping is acceptable on a fixed array).",
      "Carport Bifacial Gain — same lookup table as the tracker parameter.",
      "Carport Tilt — panel tilt angle in degrees. Wipomo default is 7°. Higher tilt improves winter production; lower tilt reduces wind loading.",
      "Carport Azimuth — panel face direction. 180° = true south. 90° = east, 270° = west.",
    ],
  },
  {
    heading: "COMPUTING RESULTS",
    body: "Click Compute ▶ (or press Enter in the address field). Two steps occur in sequence:",
    bullets: [
      "Geocoding — the address is sent to Nominatim (OpenStreetMap) to obtain lat/lon. Requires internet.",
      "PVWatts — two API calls run in parallel: one for fixed open-rack (array_type=0) and one for dual-axis tracking (array_type=4). Both use 14% system losses and Premium module type.",
    ],
    body2: "Results appear in a few seconds. The weather station card confirms which NSRDB grid cell was used.",
  },
  {
    heading: "KPI TILES",
    bullets: [
      "Tracker Annual kWh — total AC production and its annual dollar value at TOU rates.",
      "Tracker Eff. Rate — effective $/kWh earned (annual value ÷ annual kWh). Higher than the average flat rate because the tracker captures more peak-rate hours.",
      "kWh Gain vs Fixed — percentage more energy the tracker produces.",
      "Value Gain vs Fixed — percentage more dollar value the tracker earns. Usually higher than kWh gain.",
      "TOU Premium — Value Gain minus kWh Gain (percentage points). Positive means the tracker earns disproportionately more dollars per extra kWh due to capturing peak-rate hours.",
      "Extra Annual Value — additional dollar value the tracker earns over the carport per year. Divide into incremental capital cost to estimate simple payback.",
    ],
  },
  {
    heading: "EXPORTING DATA",
    bullets: [
      "Export Tracker CSV — 8,760-hour AC output in PVWatts download format.",
      "Export Fixed Carport CSV — same format for the fixed array.",
      "Export Combined Hourly CSV — one file with both arrays side by side, plus TOU period and rate for each hour. Simpler format for spreadsheet analysis.",
      "Export Summary CSV — all input parameters and KPI results. Can be reloaded with Load Parameters to restore a prior run.",
      "Export Charts PNG — saves the hourly profile and monthly value charts as a single image.",
    ],
  },
  {
    heading: "TOU PREMIUM EXPLAINED",
    body: "A dual-axis tracker earns a TOU premium because it generates extra kWh disproportionately during high-rate hours. A fixed-tilt carport is locked at its configured tilt and azimuth — regardless of orientation, its peak output occurs near solar noon, which falls entirely within the off-peak window (before 4 PM). A tracker extends production into the late afternoon, capturing the on-peak window (4–9 PM) that a fixed array almost entirely misses.",
    body2: "The TOU premium is site- and rate-specific. High-rate schedules with large peak/off-peak differentials (e.g. SDG&E AL-TOU-2) produce larger premiums than flat or low-differential rates.",
  },
  {
    heading: "DATA SOURCES",
    bullets: [
      "Solar production: NREL PVWatts v8 API using NSRDB PSM V3 TMY weather data at 4 km resolution.",
      "Geocoding: OpenStreetMap Nominatim — free, no API key required.",
      "TOU rates: SDG&E tariff PDFs (rates verified as noted per schedule). SCE and PG&E rates are approximate.",
    ],
  },
  {
    heading: "DISCLAIMER",
    body: "Production values are TMY (Typical Meteorological Year) estimates from NREL PVWatts. Actual annual production varies with weather. Dollar values reflect energy value only — demand charges, customer charges, non-bypassable charges, and NEM export credits are not modeled. SCE and PG&E rates are approximate; verify current tariffs before presenting to customers.",
  },
];

// ─── MAIN APP COMPONENT ───────────────────────────────────────────────────────
const { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
        Legend, ResponsiveContainer, ReferenceLine } = window.Recharts || {};

function App() {
  const [addressInput,         setAddressInput]         = useState("");
  const [utility,              setUtility]              = useState("SDG&E TOU-A");
  const [unitsInput,           setUnitsInput]           = useState("38.7");
  const [units,                setUnits]                = useState(38.7);
  const [chartMonth,           setChartMonth]           = useState(7);
  const [trackerDcAcInput,     setTrackerDcAcInput]     = useState("1.1");
  const [trackerDcAc,          setTrackerDcAc]          = useState(1.1);
  const [trackerBifacialInput, setTrackerBifacialInput] = useState("0");
  const [trackerBifacial,      setTrackerBifacial]      = useState(0);
  const [carportDcAcInput,     setCarportDcAcInput]     = useState("1.2");
  const [carportDcAc,          setCarportDcAc]          = useState(1.2);
  const [carportBifacialInput, setCarportBifacialInput] = useState("0");
  const [carportBifacial,      setCarportBifacial]      = useState(0);
  const [tiltInput,            setTiltInput]            = useState("7");
  const [tilt,                 setTilt]                 = useState(7);
  const [azimuthInput,         setAzimuthInput]         = useState("180");
  const [azimuth,              setAzimuth]              = useState(180);
  const [minElev,              setMinElev]              = useState(0);
  const [minElevInput,         setMinElevInput]         = useState("0");

  // Ref for PNG export — wraps both chart cards
  const chartsRef = useRef(null);
  const restoreInputRef = useRef(null);

  const [showManual,  setShowManual]  = useState(false);
  const [restoreMsg,  setRestoreMsg]  = useState(null);   // {text, ok}

  // API state
  const [loading,        setLoading]        = useState(false);
  const [error,          setError]          = useState(null);
  const [stationInfo,    setStationInfo]    = useState(null);
  const [hourlyFixed,    setHourlyFixed]    = useState(null);
  const [hourlyTracker,  setHourlyTracker]  = useState(null);
  const [queriedAddress, setQueriedAddress] = useState("");
  const [geocodedLat,    setGeocodedLat]    = useState(33);
  const [geocodedLon,    setGeocodedLon]    = useState(-117);   // bug fix: was missing in v6.14

  const hasErrors = (() => {
    const checks = [
      { v: parseFloat(unitsInput),           min: 1,   max: 500  },
      { v: parseFloat(trackerDcAcInput),     min: 0.8, max: 1.5  },
      { v: parseFloat(trackerBifacialInput), min: 0,   max: 30   },
      { v: parseFloat(carportDcAcInput),     min: 0.8, max: 1.5  },
      { v: parseFloat(carportBifacialInput), min: 0,   max: 30   },
      { v: parseFloat(tiltInput),            min: 0,   max: 60   },
      { v: parseFloat(azimuthInput),         min: 0,   max: 360  },
    ];
    return checks.some(({ v, min, max }) => isNaN(v) || v < min || v > max);
  })();

  const handleCompute = useCallback(async () => {
    const addr = addressInput.trim();
    if (!addr) { setError("Enter an address before computing."); return; }
    setLoading(true);
    setError(null);
    setStationInfo(null);
    setHourlyFixed(null);
    setHourlyTracker(null);
    try {
      const geo = await geocodeAddress(addr);
      const [fixedResult, trackerResult] = await Promise.all([
        fetchPVWatts({ lat: geo.lat, lon: geo.lon, systemCapacity: units,
                       arrayType: 0, tilt, azimuth, dcAcRatio: carportDcAc, bifacial: carportBifacial }),
        fetchPVWatts({ lat: geo.lat, lon: geo.lon, systemCapacity: units,
                       arrayType: 4, tilt, azimuth, dcAcRatio: trackerDcAc, bifacial: trackerBifacial }),
      ]);
      setHourlyFixed(fixedResult.ac_hourly);
      setHourlyTracker(trackerResult.ac_hourly);
      setStationInfo(fixedResult.station_info);
      setQueriedAddress(geo.display);
      setGeocodedLat(geo.lat);
      setGeocodedLon(geo.lon);                                   // bug fix: now stored
    } catch (e) {
      setError(e.message || "API error. Check address or try again.");
    } finally {
      setLoading(false);
    }
  }, [addressInput, units, trackerDcAc, trackerBifacial, carportDcAc, carportBifacial, tilt, azimuth]);

  // Export both chart cards as a single PNG using html2canvas (loaded in wrapper)
  const handleExportPNG = useCallback(async () => {
    if (!chartsRef.current) return;
    if (typeof html2canvas === "undefined") {
      alert("PNG export unavailable — html2canvas library not loaded in the HTML wrapper.");
      return;
    }
    const safeName = addressInput.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 35);
    const dateStr  = new Date().toISOString().slice(0, 10);
    const canvas   = await html2canvas(chartsRef.current, {
      backgroundColor: "#0d1117",
      scale: 2,
      useCORS: true,
      logging: false,
    });
    canvas.toBlob(blob => {
      const url = URL.createObjectURL(blob);
      const a   = document.createElement("a");
      a.href = url; a.download = `charts_${safeName}_${dateStr}.png`; a.click();
      URL.revokeObjectURL(url);
    }, "image/png");
  }, [addressInput]);

  // Export inputs + KPI tile outputs as a single flat CSV
  const handleExportSummaryCSV = useCallback(() => {
    if (!results) return;
    const safeName = addressInput.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 35);
    const dateStr  = new Date().toISOString().slice(0, 10);
    downloadCSV(
      buildSummaryCSV({ addressInput, geocodedLat, geocodedLon, utility, units,
                        trackerDcAc, trackerBifacial, carportDcAc, carportBifacial,
                        tilt, azimuth, minElev, results }),
      `summary_${safeName}_${dateStr}.csv`
    );
  }, [addressInput, geocodedLat, geocodedLon, utility, units,
      trackerDcAc, trackerBifacial, carportDcAc, carportBifacial, tilt, azimuth, minElev, results]);


  const handleRestoreFile = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    e.target.value = '';
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const p = parseSummaryCSV(ev.target.result);
        if (p.addressInput    !== undefined) setAddressInput(p.addressInput);
        if (p.utility         !== undefined && TOU_RATES[p.utility]) setUtility(p.utility);
        if (p.units           !== undefined && !isNaN(p.units))   { setUnitsInput(String(p.units));           setUnits(p.units); }
        if (p.trackerDcAc     !== undefined && !isNaN(p.trackerDcAc))   { setTrackerDcAcInput(String(p.trackerDcAc));   setTrackerDcAc(p.trackerDcAc); }
        if (p.trackerBifacial !== undefined && !isNaN(p.trackerBifacial)) { setTrackerBifacialInput(String(p.trackerBifacial)); setTrackerBifacial(p.trackerBifacial); }
        if (p.carportDcAc     !== undefined && !isNaN(p.carportDcAc))   { setCarportDcAcInput(String(p.carportDcAc));   setCarportDcAc(p.carportDcAc); }
        if (p.carportBifacial !== undefined && !isNaN(p.carportBifacial)) { setCarportBifacialInput(String(p.carportBifacial)); setCarportBifacial(p.carportBifacial); }
        if (p.tilt            !== undefined && !isNaN(p.tilt))    { setTiltInput(String(p.tilt));       setTilt(p.tilt); }
        if (p.azimuth         !== undefined && !isNaN(p.azimuth)) { setAzimuthInput(String(p.azimuth)); setAzimuth(p.azimuth); }
        if (p.minElev         !== undefined && !isNaN(p.minElev)) { setMinElev(p.minElev); setMinElevInput(String(p.minElev)); }
        setRestoreMsg({ ok: true, text: 'Restored from: ' + file.name });
      } catch(err) {
        setRestoreMsg({ ok: false, text: 'Restore failed: ' + err.message });
      }
    };
    reader.readAsText(file);
  };

  const handleExportCombinedHourly = useCallback(() => {
    if (!hourlyFixed || !hourlyTracker) return;
    const safeName = addressInput.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 35);
    const dateStr  = new Date().toISOString().slice(0, 10);
    downloadCSV(
      buildCombinedHourlyCSV({ addressInput, geocodedLat, geocodedLon, units, utility,
                                tilt, azimuth, minElev, trackerDcAc, trackerBifacial,
                                carportDcAc, carportBifacial, hourlyFixed, hourlyTracker }),
      'combined_hourly_' + safeName + '_' + dateStr + '.csv'
    );
  }, [addressInput, geocodedLat, geocodedLon, units, utility, tilt, azimuth, minElev,
      trackerDcAc, trackerBifacial, carportDcAc, carportBifacial, hourlyFixed, hourlyTracker]);

  const handleDownloadManual = () => {
    const lines = [
      'DUAL-AXIS TRACKER ANALYZER — USER MANUAL',
      'Version ' + VERSION + ' | Center for Community Energy / Makello',
      'Generated: ' + new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
      '',
    ];
    TRACKER_MANUAL.forEach(sec => {
      lines.push('');
      lines.push('── ' + sec.heading + ' ──');
      lines.push('');
      if (sec.body)    lines.push(sec.body);
      if (sec.bullets) sec.bullets.forEach(b => lines.push('  • ' + b));
      if (sec.body2)   { lines.push(''); lines.push(sec.body2); }
    });
    lines.push('');
    lines.push('─────────────────────────────────────────────────────────────');
    lines.push('Center for Community Energy · tools.cc-energy.org');
    downloadCSV(lines.join('\n'), 'tracker_analyzer_manual_v' + VERSION + '.txt');
  };

  const results = useMemo(() => {
    if (!hourlyFixed || !hourlyTracker) return null;
    const trackerLimited = applyElevLimitToHourly(hourlyTracker, geocodedLat, minElev);
    return computeFromHourly(hourlyFixed, trackerLimited, utility);
  }, [hourlyFixed, hourlyTracker, utility, minElev, geocodedLat]);

  const hourly = useMemo(() => {
    if (!hourlyFixed || !hourlyTracker) return null;
    const trackerLimited = applyElevLimitToHourly(hourlyTracker, geocodedLat, minElev);
    const profile = buildHourlyProfile(hourlyFixed, trackerLimited, utility, chartMonth);
    if (minElev > 0) {
      const unlimited = buildHourlyProfile(hourlyFixed, hourlyTracker, utility, chartMonth);
      return profile.map((d, i) => ({ ...d, trackerUnlimited: unlimited[i].tracker }));
    }
    return profile;
  }, [hourlyFixed, hourlyTracker, utility, chartMonth, minElev, geocodedLat]);

  const tou = TOU_RATES[utility];
  const periodColor = { peak: C.orange, offpeak: C.green, superoffpeak: C.muted };
  const periodBg    = { peak: "#f7816620", offpeak: "#3fb95018", superoffpeak: "#6e768118" };

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    return (
      <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:6,padding:"8px 12px",fontSize:12}}>
        <p style={{color:C.muted,margin:"0 0 4px"}}>{label}</p>
        {payload.map(p => (
          <p key={p.name} style={{color:p.color,margin:"2px 0"}}>
            {p.name}: {p.value?.toFixed ? p.value.toFixed(2) : p.value} kW
          </p>
        ))}
      </div>
    );
  };

  return (
    <div style={{background:C.bg,minHeight:"100vh",color:C.text,fontFamily:"'Inter',system-ui,sans-serif",padding:"20px"}}>
      <div style={{maxWidth:920,margin:"0 auto"}}>

        {/* Header */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:22}}>
          <div>
            <div style={{display:"flex",alignItems:"baseline",gap:10,marginBottom:6}}>
              <span style={{fontSize:11,fontFamily:"'Inter',monospace",color:C.blue,letterSpacing:"0.12em",fontWeight:600}}>CCE / MAKELLO</span>
              <span style={{width:1,height:11,background:C.border,display:"inline-block"}}/>
              <span style={{fontSize:11,fontFamily:"'Inter',monospace",color:C.muted,letterSpacing:"0.10em"}}>DUAL-AXIS TRACKER ANALYZER</span>
              <span style={{width:1,height:11,background:C.border,display:"inline-block"}}/>
              <span style={{fontSize:11,fontFamily:"'Inter',monospace",color:C.faint,letterSpacing:"0.08em"}}>v{VERSION}</span>
              <span style={{width:1,height:11,background:C.border,display:"inline-block"}}/>
              <span style={{fontSize:11,fontFamily:"'Inter',monospace",color:C.faint,letterSpacing:"0.08em"}}>MOD-09</span>
            </div>
            <h1 style={{fontSize:20,fontWeight:700,color:C.text,margin:0}}>
              Dual-Axis Tracker Analyzer
            </h1>
            <p style={{color:C.muted,fontSize:13,marginTop:5}}>
              NREL PVWatts v8 · Carport {tilt}° tilt / {azimuth}° az · Dual-axis tracker · 14% losses
            </p>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <button
              onClick={() => setShowManual(true)}
              style={{padding:"6px 14px",borderRadius:6,fontSize:12,fontWeight:600,
                      background:"transparent",border:`1px solid ${C.border}`,
                      color:C.muted,cursor:"pointer",whiteSpace:"nowrap",
                      fontFamily:"'Inter',monospace",letterSpacing:"0.06em"}}>
              ? HELP
            </button>
            <a href="https://tools.cc-energy.org/index.html"
              style={{fontSize:12,color:C.blue,textDecoration:"none",border:`1px solid ${C.border}`,
                      borderRadius:6,padding:"6px 14px",whiteSpace:"nowrap",
                      background:C.surface}}>
              ← All Tools
            </a>
          </div>
        </div>

        {/* ── Row 1: Common to both arrays ─────────────────────────────── */}
        <div style={{fontSize:10,color:C.faint,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:6}}>Both Arrays</div>
        <div style={{display:"flex",gap:14,flexWrap:"wrap",marginBottom:12,alignItems:"flex-start"}}>
          <div style={{flex:"1 1 280px"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
              <div style={{fontSize:11,color:C.muted,textTransform:"uppercase",letterSpacing:"0.06em",fontWeight:600}}>Site Address</div>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <input type="file" accept=".csv" ref={restoreInputRef} style={{display:"none"}} onChange={handleRestoreFile} />
                <button onClick={() => restoreInputRef.current && restoreInputRef.current.click()}
                  style={{background:"transparent",border:`1px solid ${C.border}`,borderRadius:5,
                          color:C.muted,padding:"3px 10px",fontSize:10,fontWeight:600,
                          fontFamily:"'Inter',monospace",letterSpacing:"0.06em",cursor:"pointer"}}>
                  📂 Load Parameters
                </button>
                {restoreMsg && (
                  <span style={{fontSize:10,color:restoreMsg.ok ? C.green : C.orange,fontFamily:"monospace"}}>
                    {restoreMsg.text}
                  </span>
                )}
              </div>
            </div>
            <input type="text" placeholder="e.g. 2020 Camino Del Rio N, San Diego, CA"
              value={addressInput} onChange={e => setAddressInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !hasErrors && handleCompute()}
              style={{background:C.surface,border:`1px solid ${C.border}`,color:C.text,
                      padding:"7px 12px",borderRadius:6,fontSize:13,width:"100%",boxSizing:"border-box"}} />
          </div>
          <div>
            <div style={{fontSize:11,color:C.muted,marginBottom:5,textTransform:"uppercase",letterSpacing:"0.06em",fontWeight:600}}>Rate Schedule</div>
            <select value={utility} onChange={e => setUtility(e.target.value)}
              style={{background:C.surface,border:`1px solid ${C.border}`,color:C.text,
                      padding:"7px 12px",borderRadius:6,fontSize:13,cursor:"pointer"}}>
              {Object.keys(TOU_RATES).map(o => <option key={o}>{o}</option>)}
            </select>
          </div>
          <ValidatedInput label="System kW DC" value={unitsInput} unit="kW"
            min={1} max={500} step={0.1} hint="1–500 kW · same DC capacity for both arrays"
            onChange={v => { setUnitsInput(v.raw); if (v.valid) setUnits(v.num); }} />
        </div>

        <div style={{borderTop:"1px solid #3a4a5a",marginBottom:12}}/>

        {/* ── Row 2: Tracker parameters ──────────────────────────────────── */}
        <div style={{fontSize:10,color:C.faint,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:6}}>Tracker (Dual-Axis)</div>
        <div style={{display:"flex",gap:14,flexWrap:"wrap",marginBottom:12,alignItems:"flex-start"}}>
          <ValidatedInput label="Tracker DC:AC" value={trackerDcAcInput} unit=""
            min={0.8} max={1.5} step={0.05} hint="0.8–1.5 · typically 1.0–1.1"
            onChange={v => { setTrackerDcAcInput(v.raw); if (v.valid) setTrackerDcAc(v.num); }} />
          <ValidatedInput label="Tracker Bifacial Gain" value={trackerBifacialInput} unit="%"
            min={0} max={30} step={0.5} hint="0=monofacial · 2–5%=typical · up to 30%"
            onChange={v => { setTrackerBifacialInput(v.raw); if (v.valid) setTrackerBifacial(v.num); }} />
          <div>
            <div style={{fontSize:11,color:C.muted,marginBottom:5,textTransform:"uppercase",letterSpacing:"0.06em",fontWeight:600}}>
              Min Elevation Limit
              {minElev > 0 && <span style={{marginLeft:8,fontWeight:700,fontSize:12,color:C.yellow,textTransform:"none",letterSpacing:0}}>{minElev}° — constrained</span>}
            </div>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <input type="range" min={0} max={45} step={1} value={minElev}
                onChange={e => { const v=parseInt(e.target.value); setMinElev(v); setMinElevInput(String(v)); }}
                style={{width:110,accentColor:"#58a6ff"}} />
              <input type="text" inputMode="numeric" autoComplete="off" autoCorrect="off" spellCheck={false}
                value={minElevInput}
                onChange={e => {
                  const raw = e.target.value.replace(/[^0-9]/g, "");
                  setMinElevInput(raw);
                  const v = parseInt(raw, 10);
                  if (!isNaN(v) && v >= 0 && v <= 45) setMinElev(v);
                }}
                onBlur={() => {
                  const v = parseInt(minElevInput, 10);
                  if (isNaN(v) || v < 0) { setMinElev(0); setMinElevInput("0"); }
                  else if (v > 45) { setMinElev(45); setMinElevInput("45"); }
                  else { setMinElevInput(String(v)); }
                }}
                style={{background:"#161b22",border:"1px solid #30363d",color:"#e6edf3",
                        padding:"7px 8px",borderRadius:6,fontSize:13,width:52,textAlign:"right"}} />
              <span style={{fontSize:11,color:"#8b949e"}}>°</span>
            </div>
            <div style={{fontSize:10,marginTop:3,color:minElev===0?"#9ca8b4":"#e3b341"}}>
              {minElev===0 ? "0=unlimited (true dual-axis) · max 45°" : `${minElev}° limit active · early/late hours constrained`}
            </div>
          </div>
        </div>

        <div style={{borderTop:"1px solid #3a4a5a",marginBottom:12}}/>

        {/* ── Row 3: Carport parameters + Compute ────────────────────────── */}
        <div style={{fontSize:10,color:C.faint,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:6}}>Carport (Fixed Array)</div>
        <div style={{display:"flex",gap:14,flexWrap:"wrap",marginBottom:20,alignItems:"flex-start"}}>
          <ValidatedInput label="Carport DC:AC" value={carportDcAcInput} unit=""
            min={0.8} max={1.5} step={0.05} hint="0.8–1.5 · typically 1.2"
            onChange={v => { setCarportDcAcInput(v.raw); if (v.valid) setCarportDcAc(v.num); }} />
          <ValidatedInput label="Carport Bifacial Gain" value={carportBifacialInput} unit="%"
            min={0} max={30} step={0.5} hint="0=monofacial · 2–5%=typical · up to 30%"
            onChange={v => { setCarportBifacialInput(v.raw); if (v.valid) setCarportBifacial(v.num); }} />
          <ValidatedInput label="Carport Tilt" value={tiltInput} unit="°"
            min={0} max={60} step={1} hint="0°–60° · tracker tilt is self-controlled"
            onChange={v => { setTiltInput(v.raw); if (v.valid) setTilt(v.num); }} />
          <ValidatedInput label="Carport Azimuth" value={azimuthInput} unit="°"
            min={0} max={360} step={1} hint="0°–360° · 180°=south · tracker azimuth is self-controlled"
            onChange={v => { setAzimuthInput(v.raw); if (v.valid) setAzimuth(v.num === 360 ? 0 : v.num); }} />
          <div style={{marginLeft:"auto",paddingTop:22}}>
            <button onClick={handleCompute} disabled={loading || hasErrors}
              style={{padding:"9px 32px",borderRadius:6,fontSize:14,fontWeight:600,
                cursor: loading ? "wait" : hasErrors ? "not-allowed" : "pointer",
                background: loading ? "#1f6feb80" : hasErrors ? "#1f6feb40" : "#1f6feb",
                border:"1px solid #388bfd",color:"#ffffff"}}>
              {loading ? "Computing…" : hasErrors ? "Fix inputs above" : "Compute ▶"}
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div style={{background:"#f7816615",border:`1px solid ${C.orange}`,borderRadius:8,
                       padding:"12px 16px",marginBottom:16,fontSize:12,color:C.orange,
                       maxHeight:160,overflowY:"auto",wordBreak:"break-word",
                       whiteSpace:"pre-wrap",fontFamily:"monospace",lineHeight:1.6}}>
            ⚠ {error}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,
                       padding:"24px",marginBottom:16,textAlign:"center",color:C.muted,fontSize:13}}>
            Geocoding address, then fetching 8,760-hour PVWatts data (2 API calls)…
          </div>
        )}

        {/* Station info */}
        {stationInfo && !loading && (
          <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,
                       padding:"12px 18px",marginBottom:16,fontSize:12}}>
            <div style={{display:"flex",gap:24,flexWrap:"wrap",alignItems:"center"}}>
              <div><span style={{color:C.muted}}>Weather station: </span>
                   <span style={{color:C.text,fontWeight:600}}>{stationInfo.city}, {stationInfo.state}</span></div>
              <div><span style={{color:C.muted}}>Lat/Lon: </span>
                   <span style={{color:C.text}}>{stationInfo.lat?.toFixed(3)}° / {stationInfo.lon?.toFixed(3)}°</span></div>
              <div><span style={{color:C.muted}}>Elevation: </span>
                   <span style={{color:C.text}}>{stationInfo.elev} m</span></div>
              <div><span style={{color:C.muted}}>TMY source: </span>
                   <span style={{color:C.text}}>{stationInfo.weather_data_source || "NSRDB PSM V3"}</span></div>
              <div style={{marginLeft:"auto",color:C.faint,fontStyle:"italic"}}>{queriedAddress}</div>
            </div>
          </div>
        )}

        {/* Rate schedule card */}
        <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,padding:"14px 18px",marginBottom:20}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",flexWrap:"wrap",gap:6,marginBottom:10}}>
            <div style={{fontSize:12,fontWeight:600,color:C.muted,textTransform:"uppercase",letterSpacing:"0.06em"}}>
              {tou.label}
            </div>
            <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
              <div style={{fontSize:11,color:C.faint}}>{tou.rateNote}</div>
              <div style={{fontSize:11,color:C.faint}}>
                Rates verified: <span style={{color:C.muted}}>{tou.ratesVerified}</span>
                {" · "}
                <a href={tou.tariffUrl} target="_blank" rel="noopener noreferrer"
                  style={{color:C.blue,textDecoration:"none"}}>View tariff PDF ↗</a>
              </div>
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            {["summer","winter"].map(season => (
              <div key={season}>
                <div style={{fontSize:11,color:C.muted,textTransform:"uppercase",letterSpacing:"0.05em",fontWeight:600,marginBottom:6}}>
                  {season === "summer" ? "☀️ Summer (Jun–Oct)" : "❄️ Winter (Nov–May)"}
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:5}}>
                  {Object.entries(tou.seasonalRates[season]).map(([period, rate]) => (
                    <div key={period} style={{
                      background:periodBg[period], border:`1px solid ${periodColor[period]}40`,
                      borderRadius:5, padding:"6px 12px",
                      display:"flex", justifyContent:"space-between", alignItems:"center"
                    }}>
                      <div style={{display:"flex",alignItems:"center",gap:7}}>
                        <div style={{width:8,height:8,borderRadius:"50%",background:periodColor[period],flexShrink:0}} />
                        <span style={{fontSize:12,color:C.text}}>
                          {period === "peak" ? "On-Peak 4–9 PM" : period === "offpeak" ? "Off-Peak" : "Super Off-Peak"}
                        </span>
                      </div>
                      <span style={{fontSize:15,fontWeight:700,color:periodColor[period]}}>
                        ${rate.toFixed(3)}<span style={{fontSize:10,fontWeight:400,color:C.muted}}>/kWh</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Pre-compute placeholder */}
        {!results && !loading && (
          <div style={{background:C.surface,border:`1px dashed ${C.border}`,borderRadius:8,
                       padding:"40px",textAlign:"center",color:C.muted,fontSize:13}}>
            Enter a site address and click <strong style={{color:C.blue}}>Compute ▶</strong> to fetch NREL PVWatts data for this location.
          </div>
        )}

        {results && !loading && (
          <>
            {/* KPI Cards — two rows: tracker on top, fixed below, gains at end */}
            <div style={{marginBottom:16}}>
              {/* Row 1: Tracker */}
              <div style={{fontSize:10,color:C.faint,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:6}}>Tracker</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(148px,1fr))",gap:10,marginBottom:10}}>
                {[
                  { label:"Tracker Annual kWh",   val:fmtK(results.trackerKwh)+" kWh", sub:fmt$(results.trackerValue)+"/yr", color:C.green  },
                  { label:"Tracker Eff. Rate",     val:"$"+results.trackerEffRate,       sub:"$/kWh earned",                  color:C.green  },
                  { label:"kWh Gain vs Fixed",     val:"+"+results.kwhGain+"%",          sub:"production increase",           color:C.purple },
                  { label:"Value Gain vs Fixed",   val:"+"+results.valGain+"%",          sub:"dollar increase",               color:C.orange },
                  { label:"TOU Premium",           val:"+"+results.touPremium+" pts",    sub:"value gain > kWh gain",         color:C.yellow },
                  { label:"Extra Annual Value",    val:fmt$(results.extraAnnualValue),   sub:"tracker vs fixed",              color:C.teal   },
                ].map(c => (
                  <div key={c.label} style={{background:C.surface,borderRadius:8,padding:"14px 16px",border:`1px solid ${C.border}`}}>
                    <div style={{fontSize:11,color:C.muted,marginBottom:5,textTransform:"uppercase",letterSpacing:"0.05em",fontWeight:600}}>{c.label}</div>
                    <div style={{fontSize:20,fontWeight:700,color:c.color,lineHeight:1.1}}>{c.val}</div>
                    <div style={{fontSize:11,color:C.muted,marginTop:4}}>{c.sub}</div>
                  </div>
                ))}
              </div>
              {/* Row 2: Fixed */}
              <div style={{fontSize:10,color:C.faint,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:6}}>Fixed Carport</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(2, minmax(148px, 148px))",gap:10}}>
                {[
                  { label:"Fixed Annual kWh",     val:fmtK(results.fixedKwh)+" kWh",   sub:fmt$(results.fixedValue)+"/yr",  color:C.blue   },
                  { label:"Fixed Eff. Rate",       val:"$"+results.fixedEffRate,         sub:"$/kWh earned",                  color:C.blue   },
                ].map(c => (
                  <div key={c.label} style={{background:C.surface,borderRadius:8,padding:"14px 16px",border:`1px solid ${C.border}`}}>
                    <div style={{fontSize:11,color:C.muted,marginBottom:5,textTransform:"uppercase",letterSpacing:"0.05em",fontWeight:600}}>{c.label}</div>
                    <div style={{fontSize:20,fontWeight:700,color:c.color,lineHeight:1.1}}>{c.val}</div>
                    <div style={{fontSize:11,color:C.muted,marginTop:4}}>{c.sub}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Export buttons — PVWatts CSVs · summary CSV · chart PNG */}
            <div style={{marginBottom:16,display:"flex",gap:10,justifyContent:"flex-end",flexWrap:"wrap"}}>
              {[
                { label:"↓ Export Tracker CSV (PVWatts format)", type:"tracker" },
                { label:"↓ Export Fixed Carport CSV (PVWatts format)", type:"fixed" },
              ].map(btn => (
                <button key={btn.type} onClick={() => {
                  const safeName = addressInput.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 35);
                  const dateStr  = new Date().toISOString().slice(0, 10);
                  const params   = { addressInput, geocodedLat, geocodedLon, units,
                                     utility, trackerDcAc, trackerBifacial,
                                     carportDcAc, carportBifacial, tilt, azimuth,
                                     minElev, hourlyFixed, hourlyTracker };
                  if (btn.type === "tracker") {
                    downloadCSV(buildTrackerCSV(params), `tracker_${safeName}_${dateStr}.csv`);
                  } else {
                    downloadCSV(buildFixedCSV(params), `fixed_carport_${safeName}_${dateStr}.csv`);
                  }
                }}
                style={{padding:"7px 16px",borderRadius:6,fontSize:12,fontWeight:600,
                        background:C.surface,border:`1px solid ${C.blue}`,
                        color:C.blue,cursor:"pointer"}}>
                  {btn.label}
                </button>
              ))}
              <button onClick={handleExportCombinedHourly}
                style={{padding:"7px 16px",borderRadius:6,fontSize:12,fontWeight:600,
                        background:C.surface,border:`1px solid ${C.yellow}`,
                        color:C.yellow,cursor:"pointer"}}>
                ↓ Export Combined Hourly CSV
              </button>
              <button onClick={handleExportSummaryCSV}
                style={{padding:"7px 16px",borderRadius:6,fontSize:12,fontWeight:600,
                        background:C.surface,border:`1px solid ${C.teal}`,
                        color:C.teal,cursor:"pointer"}}>
                ↓ Export Summary CSV
              </button>
              <button onClick={handleExportPNG}
                style={{padding:"7px 16px",borderRadius:6,fontSize:12,fontWeight:600,
                        background:C.surface,border:`1px solid ${C.purple}`,
                        color:C.purple,cursor:"pointer"}}>
                ↓ Export Charts PNG
              </button>
            </div>

            {/* Chart cards — wrapped for PNG export */}
            <div ref={chartsRef}>

            {/* Hourly profile chart */}
            <div style={{background:C.surface,borderRadius:8,padding:"16px",border:`1px solid ${C.border}`,marginBottom:16}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,flexWrap:"wrap",gap:8}}>
                <div style={{fontSize:14,fontWeight:600,color:C.text}}>Hourly Output Profile — Peak Window Overlay</div>
                <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                  {MONTHS.map((mn,i) => (
                    <button key={i} onClick={() => setChartMonth(i+1)}
                      style={{padding:"3px 8px",borderRadius:4,border:"1px solid",fontSize:11,cursor:"pointer",
                        background: chartMonth===i+1 ? "#1f6feb" : "transparent",
                        borderColor: chartMonth===i+1 ? "#58a6ff" : C.border,
                        color: chartMonth===i+1 ? "#ffffff" : C.muted}}>
                      {mn}
                    </button>
                  ))}
                </div>
              </div>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={hourly} margin={{top:5,right:10,left:-10,bottom:0}}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
                  {hourly.map((d,i) => d.isPeak && (
                    <ReferenceLine key={i} x={d.hour} stroke="#f7816630" strokeWidth={28} />
                  ))}
                  <XAxis dataKey="hour" tick={{fill:C.muted,fontSize:11}} interval={2} />
                  <YAxis tick={{fill:C.muted,fontSize:11}} unit=" kW" domain={[0,"auto"]} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{fontSize:12,color:C.muted}} />
                  <Line type="monotone" dataKey="fixed"   stroke={C.blue}  strokeWidth={2} dot={false} name={`Fixed ${tilt}° / ${azimuth}° az`} />
                  <Line type="monotone" dataKey="tracker" stroke={C.green} strokeWidth={2} dot={false}
                        name={minElev > 0 ? `Tracker (${minElev}° limit)` : "2-Axis Tracker"} />
                  {minElev > 0 && hourly && hourly[0]?.trackerUnlimited !== undefined && (
                    <Line type="monotone" dataKey="trackerUnlimited" stroke={C.green}
                          strokeWidth={1.5} strokeDasharray="5 4" dot={false} name="Tracker (unlimited)" />
                  )}
                </LineChart>
              </ResponsiveContainer>
              <div style={{fontSize:12,color:C.muted,marginTop:6}}>
                🟠 Shaded band = Peak TOU window (4–9 PM) · Tracker's evening extension earns peak-rate kWh that fixed tilt misses
              </div>
            </div>

            {/* Monthly value bar chart */}
            <div style={{background:C.surface,borderRadius:8,padding:"16px",border:`1px solid ${C.border}`,marginBottom:16}}>
              <div style={{fontSize:14,fontWeight:600,color:C.text,marginBottom:12}}>Monthly Dollar Value</div>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={results.monthly} margin={{top:5,right:10,left:10,bottom:0}}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
                  <XAxis dataKey="month" tick={{fill:C.muted,fontSize:11}} />
                  <YAxis tick={{fill:C.muted,fontSize:11}} tickFormatter={v => "$"+Math.round(v/1000)+"k"}
                    domain={[0, dataMax => Math.ceil(dataMax * 1.08 / 100) * 100]} width={52} />
                  <Tooltip formatter={(v,n) => ["$"+v.toLocaleString(), n]}
                    contentStyle={{background:C.surface,border:`1px solid ${C.border}`,color:C.text,fontSize:12}} />
                  <Legend wrapperStyle={{fontSize:12,color:C.muted}} />
                  <Bar dataKey="fixedValue"   fill="#1f6feb" name={`Fixed ${tilt}° / ${azimuth}° az`} radius={[2,2,0,0]} />
                  <Bar dataKey="trackerValue" fill="#238636" name="Tracker"   radius={[2,2,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            </div>{/* end chartsRef wrapper */}

            {/* Monthly table */}
            <div style={{background:C.surface,borderRadius:8,padding:"16px",border:`1px solid ${C.border}`,overflowX:"auto",marginBottom:20}}>
              <div style={{fontSize:14,fontWeight:600,color:C.text,marginBottom:12}}>Monthly Detail</div>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                <thead>
                  <tr>
                    {["Month","Fixed kWh","Tracker kWh","kWh Gain","Fixed $","Tracker $","$ Gain"].map(h => (
                      <th key={h} style={{color:C.muted,textAlign:"right",padding:"5px 10px",
                                         borderBottom:`1px solid ${C.border}`,fontWeight:600,
                                         fontSize:11,textTransform:"uppercase",letterSpacing:"0.04em"}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {results.monthly.map((row,ri) => {
                    const kg = ((row.trackerKwh / row.fixedKwh - 1) * 100).toFixed(0);
                    const vg = ((row.trackerValue / row.fixedValue - 1) * 100).toFixed(0);
                    return (
                      <tr key={row.month} style={{background: ri%2===0 ? "transparent" : "#0d111780",
                                                  borderBottom:`1px solid ${C.border}20`}}>
                        <td style={{color:C.text,  padding:"6px 10px",textAlign:"right",fontWeight:600}}>{row.month}</td>
                        <td style={{color:C.blue,  padding:"6px 10px",textAlign:"right"}}>{row.fixedKwh.toLocaleString()}</td>
                        <td style={{color:C.green, padding:"6px 10px",textAlign:"right"}}>{row.trackerKwh.toLocaleString()}</td>
                        <td style={{color:C.purple,padding:"6px 10px",textAlign:"right"}}>+{kg}%</td>
                        <td style={{color:C.blue,  padding:"6px 10px",textAlign:"right"}}>${row.fixedValue.toLocaleString()}</td>
                        <td style={{color:C.green, padding:"6px 10px",textAlign:"right"}}>${row.trackerValue.toLocaleString()}</td>
                        <td style={{color:C.orange,padding:"6px 10px",textAlign:"right",fontWeight:700}}>+{vg}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}


        {/* ── USER MANUAL MODAL ── */}
        {showManual && (
          <div style={{position:"fixed",inset:0,background:"rgba(13,17,23,0.93)",
                       zIndex:1000,overflowY:"auto",padding:"40px 20px"}}>
            <div style={{maxWidth:700,margin:"0 auto",background:C.surface,
                         border:`1px solid ${C.border}`,borderRadius:10,padding:"28px 32px"}}>
              {/* Header */}
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:24}}>
                <div>
                  <div style={{fontSize:11,color:C.blue,fontFamily:"'Inter',monospace",
                               letterSpacing:"0.12em",marginBottom:6}}>MOD-09 — USER MANUAL</div>
                  <div style={{fontSize:20,fontWeight:700,color:C.text,letterSpacing:"-0.02em"}}>
                    Dual-Axis Tracker Analyzer
                  </div>
                  <div style={{fontSize:11,color:C.muted,fontFamily:"monospace",marginTop:4}}>
                    v{VERSION} · Center for Community Energy / Makello
                  </div>
                </div>
                <div style={{display:"flex",gap:10,flexShrink:0,marginLeft:20}}>
                  <button onClick={handleDownloadManual}
                    style={{padding:"7px 14px",borderRadius:6,fontSize:11,fontWeight:700,
                            background:"#1f6feb",border:"1px solid #388bfd",
                            color:"#ffffff",cursor:"pointer",textTransform:"uppercase",letterSpacing:"0.05em"}}>
                    ↓ Download
                  </button>
                  <button onClick={() => setShowManual(false)}
                    style={{padding:"7px 14px",borderRadius:6,fontSize:11,fontWeight:600,
                            background:"transparent",border:`1px solid ${C.border}`,
                            color:C.muted,cursor:"pointer"}}>
                    ✕ Close
                  </button>
                </div>
              </div>
              <div style={{borderTop:`1px solid ${C.border}30`,paddingTop:20}}>
                {TRACKER_MANUAL.map((sec, i) => (
                  <div key={i} style={{marginBottom:24}}>
                    <div style={{fontSize:11,fontFamily:"'Inter',monospace",color:C.blue,
                                 letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:8,
                                 paddingBottom:5,borderBottom:`1px solid ${C.border}30`}}>
                      {sec.heading}
                    </div>
                    {sec.body && (
                      <p style={{fontSize:13,color:C.muted,lineHeight:1.7,margin:"0 0 8px"}}>{sec.body}</p>
                    )}
                    {sec.bullets && (
                      <ul style={{paddingLeft:18,margin:"0 0 8px"}}>
                        {sec.bullets.map((b, j) => (
                          <li key={j} style={{fontSize:13,color:C.muted,lineHeight:1.7,marginBottom:4}}>{b}</li>
                        ))}
                      </ul>
                    )}
                    {sec.body2 && (
                      <p style={{fontSize:13,color:C.muted,lineHeight:1.7,margin:"8px 0 0"}}>{sec.body2}</p>
                    )}
                  </div>
                ))}
              </div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                           marginTop:8,paddingTop:16,borderTop:`1px solid ${C.border}30`}}>
                <div style={{fontSize:10,color:C.muted,fontFamily:"monospace"}}>
                  tools.cc-energy.org · Center for Community Energy
                </div>
                <button onClick={() => setShowManual(false)}
                  style={{padding:"7px 20px",borderRadius:6,fontSize:11,fontWeight:600,
                          background:"transparent",border:`1px solid ${C.border}`,
                          color:C.muted,cursor:"pointer"}}>
                  ✕ Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Disclaimer */}
        <div style={{fontSize:11,color:C.muted,borderTop:`1px solid ${C.border}`,paddingTop:12,lineHeight:1.6}}>
          Production data from NREL PVWatts v8 API using NSRDB PSM V3 TMY weather data (4 km resolution).
          Fixed array: tilt and azimuth as set above. Tracker: dual-axis (array_type=4).
          System losses {LOSSES}% · Premium modules (module_type=1).
          Dollar values computed from actual 8,760-hour PVWatts output — each hour assigned exact TOU energy rate.
          Dollar values reflect energy value only — demand charges, customer charges, and non-bypassable charges
          are not modeled here; use MOD-05 (bill_modeler) for full bill analysis.
          SDG&E TOU-A rates effective Feb 1, 2025. SDG&E AL-TOU / AL-TOU-2 rates effective Oct 1, 2025.
          SDG&E TOU-DR1, DR-SES rates effective Oct 1, 2025. EV-TOU-5 rates effective Jan 1, 2026.
          SCE and PG&E rates are approximate — verify current tariffs before customer presentation.
          NEM 3.0 export rates not modeled — assumes full self-consumption.
        </div>

      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
