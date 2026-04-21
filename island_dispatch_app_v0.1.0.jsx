// MOD-06 island_dispatch — module
// Version: v0.4.138
// Updated: 2026-04-20 14:30 PT
// Part of: Wipomo / CCE Solar Tools

"use strict";

// ── PHYSICAL CONSTANTS ────────────────────────────────────────────────────────
const EV_EFFICIENCY    = 3.5;   // mi/kWh
const V2G_RTE          = 0.88;
const CHARGE_RTE       = 0.92;
const EVSE_KW          = 11.0;
const BATTERY_RTE      = 0.92;
const BATTERY_MIN_SOC  = 0.10;
const WW_SOLAR_FACTOR  = 0.5;   // pessimism factor for worst-window days

// ── BATTERY LIBRARY ───────────────────────────────────────────────────────────
// fixedCost = total installed cost per system configuration ($/system, not $/kWh).
// These are editable defaults — the user sets actual costs in the Battery Options panel.
const BATTERY_LIBRARY = {
  // Enphase IQ Battery 10C — 10.08 kWh / 7.68 kW per unit (scalable stack)
  "1x Enphase 10C":  { label: "1x Enphase 10C",  kwh:  10.0, kw:  7.08, fixedCost:  19600 },
  "2x Enphase 10C":  { label: "2x Enphase 10C",  kwh:  20.0, kw: 14.16, fixedCost:  28610 },
  "3x Enphase 10C":  { label: "3x Enphase 10C",  kwh:  30.0, kw: 21.24, fixedCost:  37621 },
  "4x Enphase 10C":  { label: "4x Enphase 10C",  kwh:  40.0, kw: 28.32, fixedCost:  46632 },
  "5x Enphase 10C":  { label: "5x Enphase 10C",  kwh:  50.0, kw: 35.40, fixedCost:  55643 },
  "6x Enphase 10C":  { label: "6x Enphase 10C",  kwh:  60.0, kw: 42.48, fixedCost:  64654 },
  "7x Enphase 10C":  { label: "7x Enphase 10C",  kwh:  70.0, kw: 49.56, fixedCost:  73644 },
  "8x Enphase 10C":  { label: "8x Enphase 10C",  kwh:  80.0, kw: 56.64, fixedCost:  82675 },
  "9x Enphase 10C":  { label: "9x Enphase 10C",  kwh:  90.0, kw: 63.72, fixedCost:  91703 },
  "10x Enphase 10C": { label: "10x Enphase 10C", kwh: 100.0, kw: 70.80, fixedCost: 100714 },
  // Tesla Powerwall 3 — 13.5 kWh / 11.5 kW per unit (integrated inverter, stackable)
  "1x Powerwall 3":  { label: "1x Powerwall 3",  kwh:  13.5, kw:  11.5, fixedCost:  19627 },
  "2x Powerwall 3":  { label: "2x Powerwall 3",  kwh:  27.0, kw:  23.0, fixedCost:  39254 },
  "3x Powerwall 3":  { label: "3x Powerwall 3",  kwh:  40.5, kw:  34.5, fixedCost:  58881 },
  "4x Powerwall 3":  { label: "4x Powerwall 3",  kwh:  54.0, kw:  46.0, fixedCost:  78508 },
  "5x Powerwall 3":  { label: "5x Powerwall 3",  kwh:  67.5, kw:  57.5, fixedCost:  98135 },
  "6x Powerwall 3":  { label: "6x Powerwall 3",  kwh:  81.0, kw:  69.0, fixedCost: 117762 },
  "7x Powerwall 3":  { label: "7x Powerwall 3",  kwh:  94.5, kw:  80.5, fixedCost: 137389 },
  "8x Powerwall 3":  { label: "8x Powerwall 3",  kwh: 108.0, kw:  92.0, fixedCost: 157016 },
  "9x Powerwall 3":  { label: "9x Powerwall 3",  kwh: 121.5, kw: 103.5, fixedCost: 176643 },
  "10x Powerwall 3": { label: "10x Powerwall 3", kwh: 135.0, kw: 115.0, fixedCost: 196270 },
};

// ── TITLE 24 TABLE 150.1-C: PV SIZING FACTORS ────────────────────────────────
// Formula: kWpv_dc = (CFA × A) / 1000 + (NDU × B)
// CFA = conditioned floor area (sqft), NDU = number of dwelling units
// Source: CEC Title 24 2022, Table 150.1-C
const TABLE_150_1_C = {
   1: { A: 0.793, B: 1.27 },
   2: { A: 0.621, B: 1.22 },
   3: { A: 0.628, B: 1.12 },
   4: { A: 0.586, B: 1.21 },
   5: { A: 0.585, B: 1.06 },
   6: { A: 0.594, B: 1.23 },
   7: { A: 0.572, B: 1.15 },
   8: { A: 0.586, B: 1.37 },
   9: { A: 0.613, B: 1.36 },
  10: { A: 0.627, B: 1.41 },
  11: { A: 0.836, B: 1.44 },
  12: { A: 0.613, B: 1.40 },
  13: { A: 0.894, B: 1.51 },
  14: { A: 0.741, B: 1.26 },
  15: { A: 1.56,  B: 1.47 },
  16: { A: 0.59,  B: 1.22 },
};

// Average daily usage (kWh/day) for Dec + Jan + Feb from an 8760-h annual load array.
// DOY 1-59 = Jan-Feb, DOY 336-365 = Dec (non-leap year, matching PVWatts TMY).
// Used to compute code-minimum battery = 3 × winterDailyAvg.
function winterDailyAvg(loadHourly) {
  let sum = 0, count = 0;
  for (let h = 0; h < loadHourly.length; h++) {
    const doy = Math.floor(h / 24) + 1; // 1-based day of year
    if (doy <= 59 || doy >= 336) { sum += loadHourly[h]; count++; }
  }
  return count > 0 ? (sum / count) * 24 : 0; // kWh/day
}

// ── TITLE 24 §150.1-C CRITERION 1: 3-day critical load test ──────────────────
// How many generator hours are needed to sustain the critical load panel for
// 3 days with NO solar input?  The generator makes up the energy the battery
// cannot supply.  Result must be ≤ genHrLimit (52 hr) to pass.
// Formula: max(0, (criticalLoad_kWh/day × 3  −  bat_usable_kWh) / genKw)
function criterion1GenHours(criticalLoadKwhPerDay, batKwh, genKw) {
  const totalCritical = criticalLoadKwhPerDay * 3;             // 3-day energy need (kWh)
  const batUsable     = batKwh * (1 - BATTERY_MIN_SOC);        // usable battery energy (kWh)
  return Math.max(0, (totalCritical - batUsable) / genKw);     // generator hours needed
}
// Minimum battery size for the 3-day critical load test when a generator is present.
// With a 10 kW generator at 52 hr/yr limit: max(0, 45 kWh − 520 kWh) / 0.9 → 0 kWh.
// Effectively removes the battery floor for the battery+generator path.
function criterion1MinBatKwh(criticalLoadKwhPerDay, genKw, genNormalHrLimit) {
  return Math.max(0, (criticalLoadKwhPerDay * 3 - genKw * genNormalHrLimit) / (1 - BATTERY_MIN_SOC));
}

// EV config → dispatch parameter object (v0.4.50 unified model)
// All EVs use the same parameter set:
//   tripsPerWeek: decimal — 0=home only, 0.5=biweekly, 5=weekday, 5.5=weekday+every-other-weekend
//   tripMiles: one-way miles per trip
//   destCharging: "none" | "l2_free" | "l2_paid"
//   destChargeRate: $/kWh (only used when destCharging="l2_paid")
//   dcfcPlannedPerYear: max en-route DCFC stops/yr the driver will accept
//   canV2G: bidirectional (can discharge to home)
// Emergency DCFC is a fleet-level limit (maxEmergencyDcfc in findOptimum params), not per-EV.
//
// Migration: v0.4.47 and earlier stored {purpose, workCharge, milesPerYear}.
// Detect old format by presence of ev.purpose and absence of ev.tripsPerWeek,
// then derive new params so saved EVs still produce sensible results.
function evConfigToDispatch(ev) {
  const isLegacy = ev.purpose !== undefined && ev.tripsPerWeek === undefined;

  let tripsPerWeek, tripMiles, destCharging, destChargeRate, dcfcPlannedPerYear;

  if (isLegacy) {
    const milesPerYear = ev.milesPerYear || 12000;
    if (ev.purpose === "commute") {
      tripsPerWeek       = 5;
      tripMiles          = Math.max(1, Math.round(milesPerYear / (5 * 52 * 2)));
      destCharging       = ev.workCharge === "l2_free" ? "l2_free"
                         : ev.workCharge === "l2_paid" ? "l2_paid"
                         : "none";
      destChargeRate     = ev.workChargeCostPerKwh || 0;
      dcfcPlannedPerYear = ev.workCharge === "dcfc_enroute" ? (ev.maxDcfcPerYear || 20) : 0;
    } else {
      // wfh / ordinary: home-based in v0.4.47. In new model: no scheduled trips.
      tripsPerWeek       = 0;
      tripMiles          = 0;
      destCharging       = "none";
      destChargeRate     = 0;
      dcfcPlannedPerYear = 0;
    }
  } else {
    // New v0.4.48+ format. tripsPerWeek defaults to 5 (weekday commute) if not set.
    // 0 is a valid intentional value (always-home EV), so only fall back for undefined.
    tripsPerWeek       = ev.tripsPerWeek !== undefined ? ev.tripsPerWeek : 5;
    tripMiles          = ev.tripMiles    !== undefined ? ev.tripMiles    : 15;
    destCharging       = ev.destCharging        || "none";
    destChargeRate     = ev.destChargeRate       || 0;
    dcfcPlannedPerYear = ev.dcfcPlannedPerYear   || 0;
  }

  // EV efficiency — explicit user parameter; falls back to global constant if not set.
  // Used for all driving energy calculations and per-EV emergency-range minimum.
  const efficiency = ev.evEfficiency ?? EV_EFFICIENCY;

  const roundTripMiles = tripMiles * 2;
  const roundTripKwh   = roundTripMiles / efficiency;
  // One-way range check with 25% buffer — used for departure eligibility
  const tripCheckKwh   = tripMiles * 1.25 / efficiency;

  return {
    kwh:                 ev.kwh,
    efficiency,
    tripsPerWeek,
    tripMiles,
    roundTripMiles,
    roundTripKwh,
    tripCheckKwh,
    destCharging,
    destChargeRate,
    dcfcPlannedPerYear,
    canV2G:              ev.canV2G === true,
    roadTripDays: 10,
    rtLoadFactor: 0.6,
    dcfcTargetPct:   ev.dcfcTargetPct  ?? 0.80,   // fraction — DCFC charge target (default 80 %)
    destL2TargetPct: ev.destL2TargetPct ?? 0.95,   // fraction — destination L2 charge target (default 95 %)
  };
}

// ── NSRDB HELPERS ─────────────────────────────────────────────────────────────

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371.0;
  const dlat = (lat2 - lat1) * Math.PI / 180;
  const dlon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dlat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
    * Math.sin(dlon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

function nearestCell(stressData, lat, lon) {
  let bestKey = null, bestDist = Infinity;
  for (const key of Object.keys(stressData)) {
    const cell = stressData[key];
    const d = haversine(lat, lon, cell.fetch_lat, -cell.fetch_lon);
    if (d < bestDist) {
      bestDist = d;
      bestKey = key;
    }
  }
  return { cell: stressData[bestKey], cellKey: bestKey, distKm: bestDist };
}

function expandStressWindow(cell) {
  const ghiArr  = cell.hourly.ghi;
  const dhiArr  = cell.hourly.dhi;
  const tempArr = cell.hourly.temp;
  const nHours  = cell.n_hours;
  const spinupHours    = cell.spinup_days * 24;
  const wwHours        = cell.window_days * 24;
  const wwEnd          = spinupHours + wwHours;          // first post-window hour index
  // post_window_days is present in v2.2 JSON; 0 for older JSON (no post-window data).
  // const postWindowDays = cell.post_window_days || 0;  // (not needed for flag logic)

  // Compute start date from spinup_start_year and spinup_start_doy (1-based)
  const startDate = new Date(cell.spinup_start_year, 0, 1);
  startDate.setDate(startDate.getDate() + cell.spinup_start_doy - 1);

  const weather = [];
  for (let i = 0; i < nHours; i++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + Math.floor(i / 24));
    const hr = i % 24;
    weather.push({
      month:          d.getMonth() + 1,
      day:            d.getDate(),
      year:           d.getFullYear(),
      hourOfDay:      hr,
      ghi:            ghiArr[i],
      dhi:            dhiArr[i],
      tempC:          tempArr[i],
      isWorstWindow:  i >= spinupHours && i < wwEnd,  // 10-day worst window only
      isPostWindow:   i >= wwEnd,                     // display context after WW
    });
  }
  return weather;
}

function extractWindow(arr8760, spinupStartDoy, nHours) {
  const startH = (spinupStartDoy - 1) * 24;
  const endH = startH + nHours;
  if (endH <= 8760) {
    return arr8760.slice(startH, endH);
  }
  return arr8760.slice(startH).concat(arr8760.slice(0, nHours - (8760 - startH)));
}

// ── ANNUAL WEATHER HELPER ─────────────────────────────────────────────────────
// Builds a synthetic weather array for full-year (8760-h) simulations.
// All hours have isWorstWindow=false, isPostWindow=false.
// PVWatts TMY convention: hour 0 = Jan 1 00:00–01:00, non-leap year.
function buildAnnualWeather(nHours = 8760) {
  const daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const w = [];
  let mo = 1, dy = 1, hr = 0;
  for (let h = 0; h < nHours; h++) {
    w.push({ month: mo, day: dy, year: 2023, hourOfDay: hr,
             isWorstWindow: false, isPostWindow: false });
    if (++hr >= 24) {
      hr = 0;
      if (++dy > daysInMonth[mo - 1]) { dy = 1; if (++mo > 12) mo = 1; }
    }
  }
  return w;
}

// ── EV HELPERS ────────────────────────────────────────────────────────────────

// Per-EV energy parameters (all use ev.efficiency, not the global constant)
// ev.tripCheckKwh = tripMiles * 1.25 / ev.efficiency (one-way range check with buffer)
// ev.roundTripKwh = tripMiles * 2 / ev.efficiency
// erMinKwh passed to dispatch is the site reference (computed at EV_EFFICIENCY default);
// dispatch scales it per-EV as: evMn[i] = erMinKwh * EV_EFFICIENCY / ev.efficiency

// isTripDay: Bresenham-style deterministic trip schedule from tripsPerWeek decimal.
// seqDay is 0-based sequential day index within the simulation window.
// Examples: 0=stays home, 0.5=every 14 days, 5=Mon-Fri pattern, 5.5=5+every-other-Saturday
function isTripDay(tripsPerWeek, seqDay) {
  if (tripsPerWeek <= 0) return false;
  const curr = Math.floor((seqDay + 1) * tripsPerWeek / 7);
  const prev  = Math.floor(seqDay       * tripsPerWeek / 7);
  return curr > prev;
}

function isRoadTripDay(ev, seqDay) {
  if (ev.roadTripDays === 0) return false;
  const windowTrips = Math.max(1, Math.round(ev.roadTripDays * 70 / 365));
  const interval = 70 / windowTrips;
  return (seqDay % interval) < 1.0;
}

// ── UNIFIED SIMULATION ─────────────────────────────────────────────────────────
// Single dispatch engine for any time period and any equipment mix.
// Replaces the previous three separate functions (dispatch, dispatchGenerator,
// countAnnualGenHours) so stress-window and annual simulations share identical logic.
//
// solarH     : kW array for simulation window
// loadH      : kW array for simulation window
// batKwh     : battery capacity (kWh)
// batKw      : battery max charge/discharge rate (kW)
// genKw      : generator rated output (kW); 0 = no generator
// evScenario : EV parameter objects from evConfigToDispatch(); [] = no EVs
// weather    : per-hour array { month, day, year, hourOfDay, isWorstWindow, isPostWindow }
//              Use expandStressWindow() for stress-window runs.
//              Use buildAnnualWeather()  for full-year runs.
// opts:
//   dcfcCostPerKwh  (def 0)    — cost multiplier for DCFC kWh
//   fuelCostPerKwHr (def 0.50) — generator fuel+maint per rated kW per hour
//   lookaheadDays   (def 4)    — generator planning horizon (days)
//   erMinKwh        (def 8.57) — fleet emergency-range minimum kWh at EV_EFFICIENCY
//   initialSoc      (def 0.5)  — starting battery SOC fraction
//                                 (0.5 for stress window; 1.0 for annual full-year sim)
//   returnTrace     (def false) — populate trace[] and typed Float32Array traces
//   wwExcludeStartH (def -1)   — start of WW hours to exclude from ordinance count
//   wwExcludeLen    (def 0)    — length of WW exclusion window (hours)
//
// Returns (all paths):
//   wwPass, wwPct, wwUnservedKwh   — worst-window coverage
//   simGenHours                    — total generator-on hours in window
//   wwGenHours                     — gen hours during isWorstWindow hours only
//   annGenHoursOrdinance           — gen hours excluding wwExclude window (ordinance count)
//   simGenCost                     — fuel cost for this window
//   unservedKwh, unservedHours     — unserved load totals
//   simDays                        — window length in days
//   + EV DCFC metrics (zeros when evScenario=[])
//   trace[]          (returnTrace) — per-hour object array (all chart fields)
//   traceBat, traceGen, traceUnserved (returnTrace) — typed Float32Arrays
function simulatePeriod(solarH, loadH, batKwh, batKw, genKw, evScenario, weather, opts = {}) {
  const {
    dcfcCostPerKwh  = 0,
    fuelCostPerKwHr = 0.50,
    lookaheadDays   = 4,
    erMinKwh        = 8.57,
    initialSoc      = 0.5,
    returnTrace     = false,
    wwExcludeStartH = -1,
    wwExcludeLen    = 0,
  } = opts;

  const N    = solarH.length;
  const evs  = evScenario || [];
  const nEv  = evs.length;
  const hasGen = genKw > 0;

  // ── Battery ────────────────────────────────────────────────────────────────
  const batMin = batKwh * BATTERY_MIN_SOC;
  const batMax = batKwh;
  let batE     = batKwh * initialSoc;

  // ── Generator state ────────────────────────────────────────────────────────
  const planThresh     = batMax * 0.25;
  let genRunning       = false;
  let genByPlanning    = false;
  let simGenHours      = 0;
  let wwGenHours       = 0;
  let annGenHoursOrdinance = 0;

  // shortageExpected / canStop — defined once, used by both stress-window and annual paths.
  // Both previously had identical bodies; the only prior difference was hourOfDay source
  // (weather[h] vs h%24).  Using weather[h].hourOfDay works for both because
  // buildAnnualWeather() sets hourOfDay = h%24.
  function shortageExpected(h) {
    let projE    = batE;
    const hrNow  = weather[Math.min(h, N - 1)].hourOfDay;
    const maxHrs = (24 - hrNow) + lookaheadDays * 24;
    let pastSolar = solarH[Math.min(h, N - 1)] < loadH[Math.min(h, N - 1)];
    let seenDark  = pastSolar;
    for (let j = 0; j < maxHrs; j++) {
      const idx = h + j;
      if (idx >= N) break;
      const net = solarH[idx] - loadH[idx];
      if (solarH[idx] === 0) seenDark = true;
      if (!pastSolar && net < 0) pastSolar = true;
      projE += net > 0 ? net * BATTERY_RTE : net;
      projE  = Math.min(projE, batMax);
      if (projE < planThresh)               return true;
      if (pastSolar && seenDark && net >= 0) return false;
    }
    return false;
  }

  function canStop(h) {
    let projE    = batE;
    let pastSolar = solarH[Math.min(h, N - 1)] < loadH[Math.min(h, N - 1)];
    let seenDark  = pastSolar;
    let recovIdx  = -1;
    for (let j = 0; j < 48; j++) {
      const idx = h + j;
      if (idx >= N) break;
      const net = solarH[idx] - loadH[idx];
      if (solarH[idx] === 0) seenDark = true;
      if (!pastSolar && net < 0) pastSolar = true;
      projE += net > 0 ? net * BATTERY_RTE : net;
      projE  = Math.min(projE, batMax);
      if (projE < planThresh)               return false;
      if (pastSolar && seenDark && net >= 0) { recovIdx = idx; break; }
    }
    if (recovIdx < 0) return false;
    let tmrCharge = 0;
    for (let j = 0; j < 20; j++) {
      const idx = Math.min(recovIdx + j, N - 1);
      const net = solarH[idx] - loadH[idx];
      if (net > 0) tmrCharge += net * BATTERY_RTE;
      else if (j > 4) break;
    }
    return Math.min(projE + tmrCharge, batMax) >= batMax * 0.90;
  }

  // ── EV state ───────────────────────────────────────────────────────────────
  const evE         = evs.map(e => e.kwh * 0.75);
  const evAway      = new Array(nEv).fill(false);
  const evOnTrip    = new Array(nEv).fill(false);
  const chargeToday = new Array(nEv).fill(false);
  const siteErKwh   = erMinKwh;
  const evMn        = evs.map(ev => siteErKwh * EV_EFFICIENCY / (ev.efficiency || EV_EFFICIENCY));

  let dcfcKwh = 0, dcfcCount = 0, wwDcfcKwh = 0, wwDcfcCount = 0;
  let enrouteDcfcKwh = 0, enrouteDcfcCount = 0, wwEnrouteDcfcCount = 0;
  let emergencyDcfcKwh = 0, emergencyDcfcCount = 0, wwEmergencyDcfcCount = 0;
  let emergencyRoadTripInfeasible = 0, emergencyCommuteReturn = 0, emergencyHomeBased = 0;
  let workChargeCostTotal = 0;

  // Build sequence-day index for trip scheduling (only when EVs present)
  const seqDayH = [];
  if (nEv > 0) {
    let seqDay = 0, prevDate = null;
    for (const r of weather) {
      const k = `${r.month}-${r.day}`;
      if (k !== prevDate) { if (prevDate !== null) seqDay++; prevDate = k; }
      seqDayH.push(seqDay);
    }
  }

  // ── WW + unserved accumulators ─────────────────────────────────────────────
  let wwLoad = 0, wwUns = 0;
  let unservedKwh = 0, unservedHours = 0;

  // ── Trace buffers ──────────────────────────────────────────────────────────
  const traceRows     = returnTrace ? [] : null;
  const traceBat      = returnTrace ? new Float32Array(N) : null;
  const traceGen      = returnTrace ? new Uint8Array(N)   : null;
  const traceUnserved = returnTrace ? new Float32Array(N) : null;
  const traceCurtailed = returnTrace ? new Float32Array(N) : null;
  // Per-EV energy trace (one Float32Array per EV, only when EVs present + returnTrace)
  const traceEvE      = (returnTrace && nEv > 0) ? evs.map(() => new Float32Array(N)) : null;
  const traceEvAway        = (returnTrace && nEv > 0) ? evs.map(() => new Uint8Array(N))    : null;
  const traceEnrouteDcfc   = (returnTrace && nEv > 0) ? new Uint8Array(N) : null;
  const traceEmergencyDcfc = (returnTrace && nEv > 0) ? new Uint8Array(N) : null;
  // Per-EV trace patch for road trip departure: shows post-DCFC state at departure hour
  // so the teal DCFC marker aligns with the visible SOC jump. Cleared after each trace write.
  const dcfcTracePatch = (returnTrace && nEv > 0) ? new Array(nEv).fill(null) : null;

  // ── MAIN SIMULATION LOOP ───────────────────────────────────────────────────
  for (let h = 0; h < N; h++) {
    const r    = weather[h];
    const hr   = r.hourOfDay;
    const sol  = solarH[h];
    const ld   = loadH[h];
    const inWw = r.isWorstWindow;

    // ── Generator stop / start ───────────────────────────────────────────────
    if (hasGen) {
      // Available V2G energy above each EV's safe floor (home, canV2G only).
      // Generator is suppressed while V2G EVs have usable energy — matches the
      // dispatch priority rule: generator fires only when battery AND V2G are
      // both insufficient.  When no EVs are in the scenario this is always 0
      // and generator triggers behave exactly as before.
      let v2gAvailKwh = 0;
      if (nEv > 0) {
        const sd_ = seqDayH[h];
        for (let vi = 0; vi < nEv; vi++) {
          const ev_ = evs[vi];
          if (!ev_.canV2G || evAway[vi] || evOnTrip[vi]) continue;
          const halfR_    = ev_.tripMiles > 0 ? ev_.tripMiles / (2 * ev_.efficiency) : 0;
          const v2gFloor_ = evMn[vi] + halfR_;
          const tmw_      = isTripDay(ev_.tripsPerWeek, sd_ + 1);
          const fl_       = (ev_.tripsPerWeek > 0 && tmw_) ? Math.max(v2gFloor_, ev_.roundTripKwh) : v2gFloor_;
          v2gAvailKwh    += Math.max(0, evE[vi] - fl_) * V2G_RTE;
        }
      }
      // v2gCovering: V2G has meaningful energy still available — hold off on generator
      const v2gCovering = v2gAvailKwh > 1.0;

      if (genRunning && batE >= batMax * 0.95)                             { genRunning = false; genByPlanning = false; }
      if (genRunning && sol >= ld)                                          { genRunning = false; genByPlanning = false; }
      if (genRunning && !genByPlanning && canStop(h))                         genRunning = false;
      if (!genRunning && !v2gCovering && batE <= batMax * 0.20)            { genRunning = true;  genByPlanning = false; }
      const aft = (hr >= 12 && sol < ld) || hr === 18;
      if (aft && !genRunning && !v2gCovering && batE < batMax * 0.50 && shortageExpected(h)) {
        genRunning = true; genByPlanning = true;
      }
    }
    const genOut = (hasGen && genRunning) ? genKw : 0;
    if (hasGen && genRunning) {
      simGenHours++;
      if (inWw) wwGenHours++;
      const inExclude = wwExcludeStartH >= 0 && wwExcludeLen > 0 && (
        wwExcludeStartH + wwExcludeLen <= N
          ? (h >= wwExcludeStartH && h < wwExcludeStartH + wwExcludeLen)
          : (h >= wwExcludeStartH || h < (wwExcludeStartH + wwExcludeLen) - N)
      );
      if (!inExclude) annGenHoursOrdinance++;
    }

    // ── Per-EV events ─────────────────────────────────────────────────────────
    const triggerFired = nEv > 0 ? new Array(nEv).fill(false) : [];
    let dcfcThisHour = false;
    let emergencyDcfcThisHour = false;
    let enrouteDcfcThisHour = false;
    const evKwhStart = nEv > 0 ? [...evE] : [];
    const batKwhStart = batE;

    if (nEv > 0) {
      const sd = seqDayH[h];

      for (let i = 0; i < nEv; i++) {
        const ev      = evs[i];
        const tripDay = isTripDay(ev.tripsPerWeek, sd);
        const roadTrip = isRoadTripDay(ev, sd);

        // V2G top-up of stationary battery — daytime only (sol > 0.5 kW)
        if (!evAway[i] && !evOnTrip[i] && sol > 0.5 && ev.canV2G) {
          const batNeed      = batMax - batE;
          const halfRangeKwh = ev.tripMiles > 0 ? ev.tripMiles / (2 * ev.efficiency) : 0;
          const evFloor      = evMn[i] + halfRangeKwh;
          const evSurplus    = Math.max(0, evE[i] - evFloor) * V2G_RTE;
          if (batNeed > 0.05 && evSurplus > 0.05) {
            const tr = Math.min(batNeed / BATTERY_RTE, evSurplus, EVSE_KW);
            evE[i] -= tr / V2G_RTE;
            batE   += tr * V2G_RTE * BATTERY_RTE;
          }
        }

        // Weather trigger at 6 am
        if (hr === 6) {
          if (ev.destCharging === "l2_free" || ev.destCharging === "l2_paid") {
            chargeToday[i] = false;
          } else {
            const todaySol = (() => { let s = 0; for (let j = 1; j <= 11; j++) s += solarH[Math.min(h + j, N - 1)]; return s; })();
            const tomSol   = (() => { let s = 0; for (let j = 25; j <= 35; j++) s += solarH[Math.min(h + j, N - 1)]; return s; })();
            const todayLd  = (() => { let s = 0; for (let j = 0; j < 24; j++) s += loadH[Math.min(h + j, N - 1)]; return s; })();
            const tomLd    = (() => { let s = 0; for (let j = 24; j < 48; j++) s += loadH[Math.min(h + j, N - 1)]; return s; })();
            const shortfall = Math.max(0, todayLd - todaySol) + Math.max(0, tomLd - tomSol);
            const availBat = batE - batMin;
            let availEvFleet = 0;
            for (let j = 0; j < nEv; j++) {
              if (!evs[j].canV2G || evAway[j] || evOnTrip[j]) continue;
              const jIsWfh        = evs[j].tripsPerWeek === 0;
              const jTomorrowTrip = isTripDay(evs[j].tripsPerWeek, sd + 1);
              const jFloor        = (!jIsWfh && jTomorrowTrip) ? Math.max(evMn[j], evs[j].roundTripKwh) : evMn[j];
              availEvFleet += Math.max(0, evE[j] - jFloor) * V2G_RTE;
            }
            const houseShortfall = shortfall > (availBat + availEvFleet);
            let evTransportShortfall = false;
            if (ev.tripsPerWeek > 0 && tripDay) {
              evTransportShortfall = evE[i] < ev.roundTripKwh * 1.10;
            } else if (ev.tripsPerWeek === 0) {
              const evNeedKwh  = ev.roundTripKwh * (ev.tripsPerWeek / 7);
              const evHeadroom = evE[i] - evMn[i] - evNeedKwh;
              const todaySurplus = Math.max(0, todaySol - todayLd);
              evTransportShortfall = evHeadroom < 0 && (todaySurplus * CHARGE_RTE) < -evHeadroom;
            }
            const newVal = houseShortfall || evTransportShortfall;
            if (newVal && !chargeToday[i]) triggerFired[i] = true;
            chargeToday[i] = newVal;
          }
        }

        // Road trip departure hr===7
        if (hr === 7 && roadTrip && !evAway[i] && !evOnTrip[i]) {
          const rtOneWayKwh     = ev.tripMiles / ev.efficiency;
          const rtRoundTripNeeded = rtOneWayKwh * 2 + evMn[i];
          const rtDcfcCeil      = ev.kwh * ev.dcfcTargetPct;
          if (evE[i] < rtOneWayKwh + evMn[i]) {
            const dcfcTo = Math.min(rtDcfcCeil, Math.max(rtRoundTripNeeded, rtOneWayKwh + evMn[i]));
            const added  = Math.max(0, dcfcTo - evE[i]);
            if (added > 0.1) {
              dcfcKwh += added / CHARGE_RTE; dcfcCount++;
              dcfcThisHour = true;
              if (inWw) { wwDcfcKwh += added / CHARGE_RTE; wwDcfcCount++; }
              enrouteDcfcKwh += added / CHARGE_RTE; enrouteDcfcCount++;
              enrouteDcfcThisHour = true;
              if (inWw) wwEnrouteDcfcCount++;
              evE[i] = dcfcTo;
            }
          } else if (evE[i] < rtRoundTripNeeded) {
            const dcfcTo = Math.min(rtDcfcCeil, rtRoundTripNeeded);
            const added  = Math.max(0, dcfcTo - evE[i]);
            if (added > 0.5) {
              dcfcKwh += added / CHARGE_RTE; dcfcCount++;
              dcfcThisHour = true;
              if (inWw) { wwDcfcKwh += added / CHARGE_RTE; wwDcfcCount++; }
              enrouteDcfcKwh += added / CHARGE_RTE; enrouteDcfcCount++;
              enrouteDcfcThisHour = true;
              if (inWw) wwEnrouteDcfcCount++;
              evE[i] = dcfcTo;
            }
          }
          // Before deducting outbound trip: patch trace so departure-hour shows post-DCFC
          // (pre-trip) state at home. The trip deduction becomes visible at hr=8 when EV
          // is first recorded as "away", aligning the teal DCFC marker with the SOC jump.
          if (dcfcTracePatch) dcfcTracePatch[i] = { val: evE[i], away: 0 };
          evE[i] -= rtOneWayKwh;
          evOnTrip[i] = true;
          evAway[i]   = true;
        }

        // Road trip return hr===20
        if (hr === 20 && evOnTrip[i]) {
          const rtOneWayKwh  = ev.tripMiles / ev.efficiency;
          const rtDcfcTarget = ev.kwh * ev.destL2TargetPct;
          evE[i] = Math.max(evE[i], rtDcfcTarget);
          if (evE[i] >= rtOneWayKwh + evMn[i]) {
            evE[i] -= rtOneWayKwh;
          } else if (rtDcfcTarget >= rtOneWayKwh + evMn[i]) {
            const added = Math.max(0, rtDcfcTarget - evE[i]);
            dcfcKwh += added / CHARGE_RTE; dcfcCount++;
            dcfcThisHour = true;
            if (inWw) { wwDcfcKwh += added / CHARGE_RTE; wwDcfcCount++; }
            enrouteDcfcKwh += added / CHARGE_RTE; enrouteDcfcCount++;
            enrouteDcfcThisHour = true;
            if (inWw) wwEnrouteDcfcCount++;
            evE[i] = rtDcfcTarget - rtOneWayKwh;
          } else {
            const added = Math.max(0, rtDcfcTarget - evE[i]);
            if (added > 0.1) {
              dcfcKwh += added / CHARGE_RTE; dcfcCount++;
              dcfcThisHour = true;
              if (inWw) { wwDcfcKwh += added / CHARGE_RTE; wwDcfcCount++; }
              emergencyDcfcKwh += added / CHARGE_RTE; emergencyDcfcCount++;
              emergencyDcfcThisHour = true;
              emergencyRoadTripInfeasible++;
              if (inWw) wwEmergencyDcfcCount++;
            }
            evE[i] = Math.max(evE[i] + added - rtOneWayKwh, 0);
          }
          evAway[i]   = false;
          evOnTrip[i] = false;
        }

        // Regular trip departure and return
        // Trip energy is split: one-way deducted at departure (hr=7) so the trace shows the
        // EV leaving home with less charge, and one-way deducted at return (hr=18) so the
        // return-leg consumption is visible before any solar top-up in the same timestep.
        if (ev.tripsPerWeek > 0) {
          if (hr === 7 && tripDay && !evAway[i] && !evOnTrip[i]) {
            if (evE[i] >= ev.tripCheckKwh) {
              const oneWayKwh = ev.tripMiles / ev.efficiency;
              evE[i] = Math.max(evE[i] - oneWayKwh, 0);  // deduct outbound trip energy now
              evAway[i] = true;
              // Clear DCFC trigger if remaining charge already covers return trip + 10% buffer
              if (chargeToday[i] && evE[i] >= oneWayKwh * 1.10) chargeToday[i] = false;
            }
          }
          if (hr === 18 && evAway[i] && !evOnTrip[i]) {
            evAway[i] = false;
            if (ev.destCharging === "l2_free" || ev.destCharging === "l2_paid") {
              // evE[i] is now departure_soc − oneWayKwh (= SOC on arrival at work).
              // Destination charger topped up to destL2TargetPct; drove home, losing oneWayKwh.
              const arrivalAtWork = evE[i];  // outbound energy already deducted at hr=7
              evE[i] = Math.max(ev.kwh * ev.destL2TargetPct - ev.tripMiles / ev.efficiency, evMn[i]);
              if (ev.destCharging === "l2_paid" && ev.destChargeRate > 0) {
                // addedAtWork = charge added by the employer charger during the work day
                const addedAtWork = Math.max(0, ev.kwh * ev.destL2TargetPct - arrivalAtWork);
                workChargeCostTotal += addedAtWork * ev.destChargeRate;
              }
            } else if (ev.dcfcPlannedPerYear > 0 && chargeToday[i]) {
              // outbound energy already deducted at hr=7; only return-leg remains
              const oneWayKwh = ev.tripMiles / ev.efficiency;
              const natural = Math.max(evE[i] - oneWayKwh, 0);
              const added   = Math.max(0, ev.kwh * ev.dcfcTargetPct - natural);
              dcfcKwh += added / CHARGE_RTE; dcfcCount++;
              dcfcThisHour = true;
              if (inWw) { wwDcfcKwh += added / CHARGE_RTE; wwDcfcCount++; }
              enrouteDcfcKwh += added / CHARGE_RTE; enrouteDcfcCount++;
              enrouteDcfcThisHour = true;
              if (inWw) wwEnrouteDcfcCount++;
              evE[i] = ev.kwh * ev.dcfcTargetPct;
              chargeToday[i] = false;
            } else {
              // outbound energy already deducted at hr=7; only return-leg remains
              evE[i] = Math.max(evE[i] - ev.tripMiles / ev.efficiency, 0);
              if (chargeToday[i]) {
                const added = Math.max(0, ev.kwh * ev.dcfcTargetPct - evE[i]);
                if (added > 0.1) {
                  dcfcKwh += added / CHARGE_RTE; dcfcCount++;
                  dcfcThisHour = true;
                  if (inWw) { wwDcfcKwh += added / CHARGE_RTE; wwDcfcCount++; }
                  emergencyDcfcKwh += added / CHARGE_RTE; emergencyDcfcCount++;
                  emergencyDcfcThisHour = true;
                  emergencyCommuteReturn++;
                  if (inWw) wwEmergencyDcfcCount++;
                  evE[i] = ev.kwh * ev.dcfcTargetPct;
                }
                chargeToday[i] = false;
              }
            }
          }
        }

        // Home-based EV emergency DCFC at hr===18
        if (ev.tripsPerWeek === 0 && !evOnTrip[i] && hr === 18 && chargeToday[i]) {
          const added = Math.max(0, ev.kwh * ev.dcfcTargetPct - evE[i]);
          if (added > 0.1) {
            dcfcKwh += added / CHARGE_RTE; dcfcCount++;
            dcfcThisHour = true;
            if (inWw) { wwDcfcKwh += added / CHARGE_RTE; wwDcfcCount++; }
            emergencyDcfcKwh += added / CHARGE_RTE; emergencyDcfcCount++;
            emergencyDcfcThisHour = true;
            emergencyHomeBased++;
            if (inWw) wwEmergencyDcfcCount++;
            evE[i] = ev.kwh * ev.dcfcTargetPct;
            chargeToday[i] = false;
          }
        }
      }  // end per-EV loop
    }  // end if (nEv > 0)

    const evKwhPreDispatch = nEv > 0 ? [...evE] : [];

    // Road-trip load reduction
    let rtFactor = 1.0;
    for (let i = 0; i < nEv; i++) {
      if (evOnTrip[i]) rtFactor = Math.min(rtFactor, evs[i].rtLoadFactor);
    }
    const effectiveLd = ld * rtFactor;

    // ── Energy dispatch ────────────────────────────────────────────────────────
    const totalSupply = sol + genOut;
    let direct  = Math.min(totalSupply, effectiveLd);
    let excess   = totalSupply - direct;
    let deficit  = effectiveLd - direct;

    if (nEv > 0) {
      // Three-phase surplus: (1) EVs to transport min, (2) battery, (3) EVs general top-up
      const evSolarOrder = [];
      for (let i = 0; i < nEv; i++) {
        if (evAway[i] || evOnTrip[i]) continue;
        const head = (evs[i].kwh * 0.95 - evE[i]) / CHARGE_RTE;
        if (head <= 0) continue;
        const tomorrowTrip = isTripDay(evs[i].tripsPerWeek, seqDayH[h] + 1);
        evSolarOrder.push({ i, tripsPerWeek: evs[i].tripsPerWeek, tomorrowTrip, soc: evE[i] / evs[i].kwh });
      }
      evSolarOrder.sort((a, b) => {
        const td = (b.tripsPerWeek || 0) - (a.tripsPerWeek || 0);
        if (Math.abs(td) > 0.001) return td;
        if (a.tomorrowTrip !== b.tomorrowTrip) return a.tomorrowTrip ? -1 : 1;
        return a.soc - b.soc;
      });
      // Phase 1: EV transport minimum
      for (const { i } of evSolarOrder) {
        if (excess <= 0) break;
        const tripMin = evs[i].tripsPerWeek > 0 ? evs[i].roundTripKwh * 1.10 : evMn[i] * 1.5;
        if (evE[i] >= tripMin) continue;
        const head = (tripMin - evE[i]) / CHARGE_RTE;
        const chg  = Math.min(excess, Math.max(0, head));
        evE[i] += chg * CHARGE_RTE;
        excess -= chg;
      }
      // Phase 2: battery
      const batChg = Math.min(excess, (batMax - batE) / BATTERY_RTE);
      batE   += batChg * BATTERY_RTE;
      excess -= batChg;
      // Phase 3: EVs general top-up to 95%
      for (const { i } of evSolarOrder) {
        if (excess <= 0) break;
        const head = (evs[i].kwh * 0.95 - evE[i]) / CHARGE_RTE;
        const chg  = Math.min(excess, Math.max(0, head));
        evE[i] += chg * CHARGE_RTE;
        excess -= chg;
      }

      // Deficit discharge: stationary battery first, bidi EVs second
      const sd = seqDayH[h];
      const bidiOrder = [];
      for (let ci = 0; ci < nEv; ci++) {
        if (!evs[ci].canV2G || evAway[ci] || evOnTrip[ci]) continue;
        const isWfh        = evs[ci].tripsPerWeek === 0;
        const tomorrowTrip = isTripDay(evs[ci].tripsPerWeek, sd + 1);
        const halfRangeKwh = evs[ci].tripMiles > 0 ? evs[ci].tripMiles / (2 * evs[ci].efficiency) : 0;
        const v2gSafeFloor = evMn[ci] + halfRangeKwh;
        const floor = (!isWfh && tomorrowTrip) ? Math.max(v2gSafeFloor, evs[ci].roundTripKwh) : v2gSafeFloor;
        bidiOrder.push({ ci, tripsPerWeek: evs[ci].tripsPerWeek, floor, socRatio: evE[ci] / evs[ci].kwh });
      }
      bidiOrder.sort((a, b) => {
        const td = (a.tripsPerWeek || 0) - (b.tripsPerWeek || 0);
        if (Math.abs(td) > 0.001) return td;
        return b.socRatio - a.socRatio;
      });
      const availBat = Math.min(Math.max(0, batE - batMin), batKw);
      const bd = Math.min(deficit, availBat);
      batE    -= bd;
      deficit -= bd;
      for (const { ci, floor } of bidiOrder) {
        if (deficit <= 0) break;
        const avail = Math.max(0, evE[ci] - floor) * V2G_RTE;
        const vd    = Math.min(deficit, avail, EVSE_KW);
        evE[ci] -= vd / V2G_RTE;
        deficit -= vd;
      }

      // Bidi EV → EV peer charging at night
      if (sol < 0.5) {
        const bidiSources = [];
        for (let w = 0; w < nEv; w++) {
          if (!evs[w].canV2G || evAway[w] || evOnTrip[w]) continue;
          bidiSources.push({ w, tripsPerWeek: evs[w].tripsPerWeek });
        }
        bidiSources.sort((a, b) => (a.tripsPerWeek || 0) - (b.tripsPerWeek || 0));
        for (let c = 0; c < nEv; c++) {
          if (evAway[c] || evOnTrip[c]) continue;
          if (evs[c].canV2G) {
            if (evs[c].tripsPerWeek === 0) continue;
            if (evE[c] >= evs[c].roundTripKwh * 1.10) continue;
          }
          const commTarget = evs[c].canV2G ? evs[c].roundTripKwh * 1.10 : evs[c].kwh * 0.90;
          if (evE[c] >= commTarget - 0.1) continue;
          for (const { w } of bidiSources) {
            if (w === c) continue;
            const srcTomorrowTrip = isTripDay(evs[w].tripsPerWeek, sd + 1);
            const wfhMin = srcTomorrowTrip ? Math.max(evMn[w], evs[w].roundTripKwh) : evMn[w];
            const wfhAvl = Math.max(0, evE[w] - wfhMin) * V2G_RTE;
            const evNeed = Math.max(0, commTarget - evE[c]) / CHARGE_RTE;
            const xfer   = Math.min(evNeed, wfhAvl, EVSE_KW);
            if (xfer > 0.01) { evE[w] -= xfer / V2G_RTE; evE[c] += xfer * CHARGE_RTE; }
            if (evE[c] >= commTarget - 0.1) break;
          }
        }
      }

      // Battery → EV charging
      const evChargeOrder = [];
      for (let ci = 0; ci < nEv; ci++) {
        if (evAway[ci] || evOnTrip[ci]) continue;
        const evTarget = evs[ci].kwh * 0.90;
        if (evE[ci] >= evTarget - 0.1) continue;
        const belowMin     = evE[ci] < evMn[ci];
        const tomorrowTrip = isTripDay(evs[ci].tripsPerWeek, sd + 1);
        const belowTripChk = tomorrowTrip && evE[ci] < evs[ci].roundTripKwh * 1.10;
        const prio = belowMin ? 0 : belowTripChk ? 1 : 2;
        evChargeOrder.push({ ci, prio, soc: evE[ci] / evs[ci].kwh });
      }
      evChargeOrder.sort((a, b) => a.prio !== b.prio ? a.prio - b.prio : a.soc - b.soc);
      for (const { ci, prio } of evChargeOrder) {
        if (sol > 0.5 && prio > 0) continue;
        if (sol <= 0.5 && prio >= 2) continue;
        if (prio >= 2 && evs[ci].canV2G) continue;
        const evTarget = (prio <= 1)
          ? Math.max(evMn[ci] * 1.5, evs[ci].roundTripKwh * 1.10, evs[ci].tripCheckKwh + evMn[ci])
          : evs[ci].kwh * 0.90;
        const evNeed    = Math.max(0, evTarget - evE[ci]) / CHARGE_RTE;
        const batReserve = prio === 2 ? Math.max(batMin, batMax * 0.70) : batMin;
        const batAvl     = Math.max(0, batE - batReserve);
        const xfer       = Math.min(evNeed, batAvl, EVSE_KW);
        if (xfer > 0.01) { batE -= xfer; evE[ci] += xfer * CHARGE_RTE; }
      }
    } else {
      // No EVs: simple battery charge / discharge
      const batChg = Math.min(excess * BATTERY_RTE, batMax - batE, batKw * BATTERY_RTE);
      batE   += batChg;
      excess -= batChg / BATTERY_RTE;
      const avail = Math.min(Math.max(0, batE - batMin), batKw);
      const bd    = Math.min(deficit, avail);
      batE    -= bd;
      deficit -= bd;
    }

    const uns = Math.max(0, deficit);
    if (uns > 0.001) { unservedKwh += uns; unservedHours++; }
    if (inWw) { wwLoad += effectiveLd; wwUns += uns; }

    if (returnTrace) {
      traceRows.push({
        h,
        month:           r.month,
        day:             r.day,
        year:            r.year,
        hourOfDay:       hr,
        solarKw:         sol,
        loadKw:          effectiveLd,
        batKwhStart,
        batKwhEnd:       batE,
        evKwhStart,
        evKwhPreDispatch,
        evKwhEnd:        nEv > 0 ? [...evE] : [],
        evAway:          nEv > 0 ? [...evAway] : [],
        triggerSet:      nEv > 0 ? [...chargeToday] : [],
        triggerFired,
        dcfcEvent:          dcfcThisHour,
        emergencyDcfcEvent: emergencyDcfcThisHour,
        genRunning:      hasGen && genRunning,
        genKwOut:        genOut,
        curtailed:       parseFloat(Math.max(0, excess).toFixed(3)),
        unserved:        parseFloat(uns.toFixed(3)),
        isWorstWindow:   inWw,
        isPostWindow:    r.isPostWindow || false,
      });
      traceBat[h]      = batE;
      traceGen[h]      = (hasGen && genRunning) ? 1 : 0;
      traceUnserved[h] = uns;
      if (traceEvE) for (let i = 0; i < nEv; i++) {
        const p = dcfcTracePatch?.[i];
        traceEvE[i][h] = (p != null) ? p.val : evE[i];
      }
      if (traceCurtailed) traceCurtailed[h] = Math.max(0, excess);
      if (traceEvAway) for (let i = 0; i < nEv; i++) {
        const p = dcfcTracePatch?.[i];
        traceEvAway[i][h] = (p != null) ? p.away : (evAway[i] ? 1 : 0);
      }
      // Clear departure-hour trace patches (set at road trip hr=7 departure)
      if (dcfcTracePatch) for (let i = 0; i < nEv; i++) dcfcTracePatch[i] = null;
      if (traceEnrouteDcfc)   traceEnrouteDcfc[h]   = enrouteDcfcThisHour   ? 1 : 0;
      if (traceEmergencyDcfc) traceEmergencyDcfc[h] = emergencyDcfcThisHour ? 1 : 0;
    }
  }  // end main loop

  const wwPct  = wwLoad > 0 ? (1 - wwUns / wwLoad) * 100 : 100;
  const wwPass = wwUns < 0.01;
  const simDays = N / 24;
  const annualScale = 365 / Math.max(simDays, 1);

  const result = {
    wwPass,
    wwPct:                    Math.round(wwPct * 10) / 10,
    wwUnservedKwh:            Math.round(wwUns * 100) / 100,
    simGenHours,
    wwGenHours,
    annGenHoursOrdinance,
    simGenCost:               hasGen ? Math.round(simGenHours * fuelCostPerKwHr * genKw) : 0,
    unservedKwh:              Math.round(unservedKwh * 10) / 10,
    unservedHours,
    simDays,
    // EV DCFC metrics (zero when no EVs)
    wwDcfcTrips:              wwDcfcCount,
    wwDcfcCost:               Math.round(wwDcfcKwh * dcfcCostPerKwh * 100) / 100,
    simDcfcTrips:             dcfcCount,
    simDcfcCost:              Math.round(dcfcKwh * dcfcCostPerKwh * 100) / 100,
    annualDcfcTrips:          Math.round(dcfcCount * annualScale),
    annualDcfcCost:           Math.round(dcfcKwh * dcfcCostPerKwh * annualScale * 100) / 100,
    annualEnrouteDcfcTrips:   Math.round(enrouteDcfcCount * annualScale),
    annualEnrouteDcfcCost:    Math.round(enrouteDcfcKwh * dcfcCostPerKwh * annualScale * 100) / 100,
    simEnrouteDcfcTrips:      enrouteDcfcCount,
    wwEnrouteDcfcTrips:       wwEnrouteDcfcCount,
    annualEmergencyDcfcTrips: Math.round(emergencyDcfcCount * annualScale),
    annualEmergencyDcfcCost:  Math.round(emergencyDcfcKwh * dcfcCostPerKwh * annualScale * 100) / 100,
    simEmergencyDcfcTrips:    emergencyDcfcCount,
    wwEmergencyDcfcTrips:     wwEmergencyDcfcCount,
    simEmergencyRoadTripInfeasible: emergencyRoadTripInfeasible,
    simEmergencyCommuteReturn:      emergencyCommuteReturn,
    simEmergencyHomeBased:          emergencyHomeBased,
    annualWorkChargeCost:     Math.round(workChargeCostTotal * annualScale * 100) / 100,
  };
  if (returnTrace) {
    result.trace = traceRows;
    result.traceBat = traceBat;
    result.traceGen = traceGen;
    result.traceUnserved = traceUnserved;
    result.traceEvE = traceEvE;   // Float32Array[] — one per EV, null when no EVs
    result.traceCurtailed = traceCurtailed; // Float32Array — curtailed solar kW per hour
    result.traceEvAway      = traceEvAway;   // Uint8Array[] per EV — 1 when EV is away from home
    result.traceEnrouteDcfc   = traceEnrouteDcfc;   // Uint8Array — 1 when en-route DCFC occurred this hour
    result.traceEmergencyDcfc = traceEmergencyDcfc; // Uint8Array — 1 when emergency DCFC occurred this hour
  }
  return result;
}

// ── DISPATCH (wrapper around simulatePeriod) ──────────────────────────────────
function dispatch(solarH, loadH, batKwh, batKw, evScenario, weather, dcfcCostPerKwh, returnTrace, erMinKwh) {
  return simulatePeriod(solarH, loadH, batKwh, batKw, 0, evScenario || [], weather, {
    dcfcCostPerKwh, erMinKwh, returnTrace,
  });
}

// ── FIND OPTIMUM ──────────────────────────────────────────────────────────────

function findOptimum(params) {
  const {
    lat, lon,
    mountOptions,
    loadHourly,
    evScenario,
    pvSizesKw,
    batteryOptions,
    dcfcCostPerKwh,
    evseCost = 3500,
    npvYears = 10,
    discountRate = 0.06,
    maxEmergencyDcfc = 5,      // fleet max for unplanned stops (inconvenience limit)
    maxEnrouteDcfc,            // fleet max for en-route stops (cost limit); default = per-EV sum
    erMinKwh = 10.71,          // 10.71 = 30mi * 1.25 / 3.5 mi/kWh (30-mile ER default)
    stressData,
    codePvKw = 0,      // Title 24 §150.1-C minimum — skip configs below this
    codeMinBatKwh = 0, // 3× avg winter daily usage minimum — skip configs below this
  } = params;

  const npvFactor = discountRate > 0
    ? (1.0 - (1.0 + discountRate) ** (-npvYears)) / discountRate
    : npvYears;

  const nEvs = evScenario.length;

  // En-route DCFC budget: sum of dcfcPlannedPerYear across all EVs that accept planned stops,
  // or the explicit site-level maxEnrouteDcfc if provided (whichever is tighter).
  // En-route = DCFC added to an already-scheduled trip; primary concern is cost.
  const perEvEnrouteSum = evScenario
    .filter(ev => ev.dcfcPlannedPerYear > 0)
    .reduce((sum, ev) => sum + ev.dcfcPlannedPerYear, 0);
  const fleetEnrouteLimit = maxEnrouteDcfc !== undefined
    ? Math.min(maxEnrouteDcfc, perEvEnrouteSum > 0 ? perEvEnrouteSum : maxEnrouteDcfc)
    : perEvEnrouteSum;
  const hasEnrouteEv = perEvEnrouteSum > 0;

  // Emergency DCFC budget: fleet-wide limit for special trips made solely to charge.
  // Primary concern is inconvenience — driver must make an unplanned trip.
  const effectiveEmergencyLimit = maxEmergencyDcfc;
  const effectiveEnrouteLimit   = maxEnrouteDcfc !== undefined ? maxEnrouteDcfc : fleetEnrouteLimit;

  const { cell, cellKey, distKm } = nearestCell(stressData, lat, lon);
  const weather  = expandStressWindow(cell);
  const spinupDoy = cell.spinup_start_doy;
  const loadSw    = extractWindow(loadHourly, spinupDoy, cell.n_hours);
  // annualScale uses only the core simulation period (spinup + window), NOT post-window days,
  // so that DCFC annual extrapolation is independent of how many post-window display days exist.
  const coreDays    = cell.spinup_days + cell.window_days;
  const annualScale = 365.0 / coreDays;

  const allResults = [];

  for (const mount of mountOptions) {
    const solarSw = extractWindow(mount.solarNormalized, spinupDoy, cell.n_hours);

    for (const pvKw of [...pvSizesKw].sort((a, b) => a - b)) {
      if (pvKw < codePvKw) continue;          // below Title 24 §150.1-C minimum — AHJ will reject
      const solarH = solarSw.map(x => x * pvKw);

      for (const bat of batteryOptions) {
        if (bat.kwh < codeMinBatKwh) continue; // below 3× winter-avg minimum — AHJ will reject
        const r = dispatch(solarH, loadSw, bat.kwh, bat.kw, evScenario, weather, dcfcCostPerKwh, false, erMinKwh);

        // ── Criterion 2: annual full-year coverage ─────────────────────────
        // Only run for WW-passing configs (saves time on clear failures).
        // Annual sim — always includes the full EV fleet so the optimizer can discover
        // that a smaller stationary battery + EV storage covers the full year.
        // Running the full 8760-hr simulation gives actual annual DCFC counts with no
        // extrapolation needed (annualScale = 365/365 = 1 inside simulatePeriod).
        // null = WW failed (annual check skipped entirely).
        let annualUnservedKwh   = null;
        let annualUnservedHours = null;
        let annualEnrouteDcfc   = null;   // actual full-year count (no scaling)
        let annualEmergencyDcfc = null;
        if (r.wwPass && loadHourly) {
          const annSolarH  = mount.solarNormalized.map(x => x * pvKw);
          const annWeather = buildAnnualWeather(annSolarH.length);
          const annR = simulatePeriod(annSolarH, loadHourly, bat.kwh, bat.kw, 0, evScenario, annWeather, {
            initialSoc: 1.0,
          });
          annualUnservedKwh   = annR.unservedKwh;
          annualUnservedHours = annR.unservedHours;
          annualEnrouteDcfc   = annR.simEnrouteDcfcTrips;   // 365-day sim → already full-year count
          annualEmergencyDcfc = annR.simEmergencyDcfcTrips;
        }

        const pvCost   = Math.round(pvKw * mount.pvCostPerKw);
        const batCost  = Math.round(bat.fixedCost);
        const eCost    = evseCost * nEvs;
        const sysCost  = pvCost + batCost + eCost;
        const npvDcfc  = Math.round(r.annualDcfcCost * npvFactor * 100) / 100;
        const totalCost = Math.round((sysCost + npvDcfc) * 100) / 100;

        // Stress-window DCFC sub-totals (for display — non-WW portion scaled to annual)
        const nonWwEnrouteSim     = r.simEnrouteDcfcTrips  - (r.wwEnrouteDcfcTrips  || 0);
        const nonWwEmergencySim   = r.simEmergencyDcfcTrips - (r.wwEmergencyDcfcTrips || 0);
        const nonWwEnrouteAnnual  = Math.round(nonWwEnrouteSim   * annualScale);
        const nonWwEmergencyAnnual= Math.round(nonWwEmergencySim * annualScale);
        // Emergency sub-categories (spinup only — raw sim counts)
        const simNonWwRoadTripInfeasible = r.simEmergencyRoadTripInfeasible || 0;
        const simNonWwCommuteReturn      = r.simEmergencyCommuteReturn      || 0;
        const simNonWwHomeBased          = r.simEmergencyHomeBased          || 0;

        allResults.push({
          mountLabel:                  mount.label,
          pvKw,
          batteryLabel:                bat.label,
          batteryKwh:                  bat.kwh,
          batteryKw:                   bat.kw,
          wwPass:                      r.wwPass,
          wwPct:                       r.wwPct,
          wwUnservedKwh:               r.wwUnservedKwh,
          wwDcfcTrips:                 r.wwDcfcTrips,
          wwDcfcCost:                  r.wwDcfcCost,
          annualDcfcTrips:             r.annualDcfcTrips,
          annualDcfcCost:              r.annualDcfcCost,
          nonWwAnnualEnrouteDcfc:      nonWwEnrouteAnnual,
          nonWwAnnualEmergencyDcfc:    nonWwEmergencyAnnual,
          annualEnrouteDcfcTrips:      r.annualEnrouteDcfcTrips,
          annualEnrouteDcfcCost:       r.annualEnrouteDcfcCost,
          annualEmergencyDcfcTrips:    r.annualEmergencyDcfcTrips,
          annualEmergencyDcfcCost:     r.annualEmergencyDcfcCost,
          annualWorkChargeCost:        r.annualWorkChargeCost,
          simNonWwRoadTripInfeasible,
          simNonWwCommuteReturn,
          simNonWwHomeBased,
          pvCost,
          batteryCost:                 batCost,
          evseCost:                    eCost,
          systemCost:                  sysCost,
          npvDcfc,
          totalCost,
          annualUnservedKwh,      // null = WW failed; 0 = passes annual coverage; >0 = fails
          annualUnservedHours,
          annualEnrouteDcfc,      // actual full-year en-route DCFC count (null if WW failed)
          annualEmergencyDcfc,    // actual full-year emergency DCFC count (null if WW failed)
        });
      }
    }
  }

  // ── Pass filters ──────────────────────────────────────────────────────────────
  // WW-only: Criterion 3 (worst window) + DCFC limits, no annual check.
  // Used as fallback display when no fully-valid config exists.
  // DCFC filter uses actual annual counts from the 8760-hr sim (no extrapolation).
  const passingWwOnly = allResults.filter(r =>
    r.wwPass &&
    (r.annualEnrouteDcfc   ?? 0) <= effectiveEnrouteLimit &&
    (r.annualEmergencyDcfc ?? 0) <= effectiveEmergencyLimit
  );
  const wwOnlyOptimum = passingWwOnly.length > 0
    ? passingWwOnly.reduce((best, r) => r.totalCost < best.totalCost ? r : best, passingWwOnly[0])
    : null;

  // Full: Criterion 2 (annual coverage) + 3 + DCFC — the true optimum.
  // annualUnservedKwh===null means WW failed and annual check was skipped.
  // DCFC filter uses actual annual counts from the 8760-hr sim (no extrapolation).
  const passing = allResults.filter(r =>
    r.wwPass &&
    r.annualUnservedKwh === 0 &&
    (r.annualEnrouteDcfc   ?? 0) <= effectiveEnrouteLimit &&
    (r.annualEmergencyDcfc ?? 0) <= effectiveEmergencyLimit
  );
  const optimum = passing.length > 0
    ? passing.reduce((best, r) => r.totalCost < best.totalCost ? r : best, passing[0])
    : null;

  // Diagnostic breakdown: count configs failing at each filter stage
  const nWwPass        = allResults.filter(r => r.wwPass).length;
  const nWwPassEnRoute = allResults.filter(r => r.wwPass && r.nonWwAnnualEnrouteDcfc <= effectiveEnrouteLimit).length;
  const bestWwPct      = allResults.reduce((best, r) => Math.max(best, r.wwPct), 0);
  const bestEnroute    = allResults.filter(r => r.wwPass).reduce((best, r) => Math.min(best, r.nonWwAnnualEnrouteDcfc), Infinity);
  const bestEmergency  = allResults.filter(r => r.wwPass).reduce((best, r) => Math.min(best, r.nonWwAnnualEmergencyDcfc), Infinity);
  const diagBestEnroute   = isFinite(bestEnroute)  ? bestEnroute  : null;
  const diagBestEmergency = isFinite(bestEmergency) ? bestEmergency : null;
  // Sub-category breakdown from the config that achieves bestEmergency
  const bestEmergencyConfig = isFinite(bestEmergency)
    ? allResults.filter(r => r.wwPass).find(r => r.nonWwAnnualEmergencyDcfc === bestEmergency)
    : null;
  const diagEmergencyBreakdown = bestEmergencyConfig ? {
    roadTripInfeasible: bestEmergencyConfig.simNonWwRoadTripInfeasible,
    commuteReturn:      bestEmergencyConfig.simNonWwCommuteReturn,
    homeBased:          bestEmergencyConfig.simNonWwHomeBased,
    annualScale:        Math.round(annualScale * 100) / 100,
  } : null;

  return {
    cellKey,
    cellLat:            cell.fetch_lat,
    cellLon:            -cell.fetch_lon,
    cellDistKm:         Math.round(distKm * 100) / 100,
    worstYear:          cell.worst_year,
    worstWindow:        cell.worst_window,
    spinupStartDoy:     spinupDoy,
    nHours:             cell.n_hours,
    maxEmergencyDcfc,
    maxEnrouteDcfc,
    fleetEnrouteLimit,
    effectiveEnrouteLimit,
    effectiveEmergencyLimit,
    hasEnrouteEv,
    nTotal:             allResults.length,
    nPassing:           passing.length,
    nWwOnly:            passingWwOnly.length,
    nWwPass,
    nWwPassEnRoute,
    bestWwPct:          Math.round(bestWwPct * 10) / 10,
    diagBestEnroute,
    diagBestEmergency,
    diagEmergencyBreakdown,
    optimum,
    wwOnlyOptimum,
    allPassing:         [...passing].sort((a, b) => a.totalCost - b.totalCost),
    allPassingWwOnly:   [...passingWwOnly].sort((a, b) => a.totalCost - b.totalCost),
    sweep:              allResults,
    // WW-only annual check data (for UI warning banner when no annual-valid config exists)
    _wwOnlyAnnualCheck: wwOnlyOptimum ? {
      unservedKwh:   wwOnlyOptimum.annualUnservedKwh,
      unservedHours: wwOnlyOptimum.annualUnservedHours,
    } : null,
    // For trace chart: store cell and extracted arrays for later use
    _cell:    cell,
    _weather: weather,
    _loadSw:  loadSw,
  };
}

// ── PVWATTS FETCH ─────────────────────────────────────────────────────────────

async function fetchPVWatts(lat, lon, apiKey, arrayType, tilt, azimuth, losses, dcAcRatio) {
  const params = new URLSearchParams({
    api_key:        apiKey,
    lat,
    lon,
    system_capacity: 1,
    azimuth,
    tilt,
    array_type:     arrayType,
    module_type:    0,
    losses,
    dc_ac_ratio:    dcAcRatio,
    timeframe:      "hourly",
  });
  const url = `https://developer.nlr.gov/api/pvwatts/v8.json?${params}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`PVWatts HTTP ${resp.status}: ${resp.statusText}`);
  const data = await resp.json();
  if (data.errors && data.errors.length > 0) throw new Error(`PVWatts error: ${data.errors.join(", ")}`);
  // ac_annual_output is in Wh; divide by 1000 to get kWh per kW DC per hour
  return data.outputs.ac.map(wh => wh / 1000);
}

// ── GREEN BUTTON CSV PARSER ───────────────────────────────────────────────────

function parseGreenButtonCsv(text) {
  const lines = text.split(/\r?\n/);
  // Find the DATE header row
  let dataStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].toUpperCase().includes("DATE")) {
      dataStart = i + 1;
      break;
    }
  }
  if (dataStart < 0) throw new Error("Could not find DATE header row in Green Button CSV");

  const intervals = [];
  for (let i = dataStart; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = line.split(",");
    if (cols.length < 4) continue;
    const val = parseFloat(cols[3]);
    if (!isNaN(val)) intervals.push(val);
  }

  // Sum every 4 × 15-min intervals to get hourly kWh
  const hourly = [];
  for (let i = 0; i + 3 < intervals.length; i += 4) {
    hourly.push(intervals[i] + intervals[i+1] + intervals[i+2] + intervals[i+3]);
  }

  // Trim or pad to 8760
  if (hourly.length > 8760) return hourly.slice(0, 8760);
  while (hourly.length < 8760) hourly.push(hourly[hourly.length - 1] || 0);
  return hourly;
}

// ── SYNTHETIC LOAD PROFILE ────────────────────────────────────────────────────

function syntheticLoad(annualKwh = 16000) {
  const result = [];
  let doy = 0;
  for (let h = 0; h < 8760; h++) {
    const hr = h % 24;
    if (hr === 0 && h > 0) doy++;
    // Daily shape: higher morning (7-9am) and evening (6-10pm), lower midday and night
    const hrNorm = ((hr - 7 + 24) % 24) / 24.0 * Math.PI;
    const hourWeight = 1.0 + 0.4 * Math.max(0, Math.sin(hrNorm));
    // Seasonal shape: slightly higher in summer (doy ~172 = late June)
    const seasonWeight = 1.0 + 0.1 * Math.sin((doy - 172) * 2 * Math.PI / 365);
    result.push(hourWeight * seasonWeight);
  }
  // Normalize to annualKwh
  const total = result.reduce((s, v) => s + v, 0);
  const scale = annualKwh / total;
  return result.map(v => v * scale);
}

// ── DAYTIME LOAD SHIFT ────────────────────────────────────────────────────────
// Moves pct% of evening load (hours 18–23) to midday (hours 9–15) on each day.
// Applied to the full 8760-h array before dispatch so the stress-window slice
// inherits the modified profile automatically.
function applyLoadShift(loadH, pct) {
  if (!pct || pct <= 0) return loadH;
  const out = loadH.slice();              // work on a copy, never mutate original
  const f   = pct / 100;
  const EVE = [18, 19, 20, 21, 22, 23];  // sunset → midnight
  const MID = [9, 10, 11, 12, 13, 14, 15]; // midday solar window
  for (let day = 0; day < 365; day++) {
    const b = day * 24;
    // Total evening load to relocate this day
    let eveTotal = 0;
    for (const hr of EVE) eveTotal += out[b + hr];
    const shift = eveTotal * f;
    // Reduce each evening hour proportionally
    for (const hr of EVE) out[b + hr] *= (1 - f);
    // Spread shifted load evenly across midday hours
    const add = shift / MID.length;
    for (const hr of MID) out[b + hr] += add;
  }
  return out;
}

// ── DISPATCH GENERATOR (wrapper around simulatePeriod) ───────────────────────
function dispatchGenerator(solarH, loadH, batKwh, batKw, genKw, weather, lookaheadDays = 4, fuelCostPerKwHr = 0.50, evScenario = [], erMinKwh = 10.71) {
  const r = simulatePeriod(solarH, loadH, batKwh, batKw, genKw, evScenario, weather, {
    fuelCostPerKwHr, lookaheadDays, returnTrace: true, erMinKwh,
  });
  return {
    wwPass:         r.wwPass,
    wwPct:          r.wwPct,
    wwUnservedKwh:  r.wwUnservedKwh,
    simGenHours:    r.simGenHours,
    wwGenHours:     r.wwGenHours,
    annualGenHours: r.simGenHours,   // backward compat: stress-window hours used as proxy
    annualGenCost:  r.simGenCost,
    simDays:        r.simDays,
    trace:          r.trace,
  };
}

// ── COUNT ANNUAL GEN HOURS (wrapper around simulatePeriod) ───────────────────
// Runs a full-year (8760-h or custom-length) battery+generator simulation to
// count ordinance-reportable generator hours.  Uses buildAnnualWeather() to
// supply the required weather array (no real weather object needed for annual sim).
// Starting SOC = 100 % — system finishes summer fully charged.
function countAnnualGenHours(solarH, loadH, batKwh, batKw, genKw, fuelCostPerKwHr,
                             wwStartH = -1, wwLenH = 0, lookaheadDays = 4, returnTrace = false,
                             evScenario = [], erMinKwh = 10.71) {
  const annWeather = buildAnnualWeather(solarH.length);
  const r = simulatePeriod(solarH, loadH, batKwh, batKw, genKw, evScenario, annWeather, {
    fuelCostPerKwHr, lookaheadDays,
    initialSoc:       1.0,
    returnTrace,
    wwExcludeStartH:  wwStartH,
    wwExcludeLen:     wwLenH,
    erMinKwh,
  });
  return {
    annualGenHours:    r.annGenHoursOrdinance,
    annualGenCost:     r.simGenCost,
    unservedKwh:       r.unservedKwh,
    unservedHours:     r.unservedHours,
    enrouteDcfcTrips:  r.simEnrouteDcfcTrips  || 0,
    emergencyDcfcTrips: r.simEmergencyDcfcTrips || 0,
    traceBat:          r.traceBat,
    traceGen:          r.traceGen,
    traceUnserved:     r.traceUnserved,
    traceEvE:          r.traceEvE,   // Float32Array[] per EV, null when no EVs
    traceCurtailed:    r.traceCurtailed,
  traceEvAway:       r.traceEvAway,
  traceEnrouteDcfc:   r.traceEnrouteDcfc,
  traceEmergencyDcfc: r.traceEmergencyDcfc,
  };
}

// annualSolarH and annualLoadH are the full 8760-h arrays; when provided,
// annual gen hours and fuel cost are derived from the full-year sim rather
// than the stress-window sim.
// wwStartH, wwLenH: passed through to countAnnualGenHours so worst-window hours are
// excluded from the 52 hr/yr ordinance count.  Default -1/0 = no mask (count all).
function sweepGenerators(solarH, loadH, batKwh, batKw, weather, genSizesKw, fuelCostPerKwHr, lookaheadDays,
                         annualSolarH, annualLoadH, wwStartH = -1, wwLenH = 0,
                         evScenario = [], erMinKwh = 10.71) {
  const results = genSizesKw.map(genKw => {
    const r = dispatchGenerator(solarH, loadH, batKwh, batKw, genKw, weather, lookaheadDays, fuelCostPerKwHr, evScenario, erMinKwh);
    if (annualSolarH && annualLoadH) {
      const ann = countAnnualGenHours(annualSolarH, annualLoadH, batKwh, batKw, genKw, fuelCostPerKwHr,
                                      wwStartH, wwLenH, lookaheadDays, false, evScenario, erMinKwh);
      r.annualGenHours = ann.annualGenHours;
      r.annualGenCost  = ann.annualGenCost;
    }
    return { genKw, ...r };
  });
  const passing = results.filter(r => r.wwPass);
  const minGen = passing.length > 0 ? passing.reduce((a, b) => a.genKw < b.genKw ? a : b) : null;
  return { results, minGen };
}

// Joint PV × battery × generator sweep: finds minimum total-cost (NPV) config
// that achieves 100% coverage of the worst 10-day window.
// Cost = PV capital + battery capital + generator capital + NPV(annual fuel cost)
// loadAnnual: full 8760-h load array.  When provided, annual gen hours and
// fuel cost are derived from a full-year dispatch rather than the stress window,
// giving a more realistic estimate of annual fuel expenditure for NPV.
// genHrLimit          = max generator hours in a NORMAL (non-emergency) year — default 52 hrs (CA ordinance)
//                       Also used for the Title 24 §150.1-C 3-day critical-load capacity test (criterion1Pass).
//                       countAnnualGenHours uses floor-only trigger so typical-year hours ≈ 0,
//                       ensuring this limit is trivially satisfied with any reasonable PV+battery sizing.
// emergencyGenHrLimit = max generator hours during the worst 10-day EMERGENCY window — default 200 hrs
// The two limits are checked independently:
//   wwGenHours (worst 10-day window) must be ≤ emergencyGenHrLimit  (permissive — emergency use OK)
//   annualGenHours (full TMY sim, NON-worst-window hours only) must be ≤ genHrLimit (ordinance limit)
// Generator hours during the worst window are exempt from the ordinance limit (emergency operation).
// Criterion 1 (3-day no-solar test) is also an emergency scenario — compared against emergencyGenHrLimit.
function findOptimumGenerator({ mountOptions, pvSizesKw, batteryOptions, genSizesKw, genInstalledCost,
                                 loadSw, loadAnnual, weather, cell, spinupDoy,
                                 fuelCostPerKwHr, lookaheadDays, npvYears, discountRate,
                                 codePvKw = 0, codeMinBatKwh = 0,
                                 genHrLimit = 52, emergencyGenHrLimit = 200,
                                 criticalLoadKwhPerDay = 15,
                                 evScenario = [], erMinKwh = 10.71 }) {
  const npvFactor = discountRate > 0
    ? (1.0 - Math.pow(1.0 + discountRate, -npvYears)) / discountRate
    : npvYears;
  // Worst-window start hour in the TMY 8760-h array.
  // The spinup starts at DOY spinupDoy; the worst window begins spinup_days later.
  // These hours are exempt from the 52 hr/yr ordinance limit in countAnnualGenHours.
  const wwStartH8760 = ((spinupDoy - 1) + (cell.spinup_days || 0)) * 24 % 8760;
  const wwLenH8760   = (cell.window_days || 10) * 24;  // typically 240 h (10 days)
  let best = null, bestTrace = null;
  // Per-battery summary diagnostics (for table display)
  const batteryDiag = {};
  // Full per-combination diagnostic rows (for CSV export)
  const diagRows = [];
  for (const mount of mountOptions) {
    const solarSw = extractWindow(mount.solarNormalized, spinupDoy, cell.n_hours);
    for (const pvKw of [...pvSizesKw].sort((a, b) => a - b)) {
      if (pvKw < codePvKw) continue;          // below Title 24 §150.1-C minimum
      const solarH = solarSw.map(x => x * pvKw);
      // Full-year solar array for annual gen hours estimation
      const annualSolarH = loadAnnual ? mount.solarNormalized.map(x => x * pvKw) : null;
      for (const bat of batteryOptions) {
        if (bat.kwh < codeMinBatKwh) continue; // below 3× winter-avg minimum
        // Pre-check: does this pvKw + battery already survive the stress window WITHOUT a generator?
        const batOnlyCheck = dispatchGenerator(solarH, loadSw, bat.kwh, bat.kw, 0, weather, lookaheadDays, 0, evScenario, erMinKwh);
        const batAlreadyPasses = batOnlyCheck.wwPass;
        // Init per-battery summary diag entry
        if (!batteryDiag[bat.label]) {
          batteryDiag[bat.label] = { kwh: bat.kwh, bestCost: Infinity, bestConfig: null,
                                      rejectWwPass: 0, rejectWwHours: 0, rejectAnnualHours: 0,
                                      bestAnnualHours: null, bestWwHours: null };
        }
        const diag = batteryDiag[bat.label];
        for (const genKw of [...genSizesKw].sort((a, b) => a - b)) {
          const r = dispatchGenerator(solarH, loadSw, bat.kwh, bat.kw, genKw, weather, lookaheadDays, fuelCostPerKwHr, evScenario, erMinKwh);
          // Record a diagnostic row for every combination regardless of pass/fail
          const row = {
            mount: mount.label, pvKw, batLabel: bat.label, batKwh: bat.kwh,
            genKw, batAlreadyPasses: batAlreadyPasses ? 1 : 0,
            wwPass: r.wwPass ? 1 : 0, wwGenHours: r.wwGenHours,
            annGenHours: null, annFuelCostPerYr: null,
            pvCost: null, batCost: null, genCap: null, fuelNpv: null, totalCost: null,
            rejection: null, isOptimum: 0,
          };
          if (!r.wwPass) {
            row.rejection = "wwPass_fail";
            diagRows.push(row); diag.rejectWwPass++; continue;
          }
          if (r.wwGenHours > emergencyGenHrLimit) {
            row.rejection = "wwGenHours_exceed";
            diagRows.push(row); diag.rejectWwHours++; continue;
          }
          // Annual gen hours — Criterion 2 hard filter.
          // Always run the full TMY simulation — worst-window pass does not guarantee the
          // generator is unused in a typical year (e.g. August low-solar nights can trigger it).
          const ann = (annualSolarH && loadAnnual)
            ? countAnnualGenHours(annualSolarH, loadAnnual, bat.kwh, bat.kw, genKw, fuelCostPerKwHr,
                                  wwStartH8760, wwLenH8760, lookaheadDays, false, evScenario, erMinKwh)
            : { annualGenHours: r.simGenHours, annualGenCost: r.annualGenCost };
          row.annGenHours = ann.annualGenHours;
          row.annFuelCostPerYr = ann.annualGenCost;
          if (ann.annualGenHours > genHrLimit) {
            row.rejection = "annGenHours_exceed";
            diagRows.push(row);
            diag.rejectAnnualHours++;
            if (diag.bestAnnualHours === null || ann.annualGenHours < diag.bestAnnualHours) {
              diag.bestAnnualHours = ann.annualGenHours;
              diag.bestWwHours = r.wwGenHours;
            }
            continue;
          }
          const pvCost    = Math.round(pvKw  * mount.pvCostPerKw);
          const batCost   = Math.round(bat.fixedCost);
          const genCap    = genInstalledCost;
          const fuelNpv   = Math.round(ann.annualGenCost * npvFactor);
          const totalCost = pvCost + batCost + genCap + fuelNpv;
          const c1hrs = criterion1GenHours(criticalLoadKwhPerDay, bat.kwh, genKw);
          row.pvCost = pvCost; row.batCost = batCost; row.genCap = genCap;
          row.fuelNpv = fuelNpv; row.totalCost = totalCost;
          row.rejection = "none";
          diagRows.push(row);
          // Update per-battery summary diag
          if (totalCost < diag.bestCost) {
            diag.bestCost = totalCost;
            diag.bestConfig = { pvKw, genKw, annualGenHours: ann.annualGenHours, wwGenHours: r.wwGenHours, totalCost };
            if (diag.bestAnnualHours === null) diag.bestAnnualHours = ann.annualGenHours;
          }
          if (!best || totalCost < best.totalCost) {
            best = {
              mountLabel: mount.label, pvKw,
              batteryLabel: bat.label, batteryKwh: bat.kwh, batteryKw: bat.kw,
              genKw, wwGenHours: r.wwGenHours,
              annualGenHours: ann.annualGenHours, annualFuelCost: ann.annualGenCost,
              annualEnrouteDcfc:   ann.enrouteDcfcTrips  || 0,
              annualEmergencyDcfc: ann.emergencyDcfcTrips || 0,
              criterion1GenHours: Math.round(c1hrs * 10) / 10,
              criterion1Pass: c1hrs <= emergencyGenHrLimit,
              pvCost, batCost, genCap, fuelNpv, totalCost,
              batAlreadyPasses,   // true → battery alone passes stress window (diagnostic only; generator may still run in typical year)
            };
            bestTrace = r.trace;
          }
        }
      }
    }
  }
  // Mark the winning row
  if (best) {
    for (const row of diagRows) {
      if (row.mount === best.mountLabel && row.pvKw === best.pvKw &&
          row.batLabel === best.batteryLabel && row.genKw === best.genKw) {
        row.isOptimum = 1; break;
      }
    }
  }
  return { optimum: best, trace: bestTrace, batteryDiag, diagRows };
}

// ── FORMATTING HELPERS ────────────────────────────────────────────────────────

function fmtCurrency(n) {
  return "$" + Math.round(n).toLocaleString("en-US");
}

function fmtDate(month, day) {
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[month - 1]} ${day}`;
}

function fmtDateHr(month, day, hr) {
  return `${fmtDate(month, day)} ${String(hr).padStart(2,"0")}:00`;
}

// ── REACT UI ──────────────────────────────────────────────────────────────────

const { useState, useEffect, useRef, useCallback } = React;

// Inline styles
const S = {
  topBar: {
    background: "#1a4a7a",
    color: "#fff",
    padding: "12px 24px",
    display: "flex",
    alignItems: "baseline",
    gap: "16px",
    flexWrap: "wrap",
  },
  orgName: {
    fontSize: "13px",
    opacity: 0.8,
    fontWeight: 400,
  },
  toolTitle: {
    fontSize: "20px",
    fontWeight: 700,
    flex: 1,
  },
  version: {
    fontSize: "11px",
    opacity: 0.65,
    fontFamily: "monospace",
  },
  tagline: {
    fontSize: "12px",
    opacity: 0.75,
    width: "100%",
    marginTop: "2px",
  },
  container: {
    maxWidth: "1600px",
    margin: "0 auto",
    padding: "16px",
  },
  layout: {
    display: "flex",
    gap: "16px",
    alignItems: "flex-start",
    flexWrap: "wrap",
  },
  leftPanel: {
    width: "740px",
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  rightPanel: {
    flex: 1,
    minWidth: "580px",
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  card: {
    background: "#fff",
    borderRadius: "8px",
    boxShadow: "0 1px 4px rgba(0,0,0,0.12)",
    padding: "14px 16px",
  },
  cardTitle: {
    fontSize: "12px",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: "#1a4a7a",
    marginBottom: "10px",
    borderBottom: "1px solid #e9ecef",
    paddingBottom: "6px",
  },
  fieldRow: {
    display: "flex",
    flexDirection: "column",
    gap: "3px",
    marginBottom: "8px",
  },
  label: {
    fontSize: "12px",
    fontWeight: 600,
    color: "#495057",
  },
  input: {
    border: "1px solid #ced4da",
    borderRadius: "4px",
    padding: "5px 8px",
    fontSize: "13px",
    width: "100%",
    outline: "none",
  },
  select: {
    border: "1px solid #ced4da",
    borderRadius: "4px",
    padding: "5px 8px",
    fontSize: "13px",
    width: "100%",
    background: "#fff",
    outline: "none",
  },
  btnPrimary: {
    background: "#1a4a7a",
    color: "#fff",
    border: "none",
    borderRadius: "6px",
    padding: "10px 20px",
    fontSize: "14px",
    fontWeight: 600,
    cursor: "pointer",
    width: "100%",
  },
  btnSmall: {
    background: "#e9ecef",
    color: "#495057",
    border: "1px solid #ced4da",
    borderRadius: "4px",
    padding: "3px 8px",
    fontSize: "12px",
    cursor: "pointer",
  },
  btnDanger: {
    background: "#f8d7da",
    color: "#721c24",
    border: "1px solid #f5c6cb",
    borderRadius: "4px",
    padding: "3px 8px",
    fontSize: "12px",
    cursor: "pointer",
  },
  statusMsg: (type) => ({
    padding: "8px 12px",
    borderRadius: "4px",
    fontSize: "12px",
    background: type === "error" ? "#f8d7da" : type === "ok" ? "#d4edda" : "#fff3cd",
    color: type === "error" ? "#721c24" : type === "ok" ? "#155724" : "#856404",
    border: `1px solid ${type === "error" ? "#f5c6cb" : type === "ok" ? "#c3e6cb" : "#ffeeba"}`,
  }),
  optimumCard: (pass) => ({
    background: pass ? "#d4edda" : "#f8d7da",
    border: `2px solid ${pass ? "#2d7d46" : "#c0392b"}`,
    borderRadius: "8px",
    padding: "16px",
  }),
  optimumHeadline: {
    fontSize: "18px",
    fontWeight: 700,
    marginBottom: "8px",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: "12px",
  },
  th: {
    background: "#1a4a7a",
    color: "#fff",
    padding: "6px 8px",
    textAlign: "left",
    fontWeight: 600,
    cursor: "pointer",
    whiteSpace: "nowrap",
    userSelect: "none",
  },
  td: (i, highlight) => ({
    padding: "5px 8px",
    borderBottom: "1px solid #dee2e6",
    background: highlight ? "#fff3cd" : i % 2 === 0 ? "#fff" : "#f8f9fa",
    whiteSpace: "nowrap",
  }),
  checkRow: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    marginBottom: "4px",
    fontSize: "13px",
  },
  radioRow: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    marginBottom: "6px",
    fontSize: "13px",
  },
  mountTable: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: "12px",
    marginBottom: "6px",
  },
  mountTh: {
    background: "#e9ecef",
    padding: "4px 6px",
    fontWeight: 600,
    textAlign: "left",
    fontSize: "11px",
    borderBottom: "1px solid #dee2e6",
  },
  mountTd: {
    padding: "3px 4px",
    borderBottom: "1px solid #f0f0f0",
    verticalAlign: "middle",
  },
  spinner: {
    display: "inline-block",
    width: "14px",
    height: "14px",
    border: "2px solid #ccc",
    borderTop: "2px solid #1a4a7a",
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
    verticalAlign: "middle",
    marginRight: "6px",
  },
  genCard: {
    background: "#f0f4f8",
    border: "1px solid #c5d3e0",
    borderRadius: "8px",
    padding: "14px 16px",
  },
  compareCard: {
    background: "#fff",
    border: "2px solid #1a4a7a",
    borderRadius: "10px",
    padding: "16px",
    marginBottom: "0",
  },
  compareCol: {
    flex: 1,
    minWidth: "160px",
    padding: "10px 12px",
    borderRadius: "7px",
  },
  phase2Divider: {
    background: "#e8f0f8",
    border: "1px solid #b8cce0",
    borderRadius: "6px",
    padding: "8px 12px",
    marginTop: "8px",
    marginBottom: "4px",
  },
};

// ── MOUNT ROW COMPONENT ───────────────────────────────────────────────────────

function MountRow({ row, onChange, onRemove, idx }) {
  return (
    <tr>
      <td style={S.mountTd}>
        <input style={{ ...S.input, width: "100px" }} value={row.label}
          onChange={e => onChange(idx, "label", e.target.value)} />
      </td>
      <td style={S.mountTd}>
        <select style={{ ...S.select, width: "108px" }} value={row.arrayType}
          onChange={e => onChange(idx, "arrayType", parseInt(e.target.value))}>
          <option value={0}>Fixed Ground</option>
          <option value={1}>Fixed Roof</option>
          <option value={2}>1-Axis Tracker</option>
          <option value={4}>2-Axis Tracker</option>
        </select>
      </td>
      <td style={S.mountTd}>
        <input style={{ ...S.input, width: "40px" }} type="number" value={row.tilt}
          onChange={e => onChange(idx, "tilt", parseFloat(e.target.value) || 0)} />
      </td>
      <td style={S.mountTd}>
        <input style={{ ...S.input, width: "40px" }} type="number" value={row.azimuth}
          onChange={e => onChange(idx, "azimuth", parseFloat(e.target.value) || 180)} />
      </td>
      <td style={S.mountTd}>
        <input style={{ ...S.input, width: "44px" }} type="number" value={row.dcAcRatio}
          onChange={e => onChange(idx, "dcAcRatio", parseFloat(e.target.value) || 1.1)} />
      </td>
      <td style={S.mountTd}>
        <input style={{ ...S.input, width: "40px" }} type="number" value={row.losses}
          onChange={e => onChange(idx, "losses", parseFloat(e.target.value) || 0)} />
      </td>
      <td style={S.mountTd}>
        <input style={{ ...S.input, width: "58px" }} type="number" value={row.pvCostPerKw}
          onChange={e => onChange(idx, "pvCostPerKw", parseFloat(e.target.value) || 0)} />
      </td>
      <td style={S.mountTd}>
        <button style={S.btnDanger} onClick={() => onRemove(idx)}>X</button>
      </td>
    </tr>
  );
}

// ── CHART LEGEND HELPERS ──────────────────────────────────────────────────────
// Returns a Chart.js legend config where fill:false datasets render as a line
// stroke (not a filled box), and optional extra items can be appended.
function buildLegend(extras = []) {
  return {
    labels: {
      font: { size: 10 }, boxWidth: 20,
      usePointStyle: true,           // enables pointStyle per item
      generateLabels(chart) {
        // Filter out hidden curtailment-bottom datasets (_curtBot flag)
        const items = Chart.defaults.plugins.legend.labels.generateLabels(chart)
          .filter(item => !chart.data.datasets[item.datasetIndex]?._curtBot);
        items.forEach(item => {
          const ds = chart.data.datasets[item.datasetIndex];
          if (!ds) return;
          if (ds.fill === false) {
            // Show as a horizontal line segment (dashed if the dataset is dashed)
            item.pointStyle = "line";
            item.lineDash   = ds.borderDash || [];
          } else {
            // Show as a small coloured rectangle for filled-area datasets
            item.pointStyle = "rect";
          }
        });
        for (const ex of extras) items.push(ex);
        return items;
      },
    },
  };
}

// Curtailment fill helper — draws a smooth closed bezier region between
// the solar curve (top) and the solar-minus-curtailed curve (bottom).
// Uses Chart.js meta bezier control points so the fill exactly follows
// the rendered lines rather than drawing rectangular per-hour blocks.
function drawCurtainBezier(ctx, topMeta, botMeta, curtDs) {
  const n = curtDs.length;
  let i = 0;
  while (i < n) {
    if (!curtDs[i] || curtDs[i] < 0.01) { i++; continue; }
    const start = i;
    while (i < n && curtDs[i] >= 0.01) i++;
    const end = i - 1;
    ctx.beginPath();
    // Forward along top (solar) bezier from start → end
    ctx.moveTo(topMeta.data[start].x, topMeta.data[start].y);
    for (let k = start + 1; k <= end; k++) {
      const p = topMeta.data[k - 1], c = topMeta.data[k];
      ctx.bezierCurveTo(p.cp2x ?? p.x, p.cp2y ?? p.y, c.cp1x ?? c.x, c.cp1y ?? c.y, c.x, c.y);
    }
    // Drop to bottom curve at end
    ctx.lineTo(botMeta.data[end].x, botMeta.data[end].y);
    // Backward along bottom (solar − curtailed) bezier from end → start
    // Reversed cubic: swap control-point order (B.cp1, A.cp2 instead of A.cp2, B.cp1)
    for (let k = end; k > start; k--) {
      const f = botMeta.data[k], t = botMeta.data[k - 1];
      ctx.bezierCurveTo(f.cp1x ?? f.x, f.cp1y ?? f.y, t.cp2x ?? t.x, t.cp2y ?? t.y, t.x, t.y);
    }
    ctx.closePath();
    ctx.fill();
  }
}
// Reusable extra legend items for plugin-drawn chart elements
const LEG_WW   = { text: "Worst window",      fillStyle: "rgba(192,57,43,0.14)",  strokeStyle: "rgba(0,0,0,0)",        lineWidth: 0,   lineDash: [],   hidden: false, datasetIndex: null, pointStyle: "rect" };
const LEG_PW   = { text: "Post-window",        fillStyle: "rgba(32,128,64,0.14)",  strokeStyle: "rgba(0,0,0,0)",        lineWidth: 0,   lineDash: [],   hidden: false, datasetIndex: null, pointStyle: "rect" };
const LEG_GEN  = { text: "Generator running",  fillStyle: "rgba(192,100,0,0.24)", strokeStyle: "rgba(0,0,0,0)",        lineWidth: 0,   lineDash: [],   hidden: false, datasetIndex: null, pointStyle: "rect" };
const LEG_DCFC = { text: "DCFC top-off",       fillStyle: "rgba(0,0,0,0)",        strokeStyle: "rgba(192,57,43,0.75)", lineWidth: 1.5, lineDash: [4,3], hidden: false, datasetIndex: null, pointStyle: "line" };

// ── Summary CSV helpers (save / restore) ──────────────────────────────────────

function buildMod06SummaryCSV(inputs, result) {
  const now = new Date();
  const pad = n => String(n).padStart(2, "0");
  const ts = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())} PT`;

  function csvVal(v) {
    if (v == null) return "";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  const rows = [
    ["# MOD-06 Off-Grid Optimizer — Input Summary", ""],
    ["# Version", "v0.4.138"],
    ["# Saved", ts],
    ["siteName",             inputs.siteName || ""],
    ["lat",                  inputs.lat ?? ""],
    ["lon",                  inputs.lon ?? ""],
    ["geoAddress",           inputs.geoAddress || ""],
    ["mounts",               inputs.mounts],
    ["pvSizesStr",           inputs.pvSizesStr || ""],
    ["loadMode",             inputs.loadMode || "synthetic"],
    ["annualKwh",            inputs.annualKwh ?? ""],
    ["daytimeShiftPct",      inputs.daytimeShiftPct ?? ""],
    ["uploadedLoad",         (inputs.loadMode === "upload" && inputs.uploadedLoad) ? inputs.uploadedLoad : null],
    ["uploadedFileName",     inputs.uploadedFileName || ""],
    ["selectedBatteries",    inputs.selectedBatteries],
    ["batteryCosts",         inputs.batteryCosts],
    ["evList",               inputs.evList],
    ["dcfcCostPerKwh",       inputs.dcfcCostPerKwh ?? ""],
    ["evseCost",             inputs.evseCost ?? ""],
    ["maxEmergencyDcfc",     inputs.maxEmergencyDcfc ?? ""],
    ["maxEnrouteDcfc",       inputs.maxEnrouteDcfc ?? ""],
    ["npvYears",             inputs.npvYears ?? ""],
    ["discountRate",         inputs.discountRate ?? ""],
    ["genSizesStr",          inputs.genSizesStr || ""],
    ["fuelCostPerHour",      inputs.fuelCostPerHour ?? ""],
    ["genLookaheadDays",     inputs.genLookaheadDays ?? ""],
    ["genInstalledCost",     inputs.genInstalledCost ?? ""],
    ["genHrLimit",           inputs.genHrLimit ?? ""],
    ["emergencyGenHrLimit",  inputs.emergencyGenHrLimit ?? ""],
    ["climateZone",          inputs.climateZone ?? ""],
    ["cfa",                  inputs.cfa ?? ""],
    ["ndu",                  inputs.ndu ?? ""],
    ["criticalLoadKwhPerDay",inputs.criticalLoadKwhPerDay ?? ""],
    ["--- RESULTS (reference only — not restored) ---", ""],
  ];

  if (result) {
    const opt = result.optimum || result._wwOnlyOptimum;
    if (opt) {
      rows.push(["result.batOpt.mountLabel",  opt.mountLabel  || ""]);
      rows.push(["result.batOpt.pvKw",        opt.pvKw        ?? ""]);
      rows.push(["result.batOpt.batteryLabel", opt.batteryLabel || ""]);
      rows.push(["result.batOpt.batteryKwh",  opt.batteryKwh  ?? ""]);
      rows.push(["result.batOpt.totalCost",   opt.totalCost   ?? ""]);
      rows.push(["result.batOpt.wwPct",       opt.wwPct       ?? ""]);
    }
    const genOpt = result._genOptResult?.optimum;
    if (genOpt) {
      rows.push(["result.genOpt.pvKw",         genOpt.pvKw         ?? ""]);
      rows.push(["result.genOpt.batteryLabel",  genOpt.batteryLabel || ""]);
      rows.push(["result.genOpt.genKw",         genOpt.genKw        ?? ""]);
      rows.push(["result.genOpt.totalCost",     genOpt.totalCost    ?? ""]);
      rows.push(["result.genOpt.annualGenHours",genOpt.annualGenHours ?? ""]);
    }
    rows.push(["result.nPassing", result.nPassing ?? ""]);
    rows.push(["result.nTotal",   result.nTotal   ?? ""]);
  }

  return rows.map(([k, v]) => `${csvVal(k)},${csvVal(v)}`).join("\n");
}

function parseMod06SummaryCSV(text) {
  const lines = text.split(/\r?\n/);
  const inputs = {};
  for (const line of lines) {
    if (!line.trim() || line.startsWith("#")) continue;
    if (line.startsWith("--- RESULTS")) break;
    const commaIdx = line.indexOf(",");
    if (commaIdx < 0) continue;
    const rawKey = line.slice(0, commaIdx).trim().replace(/^"|"$/g, "");
    const rawVal = line.slice(commaIdx + 1).trim();
    let val = rawVal;
    if (val.startsWith('"') && val.endsWith('"')) {
      val = val.slice(1, -1).replace(/""/g, '"');
    }
    if (val === "null") {
      val = null;
    } else if (val === "true") {
      val = true;
    } else if (val === "false") {
      val = false;
    } else if (val.startsWith("{") || val.startsWith("[")) {
      try { val = JSON.parse(val); } catch (e) { /* keep as string */ }
    } else if (val !== "" && !isNaN(Number(val))) {
      val = Number(val);
    }
    inputs[rawKey] = val;
  }
  return inputs;
}

// ── MAIN APP ──────────────────────────────────────────────────────────────────

function App() {
  // NSRDB data
  const [stressData, setStressData]   = useState(null);
  const [nsrdbStatus, setNsrdbStatus] = useState("loading"); // loading | ok | error
  const [nsrdbError, setNsrdbError]   = useState("");

  // Site inputs — blank by default; auto-restore fills in saved session
  const [siteName, setSiteName] = useState("");
  const [lat, setLat]           = useState("");
  const [lon, setLon]           = useState("");
  const [geoAddress, setGeoAddress] = useState("");
  const [geoStatus, setGeoStatus]   = useState("");

  // API key
  const [apiKey, setApiKey] = useState(() => localStorage.getItem("cce_pvwatts_api_key") || "");
  const [apiKeySource, setApiKeySource] = useState("manual"); // "config" | "local" | "manual"
  const [apiKeyOverride, setApiKeyOverride] = useState(false); // show override input when source=config

  // Mount options (now include dcAcRatio and losses per row)
  const [mounts, setMounts] = useState([
    { label: "Fixed Roof",     arrayType: 1, tilt: 20, azimuth: 180, pvCostPerKw: 2800, dcAcRatio: 1.10, losses: 14 },
    { label: "Ground 33°",     arrayType: 0, tilt: 33, azimuth: 180, pvCostPerKw: 2600, dcAcRatio: 1.25, losses: 10 },
    { label: "Ground 45°",     arrayType: 0, tilt: 45, azimuth: 180, pvCostPerKw: 2600, dcAcRatio: 1.25, losses: 10 },
    { label: "1-Axis Tracker", arrayType: 2, tilt: 0,  azimuth: 180, pvCostPerKw: 3200, dcAcRatio: 1.25, losses: 10 },
    { label: "2-Axis Tracker", arrayType: 4, tilt: 30, azimuth: 180, pvCostPerKw: 3800, dcAcRatio: 1.25, losses: 10 },
  ]);

  // PV sizes
  const [pvSizesStr, setPvSizesStr] = useState("5,8,10,12,15,18,20,25");

  // Load profile
  const [loadMode, setLoadMode]         = useState("synthetic"); // synthetic | upload
  const [annualKwh, setAnnualKwh]       = useState(16000);
  const [daytimeShiftPct, setDaytimeShiftPct] = useState(0);  // 0–20%, evening→midday shift
  const [uploadedLoad, setUploadedLoad]       = useState(null);
  const [uploadedFileName, setUploadedFileName] = useState("");
  const [uploadStatus, setUploadStatus]       = useState("");

  // Battery selection
  const [selectedBatteries, setSelectedBatteries] = useState(new Set([
    "1x Powerwall 3", "2x Powerwall 3", "3x Powerwall 3", "4x Powerwall 3", "5x Powerwall 3", "6x Powerwall 3",
    "7x Powerwall 3", "8x Powerwall 3", "9x Powerwall 3", "10x Powerwall 3",
    "1x Enphase 10C", "2x Enphase 10C", "3x Enphase 10C", "4x Enphase 10C", "5x Enphase 10C", "6x Enphase 10C",
    "7x Enphase 10C", "8x Enphase 10C", "9x Enphase 10C", "10x Enphase 10C",
  ]));
  // Per-system installed cost ($/system) for each battery option. Editable in the UI.
  // Defaults from BATTERY_LIBRARY.fixedCost; user can override to match actual quotes.
  const [batteryCosts, setBatteryCosts] = useState(() =>
    Object.fromEntries(Object.entries(BATTERY_LIBRARY).map(([k, v]) => [k, v.fixedCost]))
  );

  // EV fleet — array of { kwh, tripsPerWeek, tripMiles, destCharging, ... }; up to 3 vehicles; empty = no EV
  const [evList, setEvList] = useState([]);
  const [dcfcCostPerKwh, setDcfcCostPerKwh] = useState(0.40);
  const [evseCost, setEvseCost]             = useState(3500);
  const [maxEmergencyDcfc, setMaxEmergencyDcfc] = useState(5);
  const [maxEnrouteDcfc,   setMaxEnrouteDcfc]   = useState(26); // ~biweekly; cost concern
  const [erDistanceMiles, setErDistanceMiles] = useState(30);

  // Financial
  const [npvYears, setNpvYears]       = useState(10);
  const [discountRate, setDiscountRate] = useState(6);

  // Generator parameters
  const [genSizesStr, setGenSizesStr]         = useState("10"); // 10 kW = min size with AHJ-acceptable sound attenuation
  const [fuelCostPerHour, setFuelCostPerHour] = useState(0.50); // $/kW-hr; actual $/hr = this × genKw
  const [genLookaheadDays, setGenLookaheadDays] = useState(4);
  const [genInstalledCost, setGenInstalledCost] = useState(12000); // fixed installed cost for 10 kW generator with soundproofing
  const [genHrLimit, setGenHrLimit]             = useState(52);  // normal-year generator limit (hrs/yr, typical ordinance)
  const [emergencyGenHrLimit, setEmergencyGenHrLimit] = useState(200); // worst-window emergency limit (hrs)

  // Building code compliance (Title 24 §150.1-C)
  const [climateZone, setClimateZone]           = useState(10);
  const [cfa, setCfa]                           = useState(1626); // conditioned floor area, sqft
  const [ndu, setNdu]                           = useState(1);    // number of dwelling units
  // Critical load panel daily energy (kWh/day): heat + fridge + 1 lighting + 1 outlet circuit.
  // Code-min battery = 3 × this value.  User enters directly; 15 kWh/day is a reasonable
  // starting point for a CZ10 all-electric home with a heat pump.
  const [criticalLoadKwhPerDay, setCriticalLoadKwhPerDay] = useState(15);
  const [codeResult, setCodeResult]   = useState(null);
  const [codeRunning, setCodeRunning] = useState(false);

  // Save/restore
  const [lastSavedTime, setLastSavedTime] = useState(() => {
    const saved = localStorage.getItem("cce_mod06_inputs");
    if (saved) {
      try { const p = JSON.parse(saved); return p._savedAt || ""; } catch (e) { return ""; }
    }
    return "";
  });
  const [btnFeedback, setBtnFeedback]     = useState(""); // "saved" | "restored" | ""

  const [showHelp, setShowHelp] = useState(false);

  // Run state
  const [running, setRunning]         = useState(false);
  const [runStatus, setRunStatus]     = useState("");
  const [result, setResult]           = useState(null);
  const [runError, setRunError]       = useState("");
  const [sortCol, setSortCol]         = useState("totalCost");
  const [sortAsc, setSortAsc]         = useState(true);
  // Phase 2: EV impact analysis (runs after Phase 1, on demand)
  const [evImpact, setEvImpact]       = useState(null);
  const [evImpactRunning, setEvImpactRunning] = useState(false);
  const [sweepEvList, setSweepEvList] = useState([]); // snapshot of evList when Run Sweep was last pressed
  const [chosenPath, setChosenPath]   = useState(null); // null | "battery_only" | "battery_gen"

  // UI toggle state for collapsible sections
  const [showApiKey, setShowApiKey]           = useState(false);
  const [showNsrdbCell, setShowNsrdbCell]     = useState(false);
  const [showT24Detail, setShowT24Detail]     = useState(false);
  const [showAllConfigs, setShowAllConfigs]   = useState(false);

  // Charts — 3-panel stacked (one canvas per panel, composited for export)
  const evP1Ref  = useRef(null); const evP1Inst  = useRef(null); // solar+load
  const evP2Ref  = useRef(null); const evP2Inst  = useRef(null); // battery SOC
  const evP3Ref  = useRef(null); const evP3Inst  = useRef(null); // EV SOC
  const genP1Ref = useRef(null); const genP1Inst = useRef(null);
  const genP2Ref = useRef(null); const genP2Inst = useRef(null);
  const genP3Ref = useRef(null); const genP3Inst = useRef(null);
  // Phase 2 EV impact charts: solar/load + battery SOC + up to 4 per-EV SOC panels
  const evImpP1Ref   = useRef(null); const evImpP1Inst   = useRef(null);
  const evImpBatRef  = useRef(null); const evImpBatInst  = useRef(null);
  const evImpSoc1Ref = useRef(null); const evImpSoc1Inst = useRef(null);
  const evImpSoc2Ref = useRef(null); const evImpSoc2Inst = useRef(null);
  const evImpSoc3Ref = useRef(null); const evImpSoc3Inst = useRef(null);
  const evImpSoc4Ref = useRef(null); const evImpSoc4Inst = useRef(null);
  const evImpSocRefs  = [evImpSoc1Ref,  evImpSoc2Ref,  evImpSoc3Ref,  evImpSoc4Ref];
  const evImpSocInsts = [evImpSoc1Inst, evImpSoc2Inst, evImpSoc3Inst, evImpSoc4Inst];
  const evImpCrosshairIdx = useRef(-1);
  const [evImpHoverRow, setEvImpHoverRow] = useState(null);
  const evImpHoverRowRef = useRef(null); // mirrors state, read by native right-click handler
  const evImpChartContainerRef = useRef(null); // container ref for native contextmenu listener
  const [pinnedEvImpRow, setPinnedEvImpRow] = useState(null);
  const evImpSliceRef = useRef([]);
  // EV impact detail charts — ±24h around pinnedEvImpRow
  const evImpDiagP1Ref   = useRef(null); const evImpDiagP1Inst   = useRef(null);
  const evImpDiagBatRef  = useRef(null); const evImpDiagBatInst  = useRef(null);
  const evImpDiagSoc1Ref = useRef(null); const evImpDiagSoc1Inst = useRef(null);
  const evImpDiagSoc2Ref = useRef(null); const evImpDiagSoc2Inst = useRef(null);
  const evImpDiagSoc3Ref = useRef(null); const evImpDiagSoc3Inst = useRef(null);
  const evImpDiagSoc4Ref = useRef(null); const evImpDiagSoc4Inst = useRef(null);
  const evImpDiagSocRefs  = [evImpDiagSoc1Ref,  evImpDiagSoc2Ref,  evImpDiagSoc3Ref,  evImpDiagSoc4Ref];
  const evImpDiagSocInsts = [evImpDiagSoc1Inst, evImpDiagSoc2Inst, evImpDiagSoc3Inst, evImpDiagSoc4Inst];
  const evImpDiagCrosshairIdx = useRef(-1);
  const [evImpDiagHoverRow, setEvImpDiagHoverRow] = useState(null);
  const evImpDiagSliceRef = useRef([]); // stored for CSV export
  // Dec 17-18 diagnostic chart
  const diagP1Ref = useRef(null); const diagP1Inst = useRef(null);
  const diagP2Ref = useRef(null); const diagP2Inst = useRef(null);
  // Crosshair state for hover side panels
  const evCrosshairIdx  = useRef(-1);
  const genCrosshairIdx = useRef(-1);
  const [evHoverRow,   setEvHoverRow]   = useState(null);
  const [genHoverRow,  setGenHoverRow]  = useState(null);
  // Refs mirror hover row state so right-click always reads the latest value,
  // bypassing React's stale closure issue with async state updates from Chart.js events.
  const evHoverRowRef  = useRef(null);
  const genHoverRowRef = useRef(null);
  // Container refs for native capture-phase contextmenu listeners (bypasses Chart.js event handling)
  const evChartContainerRef  = useRef(null);
  const genChartContainerRef = useRef(null);
  const [pinnedEvRow,     setPinnedEvRow]     = useState(null);
  const [pinnedGenRow,    setPinnedGenRow]    = useState(null);
  // Annual trace chart state
  const [annZoomH,  setAnnZoomH]  = useState(0);        // zoom window start, hours into year
  const [annZoomW,  setAnnZoomW]  = useState(14 * 24);  // zoom window width in hours
  const annOverviewRef       = useRef(null);   // canvas for full-year overview strip
  const annDetailContRef     = useRef(null);   // container div (wheel listener)
  const annP1Ref             = useRef(null);   // canvas for detail power chart
  const annP2Ref             = useRef(null);   // canvas for detail battery chart
  const annP1Inst            = useRef(null);   // Chart.js instance – power
  const annP2Inst            = useRef(null);   // Chart.js instance – battery
  // Battery-only annual chart refs (zoom state shared with generator chart: annZoomH / annZoomW)
  const annBatOverviewRef    = useRef(null);
  const annBatDetailContRef  = useRef(null);
  const annBatP1Ref          = useRef(null);
  const annBatP2Ref          = useRef(null);
  const annBatP1Inst         = useRef(null);
  const annBatP2Inst         = useRef(null);
  const diagCrosshairIdx                      = useRef(-1);
  const [diagHoverRow,    setDiagHoverRow]    = useState(null);
  // Slice refs: hold current visible slice so onContextMenu can look up position from event coords
  const evSliceRef     = useRef([]);
  const genSliceRef    = useRef([]);
  const restoreFileRef = useRef(null);   // hidden <input type="file"> for summary CSV restore

  // ── Load NSRDB on mount ───────────────────────────────────────────────────

  useEffect(() => {
    setNsrdbStatus("loading");
    fetch("nsrdb_stress_window.json")
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(data => {
        setStressData(data);
        setNsrdbStatus("ok");
      })
      .catch(err => {
        setNsrdbStatus("error");
        setNsrdbError(err.message);
      });
  }, []);

  // ── Load API key from pvwatts_config.json (takes priority over localStorage) ─
  // Create pvwatts_config.json in the same directory with {"pvwatts_api_key":"YOUR_KEY"}

  useEffect(() => {
    // Check localStorage source first
    const stored = localStorage.getItem("cce_pvwatts_api_key");
    if (stored && stored.trim()) setApiKeySource("local");

    fetch("pvwatts_config.json")
      .then(r => r.ok ? r.json() : null)
      .then(cfg => {
        if (cfg && cfg.pvwatts_api_key && cfg.pvwatts_api_key.trim()) {
          setApiKey(cfg.pvwatts_api_key.trim());
          setApiKeySource("config");
        }
      })
      .catch(() => {}); // silently ignore — file is optional
  }, []);

  // ── Persist API key to localStorage as fallback ───────────────────────────

  useEffect(() => {
    localStorage.setItem("cce_pvwatts_api_key", apiKey);
  }, [apiKey]);

  // ── Persist Green Button filename in its own key (survives old-format payloads) ───

  useEffect(() => {
    if (uploadedFileName) localStorage.setItem("cce_mod06_gb_filename", uploadedFileName);
  }, [uploadedFileName]);

  // ── Auto-restore saved inputs on mount ───────────────────────────────────

  useEffect(() => {
    const raw = localStorage.getItem("cce_mod06_inputs");
    if (!raw) return;
    try {
      const p = JSON.parse(raw);
      // AUTO-RESTORE on page load: component/market fields only.
      // Customer-specific fields (annualKwh, daytimeShiftPct, npvYears, discountRate,
      // climateZone, cfa, ndu, criticalLoadKwhPerDay, evList, DCFC params,
      // uploadedLoad/fileName/Status) are NOT auto-restored — only via the explicit Restore button.
      // NOTE: siteName, lat, lon, geoAddress are also NOT auto-restored — privacy.
      if (p.mounts       !== undefined) setMounts(p.mounts);
      if (p.pvSizesStr   !== undefined) setPvSizesStr(p.pvSizesStr);
      if (p.selectedBatteries !== undefined) setSelectedBatteries(new Set(p.selectedBatteries));
      // batteryCosts: merge saved costs over library defaults (new entries get library defaults)
      if (p.batteryCosts !== undefined) setBatteryCosts(prev => ({ ...prev, ...p.batteryCosts }));
      // genSizesStr: migrate old saves that included sub-10 kW sizes (no soundproofing)
      if (p.genSizesStr !== undefined) {
        const cleaned = p.genSizesStr.split(",").map(s => parseFloat(s.trim())).filter(v => !isNaN(v) && v >= 10);
        setGenSizesStr(cleaned.length > 0 ? cleaned.join(",") : "10");
      }
      if (p.genInstalledCost      !== undefined) setGenInstalledCost(p.genInstalledCost);
      // genHrLimit: migrate old default (100) to correct ordinance value (52)
      if (p.genHrLimit !== undefined) setGenHrLimit(p.genHrLimit === 100 ? 52 : p.genHrLimit);
      if (p.emergencyGenHrLimit   !== undefined) setEmergencyGenHrLimit(p.emergencyGenHrLimit);
      if (p.fuelCostPerHour       !== undefined) setFuelCostPerHour(p.fuelCostPerHour);
      if (p.genLookaheadDays      !== undefined) setGenLookaheadDays(p.genLookaheadDays);
      // API key source (but NOT the key itself — loaded from config file separately)
      if (p._savedAt)                            setLastSavedTime(p._savedAt);
    } catch (e) { /* silent — corrupt storage, just use defaults */ }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Reset to factory defaults ─────────────────────────────────────────────

  const handleResetDefaults = () => {
    localStorage.removeItem("cce_mod06_inputs");
    // Customer fields → blank
    setSiteName("");
    setLat(""); setLon("");
    setGeoAddress(""); setGeoStatus("");
    setLoadMode("synthetic"); setAnnualKwh(16000); setDaytimeShiftPct(0);
    setUploadedLoad(null); setUploadedFileName(""); setUploadStatus("");
    // System/technical fields → sensible defaults
    setMounts([
      { label: "Fixed Roof",     arrayType: 1, tilt: 20, azimuth: 180, pvCostPerKw: 2800, dcAcRatio: 1.10, losses: 14 },
      { label: "Ground 33°",     arrayType: 0, tilt: 33, azimuth: 180, pvCostPerKw: 2600, dcAcRatio: 1.25, losses: 10 },
      { label: "Ground 45°",     arrayType: 0, tilt: 45, azimuth: 180, pvCostPerKw: 2600, dcAcRatio: 1.25, losses: 10 },
      { label: "1-Axis Tracker", arrayType: 2, tilt: 0,  azimuth: 180, pvCostPerKw: 3200, dcAcRatio: 1.25, losses: 10 },
      { label: "2-Axis Tracker", arrayType: 4, tilt: 30, azimuth: 180, pvCostPerKw: 3800, dcAcRatio: 1.25, losses: 10 },
    ]);
    setPvSizesStr("5,8,10,12,15,18,20,25");
    setSelectedBatteries(new Set(["1x Powerwall 3", "2x Powerwall 3", "1x Enphase 10C", "2x Enphase 10C", "3x Enphase 10C"]));
    setEvList([]); setDcfcCostPerKwh(0.40);
    setEvseCost(3500); setMaxEmergencyDcfc(5); setMaxEnrouteDcfc(26);
    setNpvYears(10); setDiscountRate(6);
    setGenSizesStr("10"); setFuelCostPerHour(0.50); setGenLookaheadDays(4); setGenInstalledCost(12000);
    setGenHrLimit(52); setEmergencyGenHrLimit(200); setClimateZone(""); setCfa(""); setNdu(1); setCriticalLoadKwhPerDay(15);
    setLastSavedTime(""); setResult(null);
  };

  // ── Mount table handlers ──────────────────────────────────────────────────

  const handleMountChange = (idx, field, val) => {
    setMounts(prev => prev.map((m, i) => i === idx ? { ...m, [field]: val } : m));
  };
  const handleAddMount = () => {
    setMounts(prev => [...prev, { label: "Mount " + (prev.length + 1), arrayType: 1, tilt: 20, azimuth: 180, pvCostPerKw: 2800, dcAcRatio: 1.1, losses: 12 }]);
  };
  const handleRemoveMount = (idx) => {
    setMounts(prev => prev.filter((_, i) => i !== idx));
  };

  // ── Geocode ───────────────────────────────────────────────────────────────

  const handleGeocode = async () => {
    if (!geoAddress.trim()) return;
    setGeoStatus("Looking up...");

    // ── Pass 1: Nominatim free-form ──────────────────────────────────────────
    try {
      const nomUrl = `https://nominatim.openstreetmap.org/search?format=json&countrycodes=us&q=${encodeURIComponent(geoAddress)}`;
      const nomData = await fetch(nomUrl, { headers: { "Accept": "application/json" } }).then(r => r.json());
      if (nomData && nomData.length > 0) {
        setLat(parseFloat(parseFloat(nomData[0].lat).toFixed(4)));
        setLon(parseFloat(parseFloat(nomData[0].lon).toFixed(4)));
        setGeoStatus(`Found: ${nomData[0].display_name.substring(0, 70)}`);
        return;
      }
    } catch (_) { /* network error — try next */ }

    // ── Pass 2: Nominatim structured query (better for rural US addresses) ───
    // Parse "number street, city state zip" into components
    setGeoStatus("Trying structured lookup...");
    try {
      const addr = geoAddress.trim();
      // Match: "NUMBER STREET, CITY STATE ZIP" or "NUMBER STREET, CITY, STATE ZIP"
      const m = addr.match(/^(\d+\s+[^,]+),\s*([^,]+?)(?:,\s*|\s+)([A-Z]{2})\s*(\d{5})?$/i);
      if (m) {
        const [, street, city, state, zip] = m;
        let structUrl = `https://nominatim.openstreetmap.org/search?format=json&countrycodes=us&street=${encodeURIComponent(street)}&city=${encodeURIComponent(city)}&state=${encodeURIComponent(state)}`;
        if (zip) structUrl += `&postalcode=${zip}`;
        const structData = await fetch(structUrl, { headers: { "Accept": "application/json" } }).then(r => r.json());
        if (structData && structData.length > 0) {
          setLat(parseFloat(parseFloat(structData[0].lat).toFixed(4)));
          setLon(parseFloat(parseFloat(structData[0].lon).toFixed(4)));
          setGeoStatus(`Found: ${structData[0].display_name.substring(0, 70)}`);
          return;
        }
      }
    } catch (_) { /* try next */ }

    // ── Pass 3: Photon (Komoot) — OSM-based, CORS-enabled ───────────────────
    setGeoStatus("Trying Photon geocoder...");
    try {
      const photonUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(geoAddress)}&countrycode=us&limit=1&lang=en`;
      const photonData = await fetch(photonUrl).then(r => r.json());
      const feat = photonData?.features?.[0];
      if (feat) {
        const [pLon, pLat] = feat.geometry.coordinates;
        setLat(parseFloat(pLat.toFixed(4)));
        setLon(parseFloat(pLon.toFixed(4)));
        const p = feat.properties;
        setGeoStatus(`Found (Photon): ${[p.name, p.street, p.city, p.state].filter(Boolean).join(", ")}`);
        return;
      }
    } catch (_) { /* fall through */ }

    // ── All failed ───────────────────────────────────────────────────────────
    setGeoStatus("Address not found. Enter lat/lon manually — right-click the location in Google Maps and copy the coordinates shown.");
  };

  // ── Green Button file upload ──────────────────────────────────────────────

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploadedFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = parseGreenButtonCsv(ev.target.result);
        setUploadedLoad(parsed);
        const ann = Math.round(parsed.reduce((s, v) => s + v, 0));
        setUploadStatus(`${file.name} — ${parsed.length} hours, ${ann.toLocaleString()} kWh/yr`);
      } catch (err) {
        setUploadStatus("Parse error: " + err.message);
        setUploadedLoad(null);
      }
    };
    reader.readAsText(file);
  };

  // ── EV fleet handlers ────────────────────────────────────────────────────

  const addEv = () => {
    if (evList.length >= 3) return;
    setEvList(prev => [...prev, { kwh: 88, tripsPerWeek: 5, tripMiles: 15, destCharging: "none", destChargeRate: 0.25, dcfcPlannedPerYear: 0, canV2G: false, dcfcTargetPct: 0.80, destL2TargetPct: 0.95 }]);
  };
  const removeEv = (i) => setEvList(prev => prev.filter((_, idx) => idx !== i));
  const updateEv = (i, field, val) => setEvList(prev => prev.map((ev, idx) => idx === i ? { ...ev, [field]: val } : ev));

  // ── Battery toggle ────────────────────────────────────────────────────────

  const toggleBattery = (key) => {
    setSelectedBatteries(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  // ── Table sort ────────────────────────────────────────────────────────────

  const handleSort = (col) => {
    if (sortCol === col) setSortAsc(a => !a);
    else { setSortCol(col); setSortAsc(true); }
  };

  const sortedPassing = result ? [...result.allPassing].sort((a, b) => {
    const av = a[sortCol], bv = b[sortCol];
    if (typeof av === "number") return sortAsc ? av - bv : bv - av;
    return sortAsc ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
  }) : [];

  // ── Restore inputs from summary CSV file ─────────────────────────────────

  const handleRestoreFile = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = ""; // reset so same file can be re-selected
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const p = parseMod06SummaryCSV(ev.target.result);
        if (p.siteName                  !== undefined) setSiteName(p.siteName);
        if (p.lat                       !== undefined) setLat(p.lat);
        if (p.lon                       !== undefined) setLon(p.lon);
        if (p.geoAddress                !== undefined) setGeoAddress(p.geoAddress);
        if (p.mounts                    !== undefined) setMounts(p.mounts);
        if (p.pvSizesStr                !== undefined) setPvSizesStr(p.pvSizesStr);
        if (p.annualKwh                 !== undefined) setAnnualKwh(p.annualKwh);
        if (p.daytimeShiftPct           !== undefined) setDaytimeShiftPct(p.daytimeShiftPct);
        if (p.selectedBatteries         !== undefined) setSelectedBatteries(new Set(p.selectedBatteries));
        if (p.batteryCosts              !== undefined) setBatteryCosts(prev => ({ ...prev, ...p.batteryCosts }));
        if (p.evList && Array.isArray(p.evList))       setEvList(p.evList);
        if (p.dcfcCostPerKwh            !== undefined) setDcfcCostPerKwh(p.dcfcCostPerKwh);
        if (p.evseCost                  !== undefined) setEvseCost(p.evseCost);
        if (p.maxEmergencyDcfc          !== undefined) setMaxEmergencyDcfc(p.maxEmergencyDcfc);
        if (p.maxEnrouteDcfc            !== undefined) setMaxEnrouteDcfc(p.maxEnrouteDcfc);
        if (p.npvYears                  !== undefined) setNpvYears(p.npvYears);
        if (p.discountRate              !== undefined) setDiscountRate(p.discountRate);
        // genSizesStr: strip sub-10 kW sizes (older summary files may contain them)
        if (p.genSizesStr !== undefined) {
          const cleaned = String(p.genSizesStr).split(",").map(s => parseFloat(s.trim())).filter(v => !isNaN(v) && v >= 10);
          setGenSizesStr(cleaned.length > 0 ? cleaned.join(",") : "10");
        }
        if (p.fuelCostPerHour           !== undefined) setFuelCostPerHour(p.fuelCostPerHour);
        if (p.genLookaheadDays          !== undefined) setGenLookaheadDays(p.genLookaheadDays);
        if (p.genInstalledCost          !== undefined) setGenInstalledCost(p.genInstalledCost);
        // genHrLimit: migrate old default (100) to correct ordinance value (52)
        if (p.genHrLimit !== undefined) setGenHrLimit(p.genHrLimit === 100 ? 52 : p.genHrLimit);
        if (p.emergencyGenHrLimit       !== undefined) setEmergencyGenHrLimit(p.emergencyGenHrLimit);
        if (p.climateZone               !== undefined) setClimateZone(p.climateZone);
        if (p.cfa                       !== undefined) setCfa(p.cfa);
        if (p.ndu                       !== undefined) setNdu(p.ndu);
        if (p.criticalLoadKwhPerDay     !== undefined) setCriticalLoadKwhPerDay(p.criticalLoadKwhPerDay);
        // Green Button data
        if (p.uploadedLoad && Array.isArray(p.uploadedLoad) && p.uploadedLoad.length > 0) {
          setLoadMode("upload");
          setUploadedLoad(p.uploadedLoad);
          const fn = p.uploadedFileName || "";
          setUploadedFileName(fn);
          const ann = Math.round(p.uploadedLoad.reduce((s, v) => s + v, 0));
          const fname = fn ? `${fn} — ` : "";
          setUploadStatus(`Restored: ${fname}${p.uploadedLoad.length} hours, ${ann.toLocaleString()} kWh/yr`);
        } else {
          setLoadMode(p.loadMode === "upload" ? "synthetic" : (p.loadMode || "synthetic"));
          if (p.loadMode === "upload") setUploadStatus("Green Button data not in summary file — using synthetic load.");
        }
        setBtnFeedback("restored"); setTimeout(() => setBtnFeedback(""), 2000);
      } catch (err) {
        alert("Failed to restore inputs: " + err.message);
      }
    };
    reader.readAsText(file);
  }, []);

  // ── Phase 2: EV impact analysis ──────────────────────────────────────────
  // Given the two Phase 1 optimal systems, check how each configured EV topology
  // affects worst-window coverage and DCFC exposure.

  const handleAnalyzeEv = useCallback(async () => {
    if (!result || evList.length === 0 || !stressData) return;
    setEvImpactRunning(true);

    try {
      // Reconstruct the same inputs used in Phase 1
      const pvSizes = pvSizesStr.split(",").map(s => parseFloat(s.trim())).filter(v => !isNaN(v) && v > 0);
      const batteryOptions = Object.entries(BATTERY_LIBRARY)
        .filter(([k]) => selectedBatteries.has(k))
        .map(([k, v]) => ({ ...v, fixedCost: batteryCosts[k] ?? v.fixedCost }));
      const loadHourly = applyLoadShift(
        loadMode === "upload" && uploadedLoad ? uploadedLoad : syntheticLoad(annualKwh),
        daytimeShiftPct
      );
      const mountOptions = lastMountSolarsRef.current;
      if (!mountOptions || mountOptions.length === 0) return;

      // Title 24 code minimums are building properties — unchanged by EV topology
      const codePvKw      = result._codePvKw      || 0;
      const codeMinBatKwh = result._codeMinBatKwh || 0;

      // ── EV impact constraints: can't shrink or reconfigure existing system ──
      // Adding EVs may require a larger system, but nobody removes existing PV,
      // changes mount type, or swaps battery brands because they added an EV.
      const baseline = (chosenPath === "battery_gen" ? result._genOptResult?.optimum : null) || result.optimum;
      // Mount: locked to the baseline mount (can't retilt/reorient existing array)
      const baselineMountLabel = baseline?.mountLabel || null;
      const evMountOptions = (baseline && baselineMountLabel)
        ? mountOptions.filter(m => m.label === baselineMountLabel)
        : mountOptions;
      // PV: only sizes at or above the baseline
      const evPvSizes = baseline
        ? pvSizes.filter(sz => sz >= baseline.pvKw)
        : pvSizes;
      // Battery: same brand family (strip leading "Nx " prefix) at or above baseline kWh
      const baselineBatFamily = baseline?.batteryLabel?.replace(/^\d+x /, '') || null;
      const evBatteryOptions = (baseline && baselineBatFamily)
        ? batteryOptions.filter(b => b.label.replace(/^\d+x /, '') === baselineBatFamily && b.kwh >= baseline.batteryKwh)
        : batteryOptions;

      // ── All EVs as one combined fleet ─────────────────────────────────────
      // Multiple EVs are owned simultaneously, not alternative choices.
      // Run a single findOptimum with the full fleet so EV-to-EV interactions
      // are modelled correctly: a WFH EV's large battery can buffer daytime solar
      // for a commuter EV overnight, which may cost less than enlarging the
      // stationary battery for the commuter alone.
      const fleetScen = evList.map(ev => evConfigToDispatch(ev));

      // Build per-EV summary for display.
      // Use the normalized dispatch params (fleetScen) so defaults and old-format
      // migration are applied consistently — raw ev objects may have undefined fields
      // if they were created before v0.4.48 and loaded from localStorage.
      const fleetSummary = fleetScen.map((disp, idx) => {
        const ev = evList[idx];
        const dc = disp.destCharging;
        const topology = dc === "l2_free"               ? "L2-free"
                       : dc === "l2_paid"               ? "L2-paid"
                       : disp.dcfcPlannedPerYear > 0    ? "DCFC-enroute"
                       : disp.canV2G                    ? "V2H-bidi"
                       :                                  "Home-charge";
        const topologyDesc = dc === "l2_free"            ? "Free L2 at destination"
                           : dc === "l2_paid"            ? `Paid L2 at destination ($${disp.destChargeRate}/kWh)`
                           : disp.dcfcPlannedPerYear > 0 ? `Planned DCFC up to ${disp.dcfcPlannedPerYear}/yr`
                           : disp.canV2G                 ? "V2H bidirectional, home charging only"
                           :                              "Home charging only";
        const tripsPerWeek = disp.tripsPerWeek;
        const tripMiles    = disp.tripMiles;
        const annualMiles  = Math.round(tripsPerWeek * 52 * tripMiles * 2);
        const annualKwhEv  = Math.round(annualMiles / disp.efficiency);
        return { label: ev?.label || `EV`, topology, topologyDesc, tripsPerWeek, tripMiles, annualMiles, annualKwhEv };
      });
      const hasCommuter = fleetSummary.some(e => e.tripsPerWeek > 0);

      setRunStatus(`EV impact — optimizing PV + battery for ${evList.length}-EV fleet...`);

      const erMinKwh = erDistanceMiles * 1.25 / EV_EFFICIENCY;
      const evOptResult = findOptimum({
        lat, lon,
        mountOptions:       evMountOptions.length > 0 ? evMountOptions : mountOptions,
        loadHourly,
        evScenario:         fleetScen,
        pvSizesKw:          evPvSizes.length > 0 ? evPvSizes : pvSizes,
        batteryOptions:     evBatteryOptions.length > 0 ? evBatteryOptions : batteryOptions,
        dcfcCostPerKwh,
        evseCost:           3500,   // per EV; findOptimum multiplies by nEvs automatically
        npvYears,
        discountRate:       discountRate / 100,
        maxEmergencyDcfc:   maxEmergencyDcfc,
        maxEnrouteDcfc:     maxEnrouteDcfc,
        erMinKwh,
        stressData,
        codePvKw,
        codeMinBatKwh,
      });
      await new Promise(resolve => setTimeout(resolve, 0));

      const noEvOpt = chosenPath === "battery_gen"
        ? result._genOptResult?.optimum
        : result.optimum;
      const evOpt   = evOptResult.optimum;
      const pathLabel = chosenPath === "battery_gen" ? "Battery + Generator" : "Battery-Only";

      // Generate a full dispatch trace for the EV-optimum configuration (for SOC charts)
      if (evOpt) {
        const optMnt = (evMountOptions.length > 0 ? evMountOptions : mountOptions).find(m => m.label === evOpt.mountLabel);
        const optBt  = (evBatteryOptions.length > 0 ? evBatteryOptions : batteryOptions).find(b => b.label === evOpt.batteryLabel);
        if (optMnt && optBt) {
          const sw    = extractWindow(optMnt.solarNormalized, evOptResult.spinupStartDoy, evOptResult.nHours);
          const solH  = sw.map(x => x * evOpt.pvKw);
          const tRes  = dispatch(solH, evOptResult._loadSw, optBt.kwh, optBt.kw, fleetScen, evOptResult._weather, dcfcCostPerKwh, true, erMinKwh);
          evOptResult._traceData = tRes.trace;
          evOptResult._batKwhCap = optBt.kwh;
        }
      }

      const impact = {
        fleetSummary,
        hasCommuter,
        hasEnrouteEv: evOptResult.hasEnrouteEv || false,
        evOptResult,
        nPassing:          evOptResult.nPassing,
        nTotal:            evOptResult.nTotal,
        nWwPass:           evOptResult.nWwPass,
        nWwPassEnRoute:    evOptResult.nWwPassEnRoute,
        bestWwPct:         evOptResult.bestWwPct,
        diagBestEnroute:   evOptResult.diagBestEnroute,
        diagBestEmergency: evOptResult.diagBestEmergency,
        diagEmergencyBreakdown: evOptResult.diagEmergencyBreakdown ?? null,
        noEvOpt,
        evOpt,
        pathLabel,
        baselineMountLabel: baselineMountLabel  || null,
        baselineMinPvKw:    baseline?.pvKw      || 0,
        baselineBatFamily:  baselineBatFamily   || null,
        baselineMinBatKwh:  baseline?.batteryKwh || 0,
        // Always available (even when no solution found) — used in diagnostic message
        effectiveEmergencyLimit: evOptResult.effectiveEmergencyLimit ?? maxEmergencyDcfc,
        effectiveEnrouteLimit:   evOptResult.effectiveEnrouteLimit   ?? maxEnrouteDcfc ?? 0,
        fleetEnrouteLimit:       evOptResult.fleetEnrouteLimit       ?? 0,
      };

      if (noEvOpt && evOpt) {
        impact.deltaPvKw      = Math.round((evOpt.pvKw       - noEvOpt.pvKw)       * 10) / 10;
        impact.deltaBatKwh    = Math.round((evOpt.batteryKwh - noEvOpt.batteryKwh) * 10) / 10;
        impact.deltaHwCost    = Math.round(evOpt.systemCost  - noEvOpt.systemCost);
        impact.deltaTotalCost = Math.round(evOpt.totalCost   - noEvOpt.totalCost);
        impact.annualDcfcTrips          = evOpt.annualDcfcTrips           || 0;
        impact.annualDcfcCost           = evOpt.annualDcfcCost            || 0;
        impact.annualEnrouteDcfcTrips   = evOpt.annualEnrouteDcfcTrips    || 0;
        impact.annualEnrouteDcfcCost    = evOpt.annualEnrouteDcfcCost     || 0;
        impact.annualEmergencyDcfcTrips = evOpt.annualEmergencyDcfcTrips  || 0;
        impact.annualEmergencyDcfcCost  = evOpt.annualEmergencyDcfcCost   || 0;
        impact.annualWorkChargeCost     = evOpt.annualWorkChargeCost       || 0;
        impact.hasEnrouteEv             = evOptResult.hasEnrouteEv         || false;
        impact.nonWwAnnualEnrouteDcfc   = evOpt.nonWwAnnualEnrouteDcfc    || 0;
        impact.nonWwAnnualEmergencyDcfc = evOpt.nonWwAnnualEmergencyDcfc  || 0;
        impact.effectiveEmergencyLimit  = evOptResult.effectiveEmergencyLimit || maxEmergencyDcfc;
        impact.effectiveEnrouteLimit    = evOptResult.effectiveEnrouteLimit  || maxEnrouteDcfc || 0;
        impact.fleetEnrouteLimit        = evOptResult.fleetEnrouteLimit      || 0;
      }

      setEvImpact(impact);   // single combined object, not an array
      setRunStatus("EV impact analysis complete.");
    } finally {
      setEvImpactRunning(false);
    }
  }, [result, evList, dcfcCostPerKwh, maxEmergencyDcfc, pvSizesStr, selectedBatteries,
      loadMode, uploadedLoad, annualKwh, daytimeShiftPct, stressData,
      lat, lon, npvYears, discountRate]);

  // ── Title 24 code compliance check ───────────────────────────────────────
  // Requires a completed Phase 1 run (uses _loadSw, _weather, spinupStartDoy, nHours).
  // 1. Computes code-minimum PV (Table 150.1-C) and battery (3× avg winter daily usage).
  // 2. Sweeps generator sizes at code-minimum hardware.
  // 3. Reports which generators survive the worst week AND stay within the hr/yr limit.
  const handleCodeComplianceRun = useCallback(async () => {
    if (!result || !lastMountSolarsRef.current) return;
    setCodeRunning(true);
    setCodeResult(null);
    try {
      // Recompute load profile (same logic as handleRunWithTrace)
      const loadHourly = loadMode === "upload" && uploadedLoad
        ? applyLoadShift(uploadedLoad, daytimeShiftPct)
        : applyLoadShift(syntheticLoad(annualKwh), daytimeShiftPct);

      // Code-minimum PV
      const czCoeffs   = TABLE_150_1_C[climateZone] || TABLE_150_1_C[10];
      const codePvKw   = Math.round(((cfa * czCoeffs.A) / 1000 + ndu * czCoeffs.B) * 100) / 100;

      // Code-minimum battery (3× critical load panel daily energy, user-entered)
      const codeMinBatKwh = Math.round(criticalLoadKwhPerDay * 3 * 10) / 10;

      // Smallest selected battery that meets the code-minimum kWh requirement
      const allBats = Object.values(BATTERY_LIBRARY)
        .filter(b => selectedBatteries.has(b.label))
        .map(b => ({ ...b, fixedCost: batteryCosts[b.label] ?? b.fixedCost }));
      const codeBat = allBats.filter(b => b.kwh >= codeMinBatKwh)
                             .sort((a, b) => a.kwh - b.kwh)[0]
                   || allBats.sort((a, b) => b.kwh - a.kwh)[0]; // fallback: largest available
      if (!codeBat) throw new Error("No battery options selected.");

      const genSizes = genSizesStr.split(",").map(s => parseFloat(s.trim())).filter(v => !isNaN(v) && v >= 10) // 10 kW minimum — only size with AHJ-acceptable soundproofing;

      // Sweep each enabled mount at code-minimum PV + code-minimum battery
      const mountResults = [];
      for (const mount of lastMountSolarsRef.current) {
        const solarSw      = extractWindow(mount.solarNormalized, result.spinupStartDoy, result.nHours);
        const solarH       = solarSw.map(x => x * codePvKw);
        const annualSolarH = mount.solarNormalized.map(x => x * codePvKw);

        // Compute worst-window start in the TMY 8760-h array for the emergency-hours exemption.
        const _wwStartH = ((result.spinupStartDoy - 1) + (result._cell.spinup_days || 0)) * 24 % 8760;
        const _wwLenH   = (result._cell.window_days || 10) * 24;
        const sweep = sweepGenerators(
          solarH, result._loadSw, codeBat.kwh, codeBat.kw, result._weather,
          genSizes, fuelCostPerHour, genLookaheadDays,
          annualSolarH, loadHourly, _wwStartH, _wwLenH
        );

        const resultsWithLimit = sweep.results.map(r => ({
          ...r,
          withinEmergencyLimit: (r.wwGenHours ?? r.simGenHours) <= emergencyGenHrLimit,
          withinHrLimit: r.annualGenHours <= genHrLimit,
        }));
        const passingWithinLimit = resultsWithLimit.filter(r => r.wwPass && r.withinEmergencyLimit && r.withinHrLimit);
        const minGenWithinLimit  = passingWithinLimit.length > 0
          ? passingWithinLimit.reduce((a, b) => a.genKw < b.genKw ? a : b)
          : null;

        mountResults.push({
          mountLabel:        mount.label,
          results:           resultsWithLimit,
          minGen:            sweep.minGen,
          minGenWithinLimit,
        });

        await new Promise(res => setTimeout(res, 10));
      }

      setCodeResult({
        codePvKw, codeMinBatKwh, codeBat,
        criticalLoadKwhPerDay,
        genHrLimit, emergencyGenHrLimit, czCoeffs, climateZone, cfa, ndu,
        mountResults,
      });
    } catch (e) {
      setCodeResult({ error: e.message });
    } finally {
      setCodeRunning(false);
    }
  }, [result, climateZone, cfa, ndu, genHrLimit, emergencyGenHrLimit, criticalLoadKwhPerDay,
      loadMode, uploadedLoad, annualKwh,
      daytimeShiftPct, selectedBatteries, genSizesStr, fuelCostPerHour, genLookaheadDays]);

  // ── Chart PNG export ──────────────────────────────────────────────────────

  // Export a single canvas with a white background
  function downloadSinglePanel(canvasRef, filename) {
    const src = canvasRef.current;
    if (!src) return;
    const out = document.createElement("canvas");
    out.width  = src.width;
    out.height = src.height;
    const ctx = out.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(src, 0, 0);
    const a = document.createElement("a");
    a.href = out.toDataURL("image/png");
    a.download = filename;
    a.click();
  }

  // Download plain-text report as a .txt file
  function downloadTextReport(filename, text) {
    const blob = new Blob([text], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
  }

  function downloadCsv(filename, content) {
    const blob = new Blob(["\uFEFF" + content], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Auto-export all sweep and trace data to CSV files after each run.
  // Triggered automatically — no button required.
  function triggerAutoExports(res, slug, hasEvs) {
    // 1. Battery-only sweep — all PV × battery combinations
    if (res.sweep?.length > 0) {
      const baseHdrs = ["mount","pvKw","batteryLabel","batteryKwh","wwPass","wwPct",
                        "wwUnservedKwh","pvCost","batteryCost","evseCost","totalCost","isOptimum"];
      const evHdrs   = hasEvs ? ["annualDcfcTrips","annualEmergencyDcfcTrips","annualEnrouteDcfcTrips","annualWorkChargeCost"] : [];
      const hdrs = [...baseHdrs, ...evHdrs];
      const annOpt = res.optimum || res._wwOnlyOptimum;
      const lines = [hdrs.join(",")];
      for (const r of res.sweep) {
        const isOpt = annOpt && r.mountLabel===annOpt.mountLabel && r.pvKw===annOpt.pvKw && r.batteryLabel===annOpt.batteryLabel ? 1 : 0;
        const base = [r.mountLabel, r.pvKw, r.batteryLabel, r.batteryKwh,
                      r.wwPass?1:0, r.wwPct, r.wwUnservedKwh,
                      r.pvCost, r.batteryCost, r.evseCost||0, r.totalCost, isOpt];
        const evCols = hasEvs ? [r.annualDcfcTrips??0, r.annualEmergencyDcfcTrips??0,
                                  r.annualEnrouteDcfcTrips??0, r.annualWorkChargeCost??0] : [];
        lines.push([...base, ...evCols].join(","));
      }
      downloadCsv(`battery_sweep_${slug}.csv`, lines.join("\n"));
    }
    // 2. Generator optimizer — all mount × PV × battery × gen combinations
    const diagRows = res._genOptResult?.diagRows;
    if (diagRows?.length > 0) {
      const hdrs = ["mount","pvKw","batLabel","batKwh","genKw","batAlreadyPasses",
                    "wwPass","wwGenHours","annGenHours","annFuelCostPerYr",
                    "pvCost","batCost","genCap","fuelNpv","totalCost","rejection","isOptimum"];
      const lines = [hdrs.join(",")];
      for (const r of diagRows) {
        lines.push(hdrs.map(k => { const v = r[k]; if (v == null) return ""; const s = String(v); return s.includes(",") ? `"${s}"` : s; }).join(","));
      }
      setTimeout(() => downloadCsv(`generator_sweep_${slug}.csv`, lines.join("\n")), 300);
    }
    // 3. Annual battery trace
    const batTr = res._annualTrace;
    if (batTr?.bat) {
      setTimeout(() => {
        const wth = buildAnnualWeather(batTr.bat.length);
        const lines = ["hour,month,day,hourOfDay,solarKw,loadKw,batKwh,batSocPct,unservedKw"];
        for (let h = 0; h < batTr.bat.length; h++) {
          lines.push([h, wth[h].month, wth[h].day, wth[h].hourOfDay,
                      (batTr.sol[h]||0).toFixed(3), (batTr.ld[h]||0).toFixed(3),
                      batTr.bat[h].toFixed(3), (batTr.bat[h]/batTr.batKwh*100).toFixed(1),
                      (batTr.unserved[h]||0).toFixed(3)].join(","));
        }
        downloadCsv(`annual_bat_trace_${slug}.csv`, lines.join("\n"));
      }, 600);
    }
    // 4. Annual generator trace
    const genTr = res._genOptResult?.annualTrace;
    if (genTr?.bat) {
      setTimeout(() => {
        const wth = buildAnnualWeather(genTr.bat.length);
        const lines = ["hour,month,day,hourOfDay,solarKw,loadKw,batKwh,batSocPct,genRunning,genKwRated"];
        for (let h = 0; h < genTr.bat.length; h++) {
          lines.push([h, wth[h].month, wth[h].day, wth[h].hourOfDay,
                      (genTr.sol[h]||0).toFixed(3), (genTr.ld[h]||0).toFixed(3),
                      genTr.bat[h].toFixed(3), (genTr.bat[h]/genTr.batKwh*100).toFixed(1),
                      genTr.gen[h]||0, genTr.genKw||0].join(","));
        }
        downloadCsv(`annual_gen_trace_${slug}.csv`, lines.join("\n"));
      }, 900);
    }
    // 5. Summary CSV — all input parameters + results reference section
    setTimeout(() => {
      const inputs = {
        siteName, lat, lon, geoAddress, mounts, pvSizesStr,
        loadMode, annualKwh, daytimeShiftPct,
        uploadedLoad: (loadMode === "upload" && uploadedLoad) ? uploadedLoad : null,
        uploadedFileName: (loadMode === "upload" && uploadedLoad) ? uploadedFileName : "",
        selectedBatteries: Array.from(selectedBatteries),
        batteryCosts,
        evList, dcfcCostPerKwh, evseCost, maxEmergencyDcfc, maxEnrouteDcfc,
        npvYears, discountRate,
        genSizesStr, fuelCostPerHour, genLookaheadDays, genInstalledCost, genHrLimit, emergencyGenHrLimit,
        climateZone, cfa, ndu, criticalLoadKwhPerDay,
      };
      downloadCsv(`summary_${slug}.csv`, buildMod06SummaryCSV(inputs, res));
      const now = new Date();
      const pad = n => String(n).padStart(2, "0");
      setLastSavedTime(`${pad(now.getHours())}:${pad(now.getMinutes())}`);
    }, 1200);
  }

  // Composite multiple panel canvases vertically into one PNG with white background
  function downloadMultiPanel(canvasRefs, filename) {
    const canvases = canvasRefs.map(r => r.current).filter(Boolean);
    if (canvases.length === 0) return;
    const w = canvases[0].width;
    const totalH = canvases.reduce((s, c) => s + c.height, 0);
    const out = document.createElement("canvas");
    out.width  = w;
    out.height = totalH;
    const ctx = out.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, totalH);
    let y = 0;
    for (const c of canvases) { ctx.drawImage(c, 0, y); y += c.height; }
    const a = document.createElement("a");
    a.href = out.toDataURL("image/png");
    a.download = filename;
    a.click();
  }

  // ── Run sweep ─────────────────────────────────────────────────────────────

  const lastMountSolarsRef = useRef(null);

  const handleRunWithTrace = useCallback(async () => {
    setRunning(true);
    setRunError("");
    setResult(null);
    setRunStatus("Fetching PVWatts solar data...");

    try {
      const pvSizes = pvSizesStr.split(",").map(s => parseFloat(s.trim())).filter(v => !isNaN(v) && v > 0);
      if (pvSizes.length === 0) throw new Error("Enter at least one PV size.");
      if (mounts.length === 0) throw new Error("Add at least one mount type.");
      if (selectedBatteries.size === 0) throw new Error("Select at least one battery.");
      if (!apiKey.trim()) throw new Error("Enter a PVWatts API key.");

      const mountOptions = [];
      for (let idx = 0; idx < mounts.length; idx++) {
        const m = mounts[idx];
        setRunStatus(`Fetching PVWatts for mount ${idx + 1}/${mounts.length}: ${m.label}...`);
        const solar = await fetchPVWatts(lat, lon, apiKey.trim(), m.arrayType, m.tilt, m.azimuth, m.losses, m.dcAcRatio);
        mountOptions.push({
          label:           m.label,
          solarNormalized: solar,
          pvCostPerKw:     m.pvCostPerKw,
        });
      }
      lastMountSolarsRef.current = mountOptions;

      const batteryOptions = Object.entries(BATTERY_LIBRARY)
        .filter(([k]) => selectedBatteries.has(k))
        .map(([k, v]) => ({ ...v, fixedCost: batteryCosts[k] ?? v.fixedCost }));

      if (loadMode === "upload" && !uploadedLoad) {
        throw new Error(
          "Load mode is set to 'Upload Green Button CSV' but no file has been successfully parsed. " +
          "Upload a valid Green Button CSV, or switch to 'Use synthetic profile'."
        );
      }
      const loadHourly = applyLoadShift(
        loadMode === "upload" ? uploadedLoad : syntheticLoad(annualKwh),
        daytimeShiftPct
      );

      // ── Generator sizes (computed early — needed for code-min battery calculation) ──
      const genSizes = genSizesStr.split(",").map(s => parseFloat(s.trim())).filter(v => !isNaN(v) && v >= 10) // 10 kW minimum — only size with AHJ-acceptable soundproofing;
      const minGenKw = genSizes.length > 0 ? Math.min(...genSizes) : 10;

      // ── Title 24 §150.1-C code minimums ───────────────────────────────────
      const czC      = TABLE_150_1_C[climateZone] || TABLE_150_1_C[10];
      const codePvKw = Math.round(((cfa * czC.A) / 1000 + ndu * czC.B) * 100) / 100;

      // Battery-ONLY path: battery alone must sustain critical load for 3 days.
      //   code min = 3 × criticalLoadKwhPerDay  (no generator credit)
      const codeMinBatKwh = Math.round(criticalLoadKwhPerDay * 3 * 10) / 10;

      // Battery+GENERATOR path: generator (≤ genHrLimit hrs) covers what battery cannot.
      //   code min = max(0, criticalLoad×3 − minGenKw×genHrLimit) / (1−BATTERY_MIN_SOC)
      //   With 10 kW gen at 52 hr: max(0, 45 − 520)/0.9 → 0 kWh — any battery qualifies.
      const codeMinBatKwhWithGen = Math.round(
        criterion1MinBatKwh(criticalLoadKwhPerDay, minGenKw, genHrLimit) * 10) / 10;

      // Shortfall: can the battery-only path meet code minimum?
      const maxSelectedBatKwh = batteryOptions.length > 0
        ? Math.max(...batteryOptions.map(b => b.kwh)) : 0;
      const codeBatShortfall = Math.max(0, Math.round((codeMinBatKwh - maxSelectedBatKwh) * 10) / 10);

      // Snapshot EVs at sweep time.  V2G EVs factor into criteria 2 & 3 (worst-window + annual
      // coverage).  Criterion 1 (3-day no-solar) uses stationary battery only — enforced by
      // codeMinBatKwh which is computed from building load with no EV credit (see above).
      setSweepEvList(evList);
      const sweepFleetScen = evList.map(ev => evConfigToDispatch(ev));
      const hasV2gAtSweep  = sweepFleetScen.some(ev => ev.canV2G);
      const erMinKwhSweep  = evList.length > 0 ? erDistanceMiles * 1.25 / EV_EFFICIENCY : 0;

      // V2G effective kWh available as supplemental storage (approximation for annual check).
      // Per V2G EV: usable capacity above min SOC, minus half-range DCFC reserve.
      const v2gEffKwh = sweepFleetScen
        .filter(ev => ev.canV2G)
        .reduce((sum, ev) => {
          const halfRange = ev.tripMiles > 0 ? ev.tripMiles / (2 * ev.efficiency) : 0;
          return sum + Math.max(0, ev.kwh * (1 - BATTERY_MIN_SOC) - halfRange);
        }, 0);

      // Phase 1: battery-only sweep (EVs included; V2G contributes to criteria 2 & 3)
      const totalCombos = mountOptions.length * pvSizes.length * batteryOptions.length;
      setRunStatus(`Phase 1 — battery-only sweep (code min: PV ≥ ${codePvKw} kW, bat ≥ ${codeMinBatKwh} kWh; generator path bat ≥ ${codeMinBatKwhWithGen} kWh)${hasV2gAtSweep ? " — V2G EVs included" : ""}...`);
      await new Promise(resolve => setTimeout(resolve, 50));

      const params = {
        lat, lon,
        mountOptions,
        loadHourly,
        evScenario:       sweepFleetScen,   // V2G + non-V2G EVs — criteria 2 & 3 benefit from V2G
        pvSizesKw:        pvSizes,
        batteryOptions,
        dcfcCostPerKwh:   evList.length > 0 ? dcfcCostPerKwh : 0,
        evseCost:         evList.length > 0 ? 3500 : 0,
        npvYears,
        discountRate:     discountRate / 100,
        maxEmergencyDcfc: evList.length > 0 ? maxEmergencyDcfc : 0,
        maxEnrouteDcfc:   evList.length > 0 ? maxEnrouteDcfc : undefined,
        erMinKwh:         erMinKwhSweep,
        stressData,
        codePvKw,
        codeMinBatKwh,    // criterion 1 floor: stationary battery only, no EV credit
      };

      const res = findOptimum(params);

      // ── Annual coverage check is now integrated into findOptimum (v0.4.116) ──────
      // res.optimum already satisfies all 3 criteria (WW pass + annual coverage + DCFC).
      // res.wwOnlyOptimum is the cheapest WW-passing config for Phase 2a fallback.
      res._wwOnlyOptimum     = res.wwOnlyOptimum    || null;
      // res._wwOnlyAnnualCheck is already set by findOptimum
      res._v2gEffKwh   = Math.round(v2gEffKwh);
      res._sweepHasV2g = hasV2gAtSweep;

      // Phase 2a base: annually-valid optimum if it exists, else WW-only optimum.
      const phase2aBase = res.optimum || res._wwOnlyOptimum;

      // ── Stress-window trace + annual trace ────────────────────────────────────
      // Generated for the annually-valid optimum when it exists; falls back to the
      // WW-only optimum so the annual chart always renders (with red unserved bars
      // showing why annual coverage fails when no annually-valid config was found).
      const optForTrace = res.optimum || res._wwOnlyOptimum;
      if (optForTrace) {
        setRunStatus("Generating trace for battery-only optimum...");
        await new Promise(resolve => setTimeout(resolve, 10));

        const opt = optForTrace;
        const optMount = mountOptions.find(m => m.label === opt.mountLabel);
        const optBat   = batteryOptions.find(b => b.label === opt.batteryLabel);

        if (optMount && optBat) {
          const solarSw = extractWindow(optMount.solarNormalized, res.spinupStartDoy, res.nHours);
          const solarH  = solarSw.map(x => x * opt.pvKw);
          // Use sweep EVs in trace so the chart is consistent with how the battery was sized.
          const traceResult = dispatch(solarH, res._loadSw, optBat.kwh, optBat.kw,
            sweepFleetScen, res._weather, dcfcCostPerKwh, true, erMinKwhSweep);
          res._traceData = traceResult.trace;
          res._optSolarH = solarH;

          // Annual trace — uses the same fleet as the Criterion 2 annual check
          // (sweepFleetScen) so the chart is consistent with what was optimized.
          // The stationary battery SOC trace reflects actual dispatch with EVs helping;
          // it will NOT show false depletion during hours the EV covered.
          if (loadHourly) {
            const annSolar8760 = optMount.solarNormalized.map(x => x * opt.pvKw);
            const annWeather8760 = buildAnnualWeather(annSolar8760.length);
            const batAnnTr = simulatePeriod(
              annSolar8760, loadHourly, optBat.kwh, optBat.kw, 0, sweepFleetScen, annWeather8760,
              { initialSoc: 1.0, returnTrace: true }
            );
            // Sort EV fleet ascending by tripsPerWeek so the stack order is:
            // least-used EV at bottom → ... → stationary battery on top.
            const evOrder = sweepFleetScen
              .map((ev, i) => ({ i, trips: ev.tripsPerWeek || 0, kwh: ev.kwh,
                                 label: sweepEvList[i]?.label || `EV ${i + 1}` }))
              .sort((a, b) => a.trips - b.trips);
            res._annualTrace = {
              bat:              batAnnTr.traceBat,
              unserved:         batAnnTr.traceUnserved,
              curtailed:        batAnnTr.traceCurtailed,
              sol:              new Float32Array(annSolar8760),
              ld:               new Float32Array(loadHourly),
              batKwh:           optBat.kwh,
              annUnservedKwh:   batAnnTr.unservedKwh,
              annUnservedHours: batAnnTr.unservedHours,
              // Ordered EV traces for stacked SOC chart (bottom = least-used)
              evTraces:     evOrder.map(e => batAnnTr.traceEvE?.[e.i]   || null),
              evAwayTraces: evOrder.map(e => batAnnTr.traceEvAway?.[e.i] || null),
              evKwh:        evOrder.map(e => e.kwh),
              evLabels:     evOrder.map(e => e.label),
              evTrips:      evOrder.map(e => e.trips),
              enrouteDcfc:   batAnnTr.traceEnrouteDcfc,
              emergencyDcfc: batAnnTr.traceEmergencyDcfc,
            };
          }
        }
      }

      // Phase 2a: generator sizing sweep — uses phase2aBase PV+battery as fixed point.
      // Runs regardless of whether battery-only has annual coverage; the generator
      // supplements whatever the battery alone cannot cover.
      if (phase2aBase) {
        setRunStatus("Phase 2a — generator sizing sweep for battery-only optimum...");
        await new Promise(resolve => setTimeout(resolve, 10));

        const opt2a     = phase2aBase;
        const opt2aMount = mountOptions.find(m => m.label === opt2a.mountLabel);
        const opt2aBat   = batteryOptions.find(b => b.label === opt2a.batteryLabel);

        if (opt2aMount && opt2aBat) {
          const solar2aSw = extractWindow(opt2aMount.solarNormalized, res.spinupStartDoy, res.nHours);
          const solar2aH  = solar2aSw.map(x => x * opt2a.pvKw);
          const noEvLoad = res._loadSw;
          const annualSolar2a = opt2aMount.solarNormalized.map(x => x * opt2a.pvKw);
          const _wwStartH1 = ((res.spinupStartDoy - 1) + (res._cell.spinup_days || 0)) * 24 % 8760;
          const _wwLenH1   = (res._cell.window_days || 10) * 24;
          const genSweep1 = sweepGenerators(solar2aH, noEvLoad, opt2aBat.kwh, opt2aBat.kw, res._weather, genSizes, fuelCostPerHour, genLookaheadDays, annualSolar2a, loadHourly, _wwStartH1, _wwLenH1, sweepFleetScen, erMinKwhSweep);
          res._genSweep1 = genSweep1;

          // Trace for optimum battery — use min-passing gen; if none pass, use smallest so chart renders
          const traceEntry1 = genSweep1.minGen || (genSweep1.results.length > 0 ? genSweep1.results[0] : null);
          if (traceEntry1) {
            const gtrace1 = dispatchGenerator(solar2aH, noEvLoad, opt2aBat.kwh, opt2aBat.kw, traceEntry1.genKw, res._weather, genLookaheadDays, fuelCostPerHour, sweepFleetScen, erMinKwhSweep);
            res._genTrace1 = gtrace1.trace;
            res._genTrace1Kw = traceEntry1.genKw;
          }
        }
      }

      // Phase 2b: joint PV × battery × generator sweep (4-way, finds true optimum with generator).
      // Always runs — generator path is independent of battery-only annual coverage.
      {
        setRunStatus("Phase 2b — joint PV + battery + generator optimization...");
        await new Promise(resolve => setTimeout(resolve, 10));
        const genOptResult = findOptimumGenerator({
            mountOptions,
            pvSizesKw:      pvSizes,
            batteryOptions,
            genSizesKw:     genSizes,
            genInstalledCost,
            loadSw:         res._loadSw,
            loadAnnual:     loadHourly,
            weather:        res._weather,
            cell:           res._cell,
            spinupDoy:      res.spinupStartDoy,
            fuelCostPerKwHr: fuelCostPerHour,
            lookaheadDays:  genLookaheadDays,
            npvYears,
            discountRate:   discountRate / 100,
            codePvKw,
            codeMinBatKwh: codeMinBatKwhWithGen,  // generator covers part of 3-day req → lower battery floor
            genHrLimit,
            emergencyGenHrLimit,
            criticalLoadKwhPerDay,
            evScenario:     sweepFleetScen,
            erMinKwh:       erMinKwhSweep,
          });
          res._genOptResult = genOptResult;

          // Annual trace for winner — powers the full-year dispatch chart.
          // Always use the real genKw (never 0) so the chart accurately shows when the
          // generator fires in a typical year. batAlreadyPasses only means the stress window
          // is handled by battery alone; unserved load can still occur on other nights.
          const winOpt = genOptResult.optimum;
          if (winOpt && loadHourly) {
            const winMount = mountOptions.find(m => m.label === winOpt.mountLabel);
            if (winMount) {
              const winSolar = winMount.solarNormalized.map(x => x * winOpt.pvKw);
              const _wwSA = ((res.spinupStartDoy - 1) + (res._cell.spinup_days || 0)) * 24 % 8760;
              const _wwLA = (res._cell.window_days || 10) * 24;
              const annTr = countAnnualGenHours(
                winSolar, loadHourly, winOpt.batteryKwh, winOpt.batteryKw, winOpt.genKw,
                fuelCostPerHour, _wwSA, _wwLA, genLookaheadDays, true, sweepFleetScen, erMinKwhSweep
              );
              // Sort EV fleet ascending by tripsPerWeek — same order as battery-only trace
              const genEvOrder = sweepFleetScen
                .map((ev, i) => ({ i, trips: ev.tripsPerWeek || 0, kwh: ev.kwh,
                                   label: sweepEvList[i]?.label || `EV ${i + 1}` }))
                .sort((a, b) => a.trips - b.trips);
              genOptResult.annualTrace = {
                bat:       annTr.traceBat,
                gen:       annTr.traceGen,
                unserved:  annTr.traceUnserved,
                curtailed: annTr.traceCurtailed,
                sol:       new Float32Array(winSolar),
                ld:        new Float32Array(loadHourly),
                batKwh:    winOpt.batteryKwh,
                genKw:     winOpt.genKw,
                evTraces:     genEvOrder.map(e => annTr.traceEvE?.[e.i]   || null),
                evAwayTraces: genEvOrder.map(e => annTr.traceEvAway?.[e.i] || null),
                evKwh:        genEvOrder.map(e => e.kwh),
                evLabels:     genEvOrder.map(e => e.label),
                evTrips:      genEvOrder.map(e => e.trips),
                enrouteDcfc:   annTr.traceEnrouteDcfc,
                emergencyDcfc: annTr.traceEmergencyDcfc,
              };
            }
          }
      }   // end Phase 2b bare block

      // Attach code compliance minimums for display
      res._codePvKw                = codePvKw;
      res._codeMinBatKwh           = codeMinBatKwh;           // battery-only path minimum
      res._codeMinBatKwhWithGen    = codeMinBatKwhWithGen;    // battery+gen path minimum (lower)
      res._criticalLoadKwhPerDay   = criticalLoadKwhPerDay;
      res._minGenKw                = minGenKw;
      res._genHrLimit              = genHrLimit;
      res._emergencyGenHrLimit     = emergencyGenHrLimit;
      res._codeBatShortfall        = codeBatShortfall;
      res._maxSelectedBatKwh       = maxSelectedBatKwh;

      setResult(res);
      setEvImpact(null);   // reset Phase 2 results whenever Phase 1 reruns
      setChosenPath(null); // reset path selection whenever Phase 1 reruns
      setPinnedEvRow(null);  // reset detail chart pin so it defaults to Dec 17-18 of new run
      setPinnedGenRow(null);
      const genNote = res._genOptResult?.optimum ? ` Generator optimum: ${res._genOptResult.optimum.pvKw} kW PV + ${res._genOptResult.optimum.genKw} kW gen.` : "";
      const annualNote = res._wwOnlyOptimum && !res.optimum
        ? ` ⚠ No battery-only config covers full year — generator required.`
        : res._wwOnlyOptimum && res.optimum && res._wwOnlyOptimum !== res.optimum
          ? ` (Annual check upgraded battery-only optimum.)`
          : "";
      setRunStatus(`Done. Battery-only: ${res.nPassing} of ${res.nTotal} pass all criteria (${res.nWwOnly} pass WW).${annualNote}${genNote}`);

      // Auto-export all sweep and trace data to CSV (no button required).
      // The 5th export (summary CSV) also sets lastSavedTime.
      const slug = (siteName || "site").replace(/\s+/g, "_");
      triggerAutoExports(res, slug, sweepFleetScen.length > 0);

    } catch (err) {
      setRunError(err.message);
      setRunStatus("");
    } finally {
      setRunning(false);
    }
  }, [lat, lon, apiKey, mounts, pvSizesStr, selectedBatteries, batteryCosts,
      loadMode, uploadedLoad, uploadedFileName, annualKwh, daytimeShiftPct, evList, dcfcCostPerKwh, evseCost,
      maxEmergencyDcfc, npvYears, discountRate, stressData,
      genSizesStr, fuelCostPerHour, genLookaheadDays, genInstalledCost, genHrLimit, emergencyGenHrLimit,
      climateZone, cfa, ndu, criticalLoadKwhPerDay,
      siteName, geoAddress]);

  // ── Chart: EV dispatch — 3-panel stacked ─────────────────────────────────

  // Shared white-background plugin for all panels
  const WHITE_BG = {
    id: "whiteBg",
    beforeDraw(chart) {
      const { ctx, width, height } = chart;
      ctx.save(); ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, width, height); ctx.restore();
    },
  };

  useEffect(() => {
    if (!result || !result.optimum || !result._traceData) return;
    if (!evP1Ref.current || !evP2Ref.current) return;

    const traceData    = result._traceData;
    const spinupHours  = result._cell.spinup_days * 24;
    const wwHours      = result._cell.window_days * 24;
    const totalH       = traceData.length;
    const displayStart = Math.max(0, spinupHours - 48);
    const slice        = traceData.slice(displayStart, totalH);
    evSliceRef.current = slice; // for onContextMenu position lookup
    // Worst-window bounds (red tint) — only the 10-day WW, not post-window
    const wwMaskStart  = spinupHours - displayStart;
    const wwMaskEnd    = spinupHours + wwHours - displayStart;
    // Post-window bounds (light green tint) — present only in v2.2+ JSON
    const pwMaskStart  = wwMaskEnd;
    const pwMaskEnd    = totalH - displayStart;
    const hasPostWw    = (result._cell.post_window_days || 0) > 0;

    const labels  = slice.map(r => fmtDateHr(r.month, r.day, r.hourOfDay));
    const solarDs = slice.map(r => r.solarKw);
    const loadDs  = slice.map(r => r.loadKw);
    const batDs   = slice.map(r => r.batKwhEnd);
    const evDs    = slice[0] && slice[0].evKwhEnd.length > 0 ? slice.map(r => r.evKwhEnd[0]) : null;
    const dcfcIdx = slice.reduce((a, r, i) => { if (r.dcfcEvent) a.push(i); return a; }, []);
    const curtDs     = slice.map(r => r.curtailed || 0);
    const hasCurt    = curtDs.some(v => v > 0.01);
    const solarBotDs = solarDs.map((s, i) => Math.max(0, s - curtDs[i]));

    const batKwhCap  = result.optimum.batteryKwh;
    const minSocLine = new Array(slice.length).fill(batKwhCap * BATTERY_MIN_SOC);

    // Shared plugins
    function makeWwPlugin(id) {
      return {
        id,
        beforeDraw(chart) {
          const { ctx, chartArea, scales } = chart;
          if (!chartArea) return;
          ctx.save();
          // Red tint: worst-window (10-day critical period) only; post-window is white like spinup
          const x0 = scales.x.getPixelForValue(Math.max(0, wwMaskStart));
          const x1 = scales.x.getPixelForValue(Math.min(slice.length - 1, wwMaskEnd - 1));
          ctx.fillStyle = "rgba(192,57,43,0.07)";
          ctx.fillRect(x0, chartArea.top, x1 - x0, chartArea.bottom - chartArea.top);
          ctx.restore();
        },
      };
    }
    const dcfcPlugin = {
      id: "dcfcLines",
      afterDraw(chart) {
        const { ctx, chartArea, scales } = chart;
        if (!chartArea) return;
        ctx.save(); ctx.strokeStyle = "rgba(192,57,43,0.65)"; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
        for (const i of dcfcIdx) {
          const x = scales.x.getPixelForValue(i);
          ctx.beginPath(); ctx.moveTo(x, chartArea.top); ctx.lineTo(x, chartArea.bottom); ctx.stroke();
        }
        ctx.restore();
      },
    };

    // Force all y-axes to the same width so all panels' x-axes are pixel-aligned.
    // yFit: left axis (kW or kWh). yFit2: right axis (%SOC). Y2_W: right-axis reserved width.
    // Panels without a right axis use layout.padding.right = Y2_W to match width.
    const Y2_W = 46;
    const yFit  = scale => { scale.width = 62; };
    const yFit2 = scale => { scale.width = Y2_W; };

    // Helper: right-axis %SOC calibrated so deviceKwh corresponds to 100% on the right axis
    // and kwhMax (left axis top) corresponds to kwhMax/deviceKwh×100% on the right.
    // Only ticks at 0/25/50/75/100% are shown; values above 100% are silently omitted.
    const makeSocAxisY2 = (deviceKwh, kwhMax) => {
      const socMax = deviceKwh > 0 ? kwhMax / deviceKwh * 100 : 100;
      return {
        position: "right",
        title: { display: true, text: "% SOC", font: { size: 9 } },
        min: 0, max: socMax,
        grid: { drawOnChartArea: false },
        afterFit: yFit2,
        afterBuildTicks(axis) {
          axis.ticks = [0, 25, 50, 75, 100]
            .filter(v => v <= socMax + 0.5)
            .map(v => ({ value: v }));
        },
        ticks: { callback: v => (v <= 100.5) ? `${Math.round(v)}%` : null, font: { size: 9 } },
      };
    };

    const commonOpts = (showX) => ({
      animation: false,
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: buildLegend([]),
        tooltip: { bodyFont: { size: 10 }, titleFont: { size: 10 } },
      },
      scales: {
        x: {
          display: showX,
          ticks: { maxTicksLimit: 14, font: { size: 9 }, maxRotation: 30 },
          grid: { color: "#f0f0f0", tickLength: 6, tickColor: "#aaa" },
        },
      },
    });

    // Generator on/off from no-EV trace (same time window — used as overlay background)
    const genTrace = result._genTrace1 ? result._genTrace1.slice(displayStart, totalH) : null;
    const genRunArr = genTrace ? genTrace.map(r => r.genRunning) : null;

    function makeGenRunPlugin(id, runArr) {
      return {
        id,
        beforeDraw(chart) {
          const { ctx, chartArea, scales } = chart;
          if (!chartArea || !runArr) return;
          ctx.save(); ctx.fillStyle = "rgba(192,100,0,0.13)";
          for (let i = 0; i < runArr.length - 1; i++) {
            if (!runArr[i]) continue;
            const x0 = scales.x.getPixelForValue(i);
            const x1 = scales.x.getPixelForValue(i + 1);
            ctx.fillRect(x0, chartArea.top, x1 - x0, chartArea.bottom - chartArea.top);
          }
          ctx.restore();
        },
      };
    }

    // Crosshair plugin (synchronized line across both EV panels + side-panel values)
    function makeEvCrosshair(id) {
      return {
        id,
        afterDraw(chart) {
          const idx = evCrosshairIdx.current;
          if (idx < 0 || idx >= labels.length) return;
          const { ctx, chartArea, scales } = chart;
          if (!chartArea || !scales.x) return;
          const x = scales.x.getPixelForValue(idx);
          ctx.save(); ctx.strokeStyle = "rgba(40,40,40,0.45)"; ctx.lineWidth = 1; ctx.setLineDash([]);
          ctx.beginPath(); ctx.moveTo(x, chartArea.top); ctx.lineTo(x, chartArea.bottom); ctx.stroke();
          ctx.restore();
        },
        afterEvent(chart, args) {
          const { event } = args;
          if (event.type === "mouseout") {
            if (evCrosshairIdx.current !== -1) {
              evCrosshairIdx.current = -1; evHoverRowRef.current = null; setEvHoverRow(null);
              [evP1Inst, evP2Inst].forEach(r => { if (r.current) r.current.update("none"); });
            }
            return;
          }
          if (event.type !== "mousemove" || !chart.scales.x) return;
          const idx = Math.max(0, Math.min(Math.round(chart.scales.x.getValueForPixel(event.x)), labels.length - 1));
          if (idx === evCrosshairIdx.current) return;
          evCrosshairIdx.current = idx; evHoverRowRef.current = slice[idx]; setEvHoverRow(slice[idx]);
          [evP1Inst, evP2Inst].forEach(r => { if (r.current) r.current.update("none"); });
        },
      };
    }

    // Destroy old instances
    [evP1Inst, evP2Inst, evP3Inst].forEach(ref => { if (ref.current) { ref.current.destroy(); ref.current = null; } });

    // Curtailment overlay plugin: fills only the TIPS of the solar area that could not be
    // sent to storage — i.e., from (solar − curtailed) up to solar at each hour.
    // Uses smooth bezier paths (via drawCurtainBezier) so the fill follows the rendered curves.
    const curtailPlugin = {
      id: "curtailFill",
      afterDatasetsDraw(chart) {
        if (!hasCurt) return;
        const { ctx, scales } = chart;
        if (!scales.x || !scales.y) return;
        const topMeta = chart.getDatasetMeta(0); // solar
        const botMeta = chart.getDatasetMeta(2); // solar − curtailed (hidden dataset)
        if (!topMeta?.data.length || !botMeta?.data.length) return;
        ctx.save();
        ctx.fillStyle = "rgba(140,140,0,0.60)";
        drawCurtainBezier(ctx, topMeta, botMeta, curtDs);
        ctx.restore();
      },
    };

    // Panel 1: Solar + Load (x-axis hidden)
    // layout.padding.right matches Y2_W so this panel's plot area aligns with Panel 2's.
    {
      const opts = commonOpts(false);
      opts.scales.y = { title: { display: true, text: "Power (kW)", font: { size: 10 } }, beginAtZero: true, grid: { color: "#f0f0f0" }, afterFit: yFit };
      opts.layout = { padding: { right: Y2_W } };
      const LEG_CURT = { text: "Curtailed solar", fillStyle: "rgba(140,140,0,0.45)", strokeStyle: "rgba(0,0,0,0)", lineWidth: 0, lineDash: [], hidden: false, datasetIndex: null, pointStyle: "rect" };
      const p1Extras = [LEG_WW];
      if (hasCurt) p1Extras.push(LEG_CURT);
      if (dcfcIdx.length > 0) p1Extras.push(LEG_DCFC);
      opts.plugins.legend = buildLegend(p1Extras);
      opts.plugins.tooltip = { enabled: false };
      evP1Inst.current = new Chart(evP1Ref.current, {
        type: "line",
        data: { labels, datasets: [
          { label: "Solar kW",  data: solarDs,    borderColor: "#d48000", backgroundColor: "rgba(244,160,32,0.35)", fill: true,  tension: 0.15, pointRadius: 0, borderWidth: 1.5 },
          { label: "Load kW",   data: loadDs,     borderColor: "#204090", backgroundColor: "rgba(48,96,192,0.15)",  fill: true,  tension: 0.15, pointRadius: 0, borderWidth: 1.5 },
          { label: "", data: solarBotDs, borderColor: "transparent", backgroundColor: "transparent", fill: false, tension: 0.15, pointRadius: 0, borderWidth: 0, _curtBot: true },
          { label: "Emergency DCFC", data: slice.map(r => r.emergencyDcfcEvent ? r.loadKw * 0.5 : null), borderColor: "#c0392b", backgroundColor: "#c0392b", showLine: false, pointRadius: slice.map(r => r.emergencyDcfcEvent ? 7 : 0), pointStyle: "triangle", pointHoverRadius: 9, borderWidth: 0, order: 0 },
        ]},
        options: opts,
        plugins: [WHITE_BG, makeWwPlugin("ww1"), dcfcPlugin, curtailPlugin, makeEvCrosshair("ch_ev1")],
      });
    }

    // Panel 2: Battery SOC + EV SOC — kWh on left axis, %SOC on right axis.
    // Common kWh scale across all devices; right axis calibrated per device.
    // Stationary battery only: batKwhEnd = batE (not summed with EV).
    {
      const ev0Kwh = evList[0]?.kwh || 1;
      const allKwhCaps = [batKwhCap, ...evList.map(ev => ev.kwh || 1)];
      const commonKwhMax = Math.max(...allKwhCaps, 1) * 1.05;
      const batMinKwh = batKwhCap * BATTERY_MIN_SOC;
      const opts = commonOpts(true); // bottom panel — show x-axis
      opts.scales.y = {
        title: { display: true, text: "kWh", font: { size: 10 } },
        beginAtZero: true, min: 0, max: commonKwhMax, grid: { color: "#f0f0f0" }, afterFit: yFit,
      };
      opts.scales.y2 = makeSocAxisY2(batKwhCap, commonKwhMax);
      const batDatasets = [
        { label: `Battery (${batKwhCap} kWh)`, data: batDs, borderColor: "#107040", backgroundColor: "rgba(32,160,96,0.35)", fill: true, tension: 0.15, pointRadius: 0, borderWidth: 1.5 },
        { label: `Bat min (${(BATTERY_MIN_SOC*100).toFixed(0)}% = ${batMinKwh.toFixed(1)} kWh)`, data: new Array(slice.length).fill(batMinKwh), borderColor: "#107040", borderDash: [4, 3], backgroundColor: "transparent", fill: false, pointRadius: 0, borderWidth: 1 },
      ];
      if (evDs) {
        batDatasets.push({
          label: `EV (${ev0Kwh} kWh)`, data: evDs,
          borderColor: "#7b2d8b", backgroundColor: "rgba(123,45,139,0.15)", fill: true, tension: 0.15, pointRadius: 0, borderWidth: 1.5,
        });
        if (evList.length > 0) {
          const evMinKwh = erDistanceMiles * 1.25 / (evList[0]?.evEfficiency ?? EV_EFFICIENCY);
          batDatasets.push({
            label: `EV min (${evMinKwh.toFixed(1)} kWh)`,
            data: new Array(slice.length).fill(evMinKwh),
            borderColor: "#7b2d8b", borderDash: [4, 3], backgroundColor: "transparent",
            fill: false, pointRadius: 0, borderWidth: 1,
          });
        }
      }
      const p2Extras = [LEG_WW];
      if (dcfcIdx.length > 0) p2Extras.push(LEG_DCFC);
      opts.plugins.legend = buildLegend(p2Extras);
      opts.plugins.tooltip = { enabled: false };
      evP2Inst.current = new Chart(evP2Ref.current, {
        type: "line",
        data: { labels, datasets: batDatasets },
        options: opts,
        plugins: [WHITE_BG, makeWwPlugin("ww2"), dcfcPlugin, makeEvCrosshair("ch_ev2")],
      });
    }

    return () => { [evP1Inst, evP2Inst, evP3Inst].forEach(ref => { if (ref.current) { ref.current.destroy(); ref.current = null; } }); };
  }, [result]);

  // ── Annual trace chart — overview canvas + zoom detail ────────────────────

  // Convert 0-based hour index to a readable date string (non-leap year)
  function hourToLabel(h) {
    const dim = [31,28,31,30,31,30,31,31,30,31,30,31];
    const mn  = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    let day = Math.floor(h / 24), hr = h % 24;
    for (let m = 0; m < 12; m++) {
      if (day < dim[m]) return `${mn[m]} ${day + 1} ${String(hr).padStart(2,"0")}:00`;
      day -= dim[m];
    }
    return `Dec 31 ${String(hr).padStart(2,"0")}:00`;
  }

  // Overview canvas — generator annual chart, stacked EV+battery + generator hours
  useEffect(() => {
    const trace = result?._genOptResult?.annualTrace;
    const canvas = annOverviewRef.current;
    if (!trace || !canvas) return;
    const W = canvas.parentElement?.offsetWidth || 800;
    canvas.width  = W;
    canvas.height = 72;
    const H = 72, N = 8760;
    const { bat, gen, batKwh, evTraces, evAwayTraces, evKwh, curtailed } = trace;
    const nEvStack  = (evTraces || []).filter(Boolean).length;
    const totalKwh  = batKwh + (evKwh ? evKwh.reduce((s, v) => s + v, 0) : 0);
    const EV_FILL      = ["rgba(200,130,20,0.80)","rgba(20,155,80,0.80)","rgba(20,130,170,0.80)"];
    const EV_FILL_AWAY = ["rgba(200,130,20,0.25)","rgba(20,155,80,0.25)","rgba(20,130,170,0.25)"];
    const BAT_FILL  = "rgba(30,100,200,0.80)";
    // Daily aggregates
    const dailyGenHrs    = new Float32Array(365);
    const dailyBatAvg    = new Float32Array(365);
    const dailyEvAvg     = evTraces ? evTraces.map(() => new Float32Array(365)) : [];
    const dailyCurtKwh   = new Float32Array(365);
    // Per-EV: fraction of solar hours (6–18) when EV is away
    const dailyEvAwayFrac = evTraces ? evTraces.map(() => new Float32Array(365)) : [];
    for (let day = 0; day < 365; day++) {
      let gs = 0, bs = 0, cs = 0;
      const evSums      = new Array(nEvStack).fill(0);
      const evAwaySolar = new Array(nEvStack).fill(0);
      for (let hr = 0; hr < 24; hr++) {
        const h = day * 24 + hr;
        gs += gen[h]; bs += bat[h];
        if (curtailed) cs += curtailed[h];
        for (let ei = 0; ei < nEvStack; ei++) {
          if (evTraces[ei]) evSums[ei] += evTraces[ei][h];
          if (hr >= 6 && hr < 18 && evAwayTraces?.[ei]?.[h]) evAwaySolar[ei]++;
        }
      }
      dailyGenHrs[day]  = gs;
      dailyBatAvg[day]  = bs / 24;
      dailyCurtKwh[day] = cs;
      for (let ei = 0; ei < nEvStack; ei++) {
        dailyEvAvg[ei][day]      = evSums[ei] / 24;
        dailyEvAwayFrac[ei][day] = evAwaySolar[ei] / 12; // fraction of 12 solar hours away
      }
    }
    const maxCurtKwh = curtailed ? Math.max(...dailyCurtKwh, 0.1) : 0;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, W, H);
    const dw   = W / 365;
    const barH = H * 0.82;
    for (let day = 0; day < 365; day++) {
      const x = day * dw, w = Math.max(1, dw);
      let yBase = H;
      // EV layers (bottom → top: least-used first)
      // Away fraction > 0.5 → faded color (EV absent most of solar day, not available to building)
      for (let ei = 0; ei < nEvStack; ei++) {
        const bh = (dailyEvAvg[ei][day] / totalKwh) * barH;
        const awayFrac = dailyEvAwayFrac[ei][day];
        ctx.fillStyle = awayFrac > 0.5 ? EV_FILL_AWAY[ei % EV_FILL_AWAY.length] : EV_FILL[ei % EV_FILL.length];
        ctx.fillRect(x, yBase - bh, w, bh);
        yBase -= bh;
      }
      // Battery layer on top of EVs
      const bbh = (dailyBatAvg[day] / totalKwh) * barH;
      ctx.fillStyle = BAT_FILL;
      ctx.fillRect(x, yBase - bbh, w, bbh);
      // Generator hours — orange overlay from bottom
      if (dailyGenHrs[day] > 0) {
        const gh = (dailyGenHrs[day] / 24) * H * 0.40;
        ctx.fillStyle = "rgba(210,80,10,0.75)";
        ctx.fillRect(x, H - gh, w, gh);
      }
      // Curtailed solar — yellow bars from top
      if (maxCurtKwh > 0 && dailyCurtKwh[day] > 0.1) {
        const ch = (dailyCurtKwh[day] / maxCurtKwh) * H * 0.18;
        ctx.fillStyle = "rgba(180,160,0,0.70)";
        ctx.fillRect(x, 0, w, ch);
      }
    }
    // Month dividers
    const mStart = [0,31,59,90,120,151,181,212,243,273,304,334];
    mStart.forEach((d) => {
      const x = (d / 365) * W;
      ctx.strokeStyle = "rgba(0,0,0,0.12)"; ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    });
    // Zoom window highlight + center tick
    const z1 = (annZoomH / N) * W, z2 = ((annZoomH + annZoomW) / N) * W;
    ctx.fillStyle = "rgba(0,60,200,0.12)";
    ctx.fillRect(z1, 0, z2 - z1, H);
    ctx.strokeStyle = "#1a4a7a"; ctx.lineWidth = 1.5;
    ctx.strokeRect(z1 + 0.5, 0.5, Math.max(1, z2 - z1 - 1), H - 1);
    const zc = (z1 + z2) / 2;
    ctx.strokeStyle = "rgba(40,40,40,0.7)"; ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    ctx.beginPath(); ctx.moveTo(zc, 0); ctx.lineTo(zc, H); ctx.stroke();
    ctx.setLineDash([]);
  }, [result, annZoomH, annZoomW]);

  // Native wheel listener — prevents page scroll while zooming the chart
  useEffect(() => {
    const el = annDetailContRef.current;
    if (!el) return;
    const handler = (e) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1.35 : 1 / 1.35;
      setAnnZoomW(oldW => {
        const newW = Math.max(48, Math.min(8760, Math.round(oldW * factor)));
        setAnnZoomH(oldH => Math.max(0, Math.min(8760 - newW, Math.round((oldH + oldW / 2) - newW / 2))));
        return newW;
      });
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [result]);   // re-attach if result (and therefore the div) changes

  // Detail charts — Power + Battery/EV stacked panels for generator annual zoom window
  useEffect(() => {
    const trace = result?._genOptResult?.annualTrace;
    if (!trace || !annP1Ref.current || !annP2Ref.current) return;
    if (annP1Inst.current) { annP1Inst.current.destroy(); annP1Inst.current = null; }
    if (annP2Inst.current) { annP2Inst.current.destroy(); annP2Inst.current = null; }
    const { bat, gen, unserved, sol, ld, batKwh, genKw, evTraces, evAwayTraces, evKwh, evLabels } = trace;
    const nEvStack = (evTraces || []).filter(Boolean).length;
    const totalKwhStack = batKwh + (evKwh ? evKwh.reduce((s, v) => s + v, 0) : 0);
    const startH = Math.max(0, annZoomH);
    const endH   = Math.min(8760, annZoomH + annZoomW);
    const nHours = endH - startH;
    const step   = Math.max(1, Math.floor(nHours / 720));
    const labels = [], solDs = [], ldDs = [], genDs = [], batDs = [], unsvDs = [], curtDs = [];
    const evDs        = Array.from({ length: nEvStack }, () => []);
    const perEvAwayDs = Array.from({ length: nEvStack }, () => []); // per-EV away state arrays
    for (let h = startH; h < endH; h += step) {
      labels.push(hourToLabel(h));
      solDs.push(+sol[h].toFixed(2));
      ldDs.push(+ld[h].toFixed(2));
      genDs.push(gen[h] ? genKw : 0);
      batDs.push(+bat[h].toFixed(2));
      unsvDs.push(unserved ? +(unserved[h].toFixed(2)) : 0);
      curtDs.push(trace.curtailed ? +trace.curtailed[h].toFixed(2) : 0);
      for (let ei = 0; ei < nEvStack; ei++) {
        evDs[ei].push(evTraces[ei] ? +evTraces[ei][h].toFixed(2) : 0);
        perEvAwayDs[ei].push(!!(evAwayTraces?.[ei]?.[h]));
      }
    }
    const awayDs = nEvStack > 0   // combined: any-EV-away (kept for early-exit checks)
      ? perEvAwayDs[0].map((_, i) => perEvAwayDs.some(a => a[i]))
      : [];
    const hasUnsv = unsvDs.some(v => v > 0.01);
    const hasCurt = curtDs.some(v => v > 0.01);
    const solarBotDs = solDs.map((s, i) => Math.max(0, s - curtDs[i]));
    // Collect DCFC event hours for vertical line drawing
    const enrouteDcfcHours   = [];
    const emergencyDcfcHours = [];
    if (trace.enrouteDcfc || trace.emergencyDcfc) {
      for (let h = startH; h < endH; h++) {
        if (trace.enrouteDcfc?.[h])   enrouteDcfcHours.push(h - startH);
        if (trace.emergencyDcfc?.[h]) emergencyDcfcHours.push(h - startH);
      }
    }
    const hasDcfc = enrouteDcfcHours.length > 0 || emergencyDcfcHours.length > 0;
    const batMinLine = new Array(labels.length).fill(+(batKwh * BATTERY_MIN_SOC).toFixed(2));
    const centerIdx  = Math.floor(labels.length / 2);
    const annGenCenterLine = {
      id: 'annGenCenterLine',
      afterDraw(chart) {
        if (!chart.data.labels?.length) return;
        const { ctx, chartArea, scales } = chart;
        if (!chartArea) return;
        const x = scales.x.getPixelForValue(centerIdx);
        ctx.save();
        ctx.strokeStyle = "rgba(40,40,40,0.55)";
        ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(x, chartArea.top); ctx.lineTo(x, chartArea.bottom); ctx.stroke();
        ctx.restore();
      }
    };
    const commonOpt = (bottom) => ({
      animation: false, responsive: true, maintainAspectRatio: false,
      scales: {
        x: { ticks: { maxTicksLimit: bottom ? 10 : 6, font: { size: 9 }, maxRotation: 0 },
             grid: { color: "#f0f0f0" }, display: true },
      },
      plugins: { legend: { labels: { font: { size: 10 }, boxWidth: 10 } }, tooltip: { enabled: false } },
      layout: { padding: { right: 8 } },
    });
    // Curtailment overlay plugin — fills tips of solar peaks where storage was full
    const annGenCurtPlugin = {
      id: "annGenCurtFill",
      afterDatasetsDraw(chart) {
        if (!hasCurt) return;
        const { ctx, scales } = chart;
        if (!scales.x || !scales.y) return;
        const topMeta = chart.getDatasetMeta(0);
        const botIdx  = chart.data.datasets.findIndex(d => d._curtBot);
        if (botIdx < 0) return;
        const botMeta = chart.getDatasetMeta(botIdx);
        if (!topMeta?.data.length || !botMeta?.data.length) return;
        ctx.save();
        ctx.fillStyle = "rgba(140,140,0,0.60)";
        drawCurtainBezier(ctx, topMeta, botMeta, curtDs);
        ctx.restore();
      },
    };
    // Panel 1: Power kW — solar, load, generator overlay
    const ANN_Y_W = 54; // fixed left-axis width — ensures P1 and P2 chart areas align exactly
    const opt1 = commonOpt(false);
    opt1.scales.y = { title: { display: true, text: "kW", font: { size: 10 } },
      beginAtZero: true, min: 0, ticks: { font: { size: 9 } }, grid: { color: "#f0f0f0" },
      afterFit(s) { s.width = ANN_Y_W; } };
    if (hasCurt || hasDcfc) {
      opt1.plugins.legend.labels = { font: { size: 10 }, boxWidth: 10, generateLabels(chart) {
        const items = Chart.defaults.plugins.legend.labels.generateLabels(chart).filter(item => !chart.data.datasets[item.datasetIndex]?._curtBot);
        if (hasCurt) items.push({ text: "Curtailed solar", fillStyle: "rgba(140,140,0,0.45)", strokeStyle: "rgba(0,0,0,0)", lineWidth: 0, hidden: false, datasetIndex: null, pointStyle: "rect" });
        if (enrouteDcfcHours.length)   items.push({ text: "En-route DCFC",  fillStyle: "transparent", strokeStyle: "rgba(0,140,130,0.75)",  lineWidth: 1.5, hidden: false, datasetIndex: null, pointStyle: "line" });
        if (emergencyDcfcHours.length) items.push({ text: "Emergency DCFC", fillStyle: "transparent", strokeStyle: "rgba(192,20,20,0.80)",  lineWidth: 1.5, hidden: false, datasetIndex: null, pointStyle: "line" });
        return items;
      }};
    }
    const annDcfcPlugin = {
      id: "annGenDcfcLines",
      afterDraw(chart) {
        if (!enrouteDcfcHours.length && !emergencyDcfcHours.length) return;
        const { ctx, chartArea } = chart;
        if (!chartArea) return;
        const W = chartArea.right - chartArea.left;
        const totalPts = labels.length;
        ctx.save();
        ctx.strokeStyle = "rgba(0,140,130,0.75)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        for (const idx of enrouteDcfcHours) {
          const sampleIdx = Math.floor(idx / step);
          if (sampleIdx >= totalPts) continue;
          const x = chartArea.left + (sampleIdx / (totalPts - 1)) * W;
          ctx.beginPath(); ctx.moveTo(x, chartArea.top); ctx.lineTo(x, chartArea.bottom); ctx.stroke();
        }
        ctx.strokeStyle = "rgba(192,20,20,0.80)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([]);
        for (const idx of emergencyDcfcHours) {
          const sampleIdx = Math.floor(idx / step);
          if (sampleIdx >= totalPts) continue;
          const x = chartArea.left + (sampleIdx / (totalPts - 1)) * W;
          const H = chartArea.bottom - chartArea.top;
          ctx.beginPath(); ctx.moveTo(x, chartArea.top + H * 0.5); ctx.lineTo(x, chartArea.bottom); ctx.stroke();
        }
        ctx.restore();
      }
    };
    const p1Datasets = [
      { label: "Solar kW",  data: solDs, borderColor: "#d48000", backgroundColor: "rgba(244,160,32,0.25)", fill: true,  tension: 0, pointRadius: 0, borderWidth: 1.5 },
      { label: "Load kW",   data: ldDs,  borderColor: "#204090", backgroundColor: "rgba(48,96,192,0.12)",  fill: true,  tension: 0, pointRadius: 0, borderWidth: 1.5 },
      { label: `Generator ${genKw} kW`, data: genDs, borderColor: "#c05010", backgroundColor: "rgba(200,80,20,0.30)", fill: true, tension: 0, pointRadius: 0, borderWidth: 1.5 },
    ];
    if (hasUnsv) p1Datasets.push({ label: "⚠ Unserved kW", data: unsvDs, borderColor: "#c01414", backgroundColor: "rgba(192,20,20,0.40)", fill: true, tension: 0, pointRadius: 0, borderWidth: 1.5 });
    if (hasCurt) p1Datasets.push({ label: "", data: solarBotDs, borderColor: "transparent", backgroundColor: "transparent", fill: false, tension: 0, pointRadius: 0, borderWidth: 0, _curtBot: true });
    annP1Inst.current = new Chart(annP1Ref.current, {
      type: "line",
      data: { labels, datasets: p1Datasets },
      options: opt1,
      plugins: [WHITE_BG, annGenCenterLine, annGenCurtPlugin, annDcfcPlugin],
    });
    // EV-away background shading plugin for P2 — per-EV colors so you can tell which EV is away
    const EV_AWAY_COLORS = [
      "rgba(176,112,16,0.13)",  // amber  — matches EV 0 chart color
      "rgba(16,112,80,0.13)",   // green  — matches EV 1 chart color
      "rgba(24,96,144,0.13)",   // teal   — matches EV 2 chart color
      "rgba(139,32,32,0.13)",   // red    — matches EV 3 chart color
    ];
    const annGenEvAwayPlugin = {
      id: "annGenEvAway",
      beforeDraw(chart) {
        if (!awayDs.some(Boolean)) return;
        const { ctx, chartArea, scales } = chart;
        if (!chartArea || !scales.x) return;
        for (let ei = 0; ei < perEvAwayDs.length; ei++) {
          const arr = perEvAwayDs[ei];
          if (!arr || !arr.some(Boolean)) continue;
          ctx.save();
          ctx.fillStyle = EV_AWAY_COLORS[ei % EV_AWAY_COLORS.length];
          for (let i = 0; i < arr.length - 1; i++) {
            if (!arr[i]) continue;
            const x0 = scales.x.getPixelForValue(i);
            const x1 = scales.x.getPixelForValue(i + 1);
            ctx.fillRect(x0, chartArea.top, x1 - x0, chartArea.bottom - chartArea.top);
          }
          ctx.restore();
        }
      },
    };
    // Panel 2: Battery + EV stacked kWh (identical logic to battery-only annual chart)
    const EV_BORDERS = ["#b07010","#107050","#186090"];
    const EV_BGS     = ["rgba(200,130,20,0.55)","rgba(20,155,80,0.55)","rgba(20,130,170,0.55)"];
    const opt2 = commonOpt(true);
    const yMax2 = nEvStack > 0 ? totalKwhStack * 1.05 : batKwh * 1.05;
    opt2.scales.y = { title: { display: true, text: "kWh stored", font: { size: 10 } },
      stacked: nEvStack > 0,
      beginAtZero: true, min: 0, max: yMax2, ticks: { font: { size: 9 } }, grid: { color: "#f0f0f0" },
      afterFit(s) { s.width = ANN_Y_W; } };
    const p2Datasets = [];
    for (let ei = 0; ei < nEvStack; ei++) {
      p2Datasets.push({
        label: evLabels?.[ei] || `EV ${ei + 1}`,
        data: evDs[ei],
        borderColor: EV_BORDERS[ei % EV_BORDERS.length],
        backgroundColor: EV_BGS[ei % EV_BGS.length],
        fill: true, tension: 0, pointRadius: 0, borderWidth: 1,
        order: nEvStack - ei,
      });
    }
    p2Datasets.push({
      label: `Battery (${batKwh} kWh)`,
      data: batDs,
      borderColor: "#1a3a90",
      backgroundColor: nEvStack > 0 ? "rgba(30,80,200,0.60)" : "rgba(32,160,96,0.25)",
      fill: true, tension: 0, pointRadius: 0, borderWidth: 1.5,
      order: 0,
    });
    if (nEvStack === 0) {
      p2Datasets.push({ label: `Min SOC (${(batKwh * BATTERY_MIN_SOC).toFixed(1)} kWh)`,
        data: batMinLine, borderColor: "#107040", borderDash: [4,3],
        backgroundColor: "transparent", fill: false, pointRadius: 0, borderWidth: 1 });
    }
    annP2Inst.current = new Chart(annP2Ref.current, {
      type: "line",
      data: { labels, datasets: p2Datasets },
      options: opt2,
      plugins: [WHITE_BG, { ...annGenCenterLine, id: 'annGenCenterLine2' }, annGenEvAwayPlugin],
    });
    return () => {
      if (annP1Inst.current) { annP1Inst.current.destroy(); annP1Inst.current = null; }
      if (annP2Inst.current) { annP2Inst.current.destroy(); annP2Inst.current = null; }
    };
  }, [result, annZoomH, annZoomW]);

  // ── Battery-only annual dispatch chart ────────────────────────────────────────

  // Overview canvas — full-year daily SOC averages + unserved hours (red)
  // Zoom state shared with generator chart (annZoomH / annZoomW)
  useEffect(() => {
    const trace = result?._annualTrace;
    const canvas = annBatOverviewRef.current;
    if (!trace || !canvas) return;
    const W = canvas.parentElement?.offsetWidth || 800;
    canvas.width  = W;
    canvas.height = 72;
    const H = 72, N = 8760;
    const { bat, unserved, batKwh, evTraces, evAwayTraces, evKwh, curtailed } = trace;
    const nEvStack = (evTraces || []).filter(Boolean).length;
    const totalKwh = batKwh + (evKwh ? evKwh.reduce((s, v) => s + v, 0) : 0);
    // EV colors (bottom=amber, middle=teal, next=green) and battery blue on top
    const EV_FILL      = ["rgba(200,130,20,0.80)","rgba(20,155,80,0.80)","rgba(20,130,170,0.80)"];
    const EV_FILL_AWAY = ["rgba(200,130,20,0.25)","rgba(20,155,80,0.25)","rgba(20,130,170,0.25)"];
    const BAT_FILL = "rgba(30,100,200,0.80)";

    const dailyBatAvg     = new Float32Array(365);
    const dailyEvAvg      = evTraces ? evTraces.map(() => new Float32Array(365)) : [];
    const dailyUnsvHrs    = new Float32Array(365);
    const dailyCurtKwh    = new Float32Array(365);
    const dailyEvAwayFrac = evTraces ? evTraces.map(() => new Float32Array(365)) : [];
    for (let day = 0; day < 365; day++) {
      let bs = 0, us = 0, cs = 0;
      const evSums      = new Array(nEvStack).fill(0);
      const evAwaySolar = new Array(nEvStack).fill(0);
      for (let hr = 0; hr < 24; hr++) {
        const h = day * 24 + hr;
        bs += bat[h];
        if (curtailed) cs += curtailed[h];
        for (let ei = 0; ei < nEvStack; ei++) {
          if (evTraces[ei]) evSums[ei] += evTraces[ei][h];
          if (hr >= 6 && hr < 18 && evAwayTraces?.[ei]?.[h]) evAwaySolar[ei]++;
        }
        if (unserved && unserved[h] > 0.001) us++;
      }
      dailyBatAvg[day]  = bs / 24;
      for (let ei = 0; ei < nEvStack; ei++) {
        dailyEvAvg[ei][day]      = evSums[ei] / 24;
        dailyEvAwayFrac[ei][day] = evAwaySolar[ei] / 12;
      }
      dailyUnsvHrs[day] = us;
      dailyCurtKwh[day] = cs;
    }
    const maxCurtKwh = curtailed ? Math.max(...dailyCurtKwh, 0.1) : 0;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, W, H);
    const dw = W / 365;
    const barH = H * 0.82;   // max bar height
    for (let day = 0; day < 365; day++) {
      const x = day * dw, w = Math.max(1, dw);
      let yBase = H;  // draw from bottom upward
      // EV layers (bottom → top: least-used first)
      // Away fraction > 0.5 → faded color (EV absent most of solar day, not available to building)
      for (let ei = 0; ei < nEvStack; ei++) {
        const bh = (dailyEvAvg[ei][day] / totalKwh) * barH;
        const awayFrac = dailyEvAwayFrac[ei][day];
        ctx.fillStyle = awayFrac > 0.5 ? EV_FILL_AWAY[ei % EV_FILL_AWAY.length] : EV_FILL[ei % EV_FILL.length];
        ctx.fillRect(x, yBase - bh, w, bh);
        yBase -= bh;
      }
      // Battery layer on top
      const bbh = (dailyBatAvg[day] / totalKwh) * barH;
      ctx.fillStyle = BAT_FILL;
      ctx.fillRect(x, yBase - bbh, w, bbh);
      // Unserved hours (red bar from top)
      if (dailyUnsvHrs[day] > 0) {
        const uh = (dailyUnsvHrs[day] / 24) * H * 0.85;
        ctx.fillStyle = "rgba(192,20,20,0.85)";
        ctx.fillRect(x, 0, w, uh);
      }
      // Curtailed solar (yellow bar from top)
      if (maxCurtKwh > 0 && dailyCurtKwh[day] > 0.1) {
        const ch = (dailyCurtKwh[day] / maxCurtKwh) * H * 0.18;
        ctx.fillStyle = "rgba(180,160,0,0.70)";
        ctx.fillRect(x, 0, w, ch);
      }
    }
    // Month dividers (no text labels — rendered as HTML below the canvas)
    const mStart = [0,31,59,90,120,151,181,212,243,273,304,334];
    mStart.forEach((d) => {
      const x = (d / 365) * W;
      ctx.strokeStyle = "rgba(0,0,0,0.12)"; ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    });
    const z1 = (annZoomH / N) * W, z2 = ((annZoomH + annZoomW) / N) * W;
    ctx.fillStyle = "rgba(0,60,200,0.12)";
    ctx.fillRect(z1, 0, z2 - z1, H);
    ctx.strokeStyle = "#1a4a7a"; ctx.lineWidth = 1.5;
    ctx.strokeRect(z1 + 0.5, 0.5, Math.max(1, z2 - z1 - 1), H - 1);
    const zc = (z1 + z2) / 2;
    ctx.strokeStyle = "rgba(40,40,40,0.7)"; ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    ctx.beginPath(); ctx.moveTo(zc, 0); ctx.lineTo(zc, H); ctx.stroke();
    ctx.setLineDash([]);
  }, [result, annZoomH, annZoomW]);

  // Wheel zoom/pan for battery annual chart — updates shared zoom state
  useEffect(() => {
    const el = annBatDetailContRef.current;
    if (!el) return;
    const handler = (e) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1.35 : 1 / 1.35;
      setAnnZoomW(oldW => {
        const newW = Math.max(48, Math.min(8760, Math.round(oldW * factor)));
        setAnnZoomH(oldH => Math.max(0, Math.min(8760 - newW, Math.round((oldH + oldW / 2) - newW / 2))));
        return newW;
      });
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [result]);

  // Detail charts — Solar+Load+Unserved power panel + Battery kWh panel
  // Zoom state shared with generator chart (annZoomH / annZoomW)
  useEffect(() => {
    const trace = result?._annualTrace;
    if (!trace || !annBatP1Ref.current || !annBatP2Ref.current) return;
    if (annBatP1Inst.current) { annBatP1Inst.current.destroy(); annBatP1Inst.current = null; }
    if (annBatP2Inst.current) { annBatP2Inst.current.destroy(); annBatP2Inst.current = null; }
    const { bat, unserved, sol, ld, batKwh, evTraces, evAwayTraces, evKwh, evLabels } = trace;
    const nEvStack = (evTraces || []).filter(Boolean).length;
    const totalKwhStack = batKwh + (evKwh ? evKwh.reduce((s, v) => s + v, 0) : 0);
    const startH = Math.max(0, annZoomH);
    const endH   = Math.min(8760, annZoomH + annZoomW);
    const nHours = endH - startH;
    const step   = Math.max(1, Math.floor(nHours / 720));
    const labels = [], solDs = [], ldDs = [], batDs = [], unsvDs = [], curtDs = [];
    const evDs        = Array.from({ length: nEvStack }, () => []);
    const perEvAwayDs = Array.from({ length: nEvStack }, () => []); // per-EV away state arrays
    for (let h = startH; h < endH; h += step) {
      labels.push(hourToLabel(h));
      solDs.push(+sol[h].toFixed(2));
      ldDs.push(+ld[h].toFixed(2));
      batDs.push(+bat[h].toFixed(2));
      unsvDs.push(unserved ? +(unserved[h].toFixed(2)) : 0);
      curtDs.push(trace.curtailed ? +trace.curtailed[h].toFixed(2) : 0);
      for (let ei = 0; ei < nEvStack; ei++) {
        evDs[ei].push(evTraces[ei] ? +evTraces[ei][h].toFixed(2) : 0);
        perEvAwayDs[ei].push(!!(evAwayTraces?.[ei]?.[h]));
      }
    }
    const awayDs = nEvStack > 0   // combined: any-EV-away (kept for early-exit checks)
      ? perEvAwayDs[0].map((_, i) => perEvAwayDs.some(a => a[i]))
      : [];
    const hasUnsv = unsvDs.some(v => v > 0.01);
    const hasCurt = curtDs.some(v => v > 0.01);
    const solarBotDs = solDs.map((s, i) => Math.max(0, s - curtDs[i]));
    // Collect DCFC event hours for vertical line drawing
    const enrouteDcfcHours   = [];
    const emergencyDcfcHours = [];
    if (trace.enrouteDcfc || trace.emergencyDcfc) {
      for (let h = startH; h < endH; h++) {
        if (trace.enrouteDcfc?.[h])   enrouteDcfcHours.push(h - startH);
        if (trace.emergencyDcfc?.[h]) emergencyDcfcHours.push(h - startH);
      }
    }
    const hasDcfc = enrouteDcfcHours.length > 0 || emergencyDcfcHours.length > 0;
    const batMinLine = new Array(labels.length).fill(+(batKwh * BATTERY_MIN_SOC).toFixed(2));
    const centerIdx = Math.floor(labels.length / 2);
    const annCenterLine = {
      id: 'annBatCenterLine',
      afterDraw(chart) {
        if (!chart.data.labels?.length) return;
        const { ctx, chartArea, scales } = chart;
        if (!chartArea) return;
        const x = scales.x.getPixelForValue(centerIdx);
        ctx.save();
        ctx.strokeStyle = "rgba(40,40,40,0.55)";
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(x, chartArea.top); ctx.lineTo(x, chartArea.bottom); ctx.stroke();
        ctx.restore();
      }
    };
    const commonOpt = (bottom) => ({
      animation: false, responsive: true, maintainAspectRatio: false,
      scales: {
        x: { ticks: { maxTicksLimit: bottom ? 10 : 6, font: { size: 9 }, maxRotation: 0 },
             grid: { color: "#f0f0f0" }, display: true },
      },
      plugins: { legend: { labels: { font: { size: 10 }, boxWidth: 10 } }, tooltip: { enabled: false } },
      layout: { padding: { right: 8 } },
    });
    const annBatCurtPlugin = {
      id: "annBatCurtFill",
      afterDatasetsDraw(chart) {
        if (!hasCurt) return;
        const { ctx, scales } = chart;
        if (!scales.x || !scales.y) return;
        const topMeta = chart.getDatasetMeta(0);
        const botIdx  = chart.data.datasets.findIndex(d => d._curtBot);
        if (botIdx < 0) return;
        const botMeta = chart.getDatasetMeta(botIdx);
        if (!topMeta?.data.length || !botMeta?.data.length) return;
        ctx.save();
        ctx.fillStyle = "rgba(140,140,0,0.60)";
        drawCurtainBezier(ctx, topMeta, botMeta, curtDs);
        ctx.restore();
      },
    };
    const ANN_Y_W = 54; // fixed left-axis width — ensures P1 and P2 chart areas align exactly
    const opt1 = commonOpt(false);
    opt1.scales.y = { title: { display: true, text: "kW", font: { size: 10 } },
      beginAtZero: true, min: 0, ticks: { font: { size: 9 } }, grid: { color: "#f0f0f0" },
      afterFit(s) { s.width = ANN_Y_W; } };
    if (hasCurt || hasDcfc) {
      opt1.plugins.legend.labels = { font: { size: 10 }, boxWidth: 10, generateLabels(chart) {
        const items = Chart.defaults.plugins.legend.labels.generateLabels(chart).filter(item => !chart.data.datasets[item.datasetIndex]?._curtBot);
        if (hasCurt) items.push({ text: "Curtailed solar", fillStyle: "rgba(140,140,0,0.45)", strokeStyle: "rgba(0,0,0,0)", lineWidth: 0, hidden: false, datasetIndex: null, pointStyle: "rect" });
        if (enrouteDcfcHours.length)   items.push({ text: "En-route DCFC",  fillStyle: "transparent", strokeStyle: "rgba(0,140,130,0.75)",  lineWidth: 1.5, hidden: false, datasetIndex: null, pointStyle: "line" });
        if (emergencyDcfcHours.length) items.push({ text: "Emergency DCFC", fillStyle: "transparent", strokeStyle: "rgba(192,20,20,0.80)",  lineWidth: 1.5, hidden: false, datasetIndex: null, pointStyle: "line" });
        return items;
      }};
    }
    const annBatDcfcPlugin = {
      id: "annBatDcfcLines",
      afterDraw(chart) {
        if (!enrouteDcfcHours.length && !emergencyDcfcHours.length) return;
        const { ctx, chartArea } = chart;
        if (!chartArea) return;
        const W = chartArea.right - chartArea.left;
        const totalPts = labels.length;
        ctx.save();
        ctx.strokeStyle = "rgba(0,140,130,0.75)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        for (const idx of enrouteDcfcHours) {
          const sampleIdx = Math.floor(idx / step);
          if (sampleIdx >= totalPts) continue;
          const x = chartArea.left + (sampleIdx / (totalPts - 1)) * W;
          ctx.beginPath(); ctx.moveTo(x, chartArea.top); ctx.lineTo(x, chartArea.bottom); ctx.stroke();
        }
        ctx.strokeStyle = "rgba(192,20,20,0.80)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([]);
        for (const idx of emergencyDcfcHours) {
          const sampleIdx = Math.floor(idx / step);
          if (sampleIdx >= totalPts) continue;
          const x = chartArea.left + (sampleIdx / (totalPts - 1)) * W;
          const H = chartArea.bottom - chartArea.top;
          ctx.beginPath(); ctx.moveTo(x, chartArea.top + H * 0.5); ctx.lineTo(x, chartArea.bottom); ctx.stroke();
        }
        ctx.restore();
      }
    };
    const p1Datasets = [
      { label: "Solar kW", data: solDs, borderColor: "#d48000", backgroundColor: "rgba(244,160,32,0.25)", fill: true,  tension: 0, pointRadius: 0, borderWidth: 1.5 },
      { label: "Load kW",  data: ldDs,  borderColor: "#204090", backgroundColor: "rgba(48,96,192,0.12)",  fill: true,  tension: 0, pointRadius: 0, borderWidth: 1.5 },
    ];
    if (hasUnsv) {
      p1Datasets.push({ label: "⚠ Unserved kW", data: unsvDs, borderColor: "#c01414", backgroundColor: "rgba(192,20,20,0.40)", fill: true, tension: 0, pointRadius: 0, borderWidth: 1.5 });
    }
    if (hasCurt) p1Datasets.push({ label: "", data: solarBotDs, borderColor: "transparent", backgroundColor: "transparent", fill: false, tension: 0, pointRadius: 0, borderWidth: 0, _curtBot: true });
    annBatP1Inst.current = new Chart(annBatP1Ref.current, {
      type: "line",
      data: { labels, datasets: p1Datasets },
      options: opt1,
      plugins: [WHITE_BG, annCenterLine, annBatCurtPlugin, annBatDcfcPlugin],
    });
    const EV_BORDERS = ["#b07010","#107050","#186090"];
    const EV_BGS     = ["rgba(200,130,20,0.55)","rgba(20,155,80,0.55)","rgba(20,130,170,0.55)"];
    const opt2 = commonOpt(true);
    const yMax2 = nEvStack > 0 ? totalKwhStack * 1.05 : batKwh * 1.05;
    opt2.scales.y = { title: { display: true, text: "kWh stored", font: { size: 10 } },
      stacked: nEvStack > 0,
      beginAtZero: true, min: 0, max: yMax2, ticks: { font: { size: 9 } }, grid: { color: "#f0f0f0" },
      afterFit(s) { s.width = ANN_Y_W; } };
    // Build stacked datasets: EV layers first (bottom→top = least-used→most-used), battery on top
    const p2Datasets = [];
    for (let ei = 0; ei < nEvStack; ei++) {
      p2Datasets.push({
        label: evLabels?.[ei] || `EV ${ei + 1}`,
        data: evDs[ei],
        borderColor: EV_BORDERS[ei % EV_BORDERS.length],
        backgroundColor: EV_BGS[ei % EV_BGS.length],
        fill: true, tension: 0, pointRadius: 0, borderWidth: 1,
        order: nEvStack - ei,   // lower order = drawn on top; EVs under battery
      });
    }
    p2Datasets.push({
      label: `Battery (${batKwh} kWh)`,
      data: batDs,
      borderColor: "#1a3a90",
      backgroundColor: nEvStack > 0 ? "rgba(30,80,200,0.60)" : "rgba(32,160,96,0.25)",
      fill: true, tension: 0, pointRadius: 0, borderWidth: 1.5,
      order: 0,
    });
    if (nEvStack === 0) {
      p2Datasets.push({ label: `Min SOC (${(batKwh * BATTERY_MIN_SOC).toFixed(1)} kWh)`,
        data: batMinLine, borderColor: "#107040", borderDash: [4,3],
        backgroundColor: "transparent", fill: false, pointRadius: 0, borderWidth: 1 });
    }
    // EV-away background shading plugin for P2 — per-EV colors so you can tell which EV is away
    const EV_AWAY_COLORS = [
      "rgba(176,112,16,0.13)",  // amber  — matches EV 0 chart color
      "rgba(16,112,80,0.13)",   // green  — matches EV 1 chart color
      "rgba(24,96,144,0.13)",   // teal   — matches EV 2 chart color
      "rgba(139,32,32,0.13)",   // red    — matches EV 3 chart color
    ];
    const annBatEvAwayPlugin = {
      id: "annBatEvAway",
      beforeDraw(chart) {
        if (!awayDs.some(Boolean)) return;
        const { ctx, chartArea, scales } = chart;
        if (!chartArea || !scales.x) return;
        for (let ei = 0; ei < perEvAwayDs.length; ei++) {
          const arr = perEvAwayDs[ei];
          if (!arr || !arr.some(Boolean)) continue;
          ctx.save();
          ctx.fillStyle = EV_AWAY_COLORS[ei % EV_AWAY_COLORS.length];
          for (let i = 0; i < arr.length - 1; i++) {
            if (!arr[i]) continue;
            const x0 = scales.x.getPixelForValue(i);
            const x1 = scales.x.getPixelForValue(i + 1);
            ctx.fillRect(x0, chartArea.top, x1 - x0, chartArea.bottom - chartArea.top);
          }
          ctx.restore();
        }
      },
    };
    annBatP2Inst.current = new Chart(annBatP2Ref.current, {
      type: "line",
      data: { labels, datasets: p2Datasets },
      options: opt2,
      plugins: [WHITE_BG, { ...annCenterLine, id: 'annBatCenterLine2' }, annBatEvAwayPlugin],
    });
    return () => {
      if (annBatP1Inst.current) { annBatP1Inst.current.destroy(); annBatP1Inst.current = null; }
      if (annBatP2Inst.current) { annBatP2Inst.current.destroy(); annBatP2Inst.current = null; }
    };
  }, [result, annZoomH, annZoomW]);

  // ── Chart: Phase 2 EV impact — solar/load + battery SOC + per-EV SOC panels ─

  useEffect(() => {
    // Destroy previous Phase 2 chart instances
    [evImpP1Inst, evImpBatInst, ...evImpSocInsts].forEach(ref => {
      if (ref.current) { ref.current.destroy(); ref.current = null; }
    });
    if (!evImpact || !evImpact.evOptResult?._traceData || !result) return;
    if (!evImpP1Ref.current || !evImpBatRef.current) return;

    const traceData   = evImpact.evOptResult._traceData;
    const batKwhCap   = evImpact.evOptResult._batKwhCap || (evImpact.evOpt?.batteryKwh || 20);
    const nEvs        = Math.min(evImpact.fleetSummary.length, 4);
    const spinupHours = result._cell.spinup_days * 24;
    const wwHours2    = result._cell.window_days * 24;
    const totalH      = traceData.length;
    const displayStart = Math.max(0, spinupHours - 48);
    const slice        = traceData.slice(displayStart, totalH);
    evImpSliceRef.current = slice;
    const wwMaskStart  = spinupHours - displayStart;
    const wwMaskEnd    = spinupHours + wwHours2 - displayStart;
    const pwMaskStart2 = wwMaskEnd;
    const pwMaskEnd2   = totalH - displayStart;
    const hasPostWw2   = (result._cell.post_window_days || 0) > 0;

    const labels  = slice.map(r => fmtDateHr(r.month, r.day, r.hourOfDay));
    const solarDs = slice.map(r => r.solarKw);
    const loadDs  = slice.map(r => r.loadKw);
    const batDs   = slice.map(r => r.batKwhEnd);
    const curtDs  = slice.map(r => r.curtailed || 0);
    const hasCurt = curtDs.some(v => v > 0.01);
    const solarBotDs = solarDs.map((s, i) => Math.max(0, s - curtDs[i]));
    const dcfcIdx = slice.reduce((a, r, i) => { if (r.dcfcEvent) a.push(i); return a; }, []);

    // Common kWh scale: all SOC panels use the same left-axis max (largest device).
    // Right axis is calibrated per device so 100% aligns with device full capacity.
    const evKwhCaps = evList.slice(0, 4).map(ev => ev.kwh || 1);
    const commonKwhMax = Math.max(batKwhCap, ...evKwhCaps, 1) * 1.05;

    const EV_COLORS = ["#7b2d8b", "#1a6696", "#b05a00", "#1a7a40"];

    const Y2_W = 46;
    const yFit  = scale => { scale.width = 62; };
    const yFit2 = scale => { scale.width = Y2_W; };

    // Helper: right-axis %SOC calibrated to device capacity
    const makeSocAxisY2 = (deviceKwh, kwhMax) => {
      const socMax = deviceKwh > 0 ? kwhMax / deviceKwh * 100 : 100;
      return {
        position: "right",
        title: { display: true, text: "% SOC", font: { size: 9 } },
        min: 0, max: socMax,
        grid: { drawOnChartArea: false },
        afterFit: yFit2,
        afterBuildTicks(axis) {
          axis.ticks = [0, 25, 50, 75, 100]
            .filter(v => v <= socMax + 0.5)
            .map(v => ({ value: v }));
        },
        ticks: { callback: v => (v <= 100.5) ? `${Math.round(v)}%` : null, font: { size: 9 } },
      };
    };

    function makeWwPlugin2(id) {
      return {
        id,
        beforeDraw(chart) {
          const { ctx, chartArea, scales } = chart;
          if (!chartArea) return;
          ctx.save();
          const x0 = scales.x.getPixelForValue(Math.max(0, wwMaskStart));
          const x1 = scales.x.getPixelForValue(Math.min(slice.length - 1, wwMaskEnd - 1));
          ctx.fillStyle = "rgba(192,57,43,0.07)";
          ctx.fillRect(x0, chartArea.top, x1 - x0, chartArea.bottom - chartArea.top);
          // Post-window has white background (same as spinup — no special tint)
          ctx.restore();
        },
      };
    }

    const dcfcPlugin2 = {
      id: "dcfcLines2",
      afterDraw(chart) {
        const { ctx, chartArea, scales } = chart;
        if (!chartArea) return;
        ctx.save(); ctx.strokeStyle = "rgba(192,57,43,0.65)"; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
        for (const i of dcfcIdx) {
          const x = scales.x.getPixelForValue(i);
          ctx.beginPath(); ctx.moveTo(x, chartArea.top); ctx.lineTo(x, chartArea.bottom); ctx.stroke();
        }
        ctx.restore();
      },
    };

    const allImpInsts = [evImpP1Inst, evImpBatInst, ...evImpSocInsts.slice(0, nEvs)];

    function makeImpCrosshair(id) {
      return {
        id,
        afterDraw(chart) {
          const idx = evImpCrosshairIdx.current;
          if (idx < 0 || idx >= labels.length) return;
          const { ctx, chartArea, scales } = chart;
          if (!chartArea || !scales.x) return;
          const x = scales.x.getPixelForValue(idx);
          ctx.save(); ctx.strokeStyle = "rgba(40,40,40,0.45)"; ctx.lineWidth = 1; ctx.setLineDash([]);
          ctx.beginPath(); ctx.moveTo(x, chartArea.top); ctx.lineTo(x, chartArea.bottom); ctx.stroke();
          ctx.restore();
        },
        afterEvent(chart, args) {
          const { event } = args;
          if (event.type === "mouseout") {
            if (evImpCrosshairIdx.current !== -1) {
              evImpCrosshairIdx.current = -1; evImpHoverRowRef.current = null; setEvImpHoverRow(null);
              allImpInsts.forEach(r => { if (r.current) r.current.update("none"); });
            }
            return;
          }
          if (event.type !== "mousemove" || !chart.scales.x) return;
          const idx = Math.max(0, Math.min(Math.round(chart.scales.x.getValueForPixel(event.x)), labels.length - 1));
          if (idx === evImpCrosshairIdx.current) return;
          evImpCrosshairIdx.current = idx; evImpHoverRowRef.current = slice[idx]; setEvImpHoverRow(slice[idx]);
          allImpInsts.forEach(r => { if (r.current) r.current.update("none"); });
        },
      };
    }

    const commonOpts = (showX) => ({
      animation: false, responsive: true, maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: { legend: buildLegend([]), tooltip: { enabled: false } },
      scales: {
        x: { display: showX, ticks: { maxTicksLimit: 14, font: { size: 9 }, maxRotation: 30 }, grid: { color: "#f0f0f0" } },
      },
    });

    // Curtailment overlay plugin for EV impact P1 — same bezier fill as main result chart
    const evImpCurtailPlugin = {
      id: "evImpCurtFill",
      afterDatasetsDraw(chart) {
        if (!hasCurt) return;
        const { ctx, scales } = chart;
        if (!scales.x || !scales.y) return;
        const topMeta = chart.getDatasetMeta(0); // solar
        const botMeta = chart.getDatasetMeta(2); // solar − curtailed (hidden dataset)
        if (!topMeta?.data.length || !botMeta?.data.length) return;
        ctx.save();
        ctx.fillStyle = "rgba(140,140,0,0.60)";
        drawCurtainBezier(ctx, topMeta, botMeta, curtDs);
        ctx.restore();
      },
    };

    // Panel 1: Solar + Load (no right axis — padding.right = Y2_W keeps x-axis aligned)
    {
      const opts = commonOpts(false);
      opts.scales.y = { title: { display: true, text: "Power (kW)", font: { size: 10 } }, beginAtZero: true, grid: { color: "#f0f0f0" }, afterFit: yFit };
      opts.layout = { padding: { right: Y2_W } };
      const LEG_CURT_IMP = { text: "Curtailed solar", fillStyle: "rgba(140,140,0,0.45)", strokeStyle: "rgba(0,0,0,0)", lineWidth: 0, lineDash: [], hidden: false, datasetIndex: null, pointStyle: "rect" };
      const p1Leg = [LEG_WW];
      if (hasCurt) p1Leg.push(LEG_CURT_IMP);
      opts.plugins.legend = buildLegend(p1Leg);
      evImpP1Inst.current = new Chart(evImpP1Ref.current, {
        type: "line",
        data: { labels, datasets: [
          { label: "Solar kW",  data: solarDs,    borderColor: "#d48000", backgroundColor: "rgba(244,160,32,0.35)", fill: true,  tension: 0.15, pointRadius: 0, borderWidth: 1.5 },
          { label: "Load kW",   data: loadDs,     borderColor: "#204090", backgroundColor: "rgba(48,96,192,0.15)",  fill: true,  tension: 0.15, pointRadius: 0, borderWidth: 1.5 },
          { label: "", data: solarBotDs, borderColor: "transparent", backgroundColor: "transparent", fill: false, tension: 0.15, pointRadius: 0, borderWidth: 0, _curtBot: true },
        ]},
        options: opts,
        plugins: [WHITE_BG, makeWwPlugin2("ww_imp1"), dcfcPlugin2, evImpCurtailPlugin, makeImpCrosshair("ch_imp1")],
      });
    }

    // Panel 2: Battery SOC — kWh left axis, %SOC right axis, common kWh scale
    {
      const batMinKwh = batKwhCap * BATTERY_MIN_SOC;
      const opts = commonOpts(nEvs === 0);
      opts.scales.y = {
        title: { display: true, text: "kWh", font: { size: 10 } },
        beginAtZero: true, min: 0, max: commonKwhMax, grid: { color: "#f0f0f0" }, afterFit: yFit,
      };
      opts.scales.y2 = makeSocAxisY2(batKwhCap, commonKwhMax);
      opts.plugins.legend = buildLegend([LEG_WW]);
      evImpBatInst.current = new Chart(evImpBatRef.current, {
        type: "line",
        data: { labels, datasets: [
          { label: `Battery (${batKwhCap} kWh)`, data: batDs, borderColor: "#107040", backgroundColor: "rgba(32,160,96,0.35)", fill: true, tension: 0.15, pointRadius: 0, borderWidth: 1.5 },
          { label: `Bat min (${(BATTERY_MIN_SOC*100).toFixed(0)}% = ${batMinKwh.toFixed(1)} kWh)`, data: new Array(slice.length).fill(batMinKwh), borderColor: "#107040", borderDash: [4,3], backgroundColor: "transparent", fill: false, pointRadius: 0, borderWidth: 1 },
        ]},
        options: opts,
        plugins: [WHITE_BG, makeWwPlugin2("ww_imp2"), dcfcPlugin2, makeImpCrosshair("ch_imp2")],
      });
    }

    // Panels 3..N: one per EV SOC — kWh left axis, %SOC right axis, common kWh scale
    for (let i = 0; i < nEvs; i++) {
      if (!evImpSocRefs[i].current) continue;
      const ev        = evList[i];
      const color     = EV_COLORS[i % 4];
      const evLabel   = evImpact.fleetSummary[i]?.label || ev?.label || `EV ${i+1}`;
      const evKwh     = ev?.kwh || 1;
      const evMinKwh  = erDistanceMiles * 1.25 / (ev?.evEfficiency ?? EV_EFFICIENCY);
      const evSocDs   = slice.map(r => r.evAway?.[i] ? null : (r.evKwhEnd?.[i] != null ? r.evKwhEnd[i] : null));
      // "Away" background plugin: shade hours when EV is away
      const awayArr = slice.map(r => r.evAway?.[i] || false);
      function makeAwayPlugin(pid) {
        return {
          id: pid,
          beforeDraw(chart) {
            const { ctx, chartArea, scales } = chart;
            if (!chartArea) return;
            ctx.save(); ctx.fillStyle = "rgba(100,100,100,0.10)";
            for (let j = 0; j < awayArr.length - 1; j++) {
              if (!awayArr[j]) continue;
              const x0 = scales.x.getPixelForValue(j);
              const x1 = scales.x.getPixelForValue(j + 1);
              ctx.fillRect(x0, chartArea.top, x1 - x0, chartArea.bottom - chartArea.top);
            }
            ctx.restore();
          },
        };
      }
      const isLast = (i === nEvs - 1);
      const opts = commonOpts(isLast);
      opts.scales.y = {
        title: { display: true, text: `EV ${i+1} — ${evLabel} (${evKwh} kWh)`, font: { size: 10 } },
        beginAtZero: true, min: 0, max: commonKwhMax, grid: { color: "#f0f0f0" }, afterFit: yFit,
      };
      opts.scales.y2 = makeSocAxisY2(evKwh, commonKwhMax);
      opts.plugins.legend = buildLegend([]);
      evImpSocInsts[i].current = new Chart(evImpSocRefs[i].current, {
        type: "line",
        data: { labels, datasets: [
          { label: `${evLabel} (${evKwh} kWh)`, data: evSocDs, borderColor: color, backgroundColor: color.replace(")", ",0.18)").replace("rgb","rgba"), fill: true, tension: 0.15, pointRadius: 0, borderWidth: 1.5, spanGaps: false },
          { label: `${evLabel} min (${evMinKwh.toFixed(1)} kWh)`, data: new Array(slice.length).fill(evMinKwh), borderColor: color, borderDash: [4,3], backgroundColor: "transparent", fill: false, pointRadius: 0, borderWidth: 1 },
        ]},
        options: opts,
        plugins: [WHITE_BG, makeWwPlugin2(`ww_ev${i}`), makeAwayPlugin(`away_ev${i}`), dcfcPlugin2, makeImpCrosshair(`ch_ev${i}`)],
      });
    }

    return () => {
      [evImpP1Inst, evImpBatInst, ...evImpSocInsts].forEach(ref => {
        if (ref.current) { ref.current.destroy(); ref.current = null; }
      });
    };
  }, [evImpact, result]);

  // ── Chart: EV impact detail — ±24h around pinnedEvImpRow ─────────────────

  useEffect(() => {
    [evImpDiagP1Inst, evImpDiagBatInst, ...evImpDiagSocInsts].forEach(ref => {
      if (ref.current) { ref.current.destroy(); ref.current = null; }
    });
    setEvImpDiagHoverRow(null);
    evImpDiagCrosshairIdx.current = -1;
    if (!pinnedEvImpRow || !evImpact?.evOptResult?._traceData || !result) return;
    if (!evImpDiagP1Ref.current || !evImpDiagBatRef.current) return;

    const traceData = evImpact.evOptResult._traceData;
    const batKwhCap = evImpact.evOptResult._batKwhCap || (evImpact.evOpt?.batteryKwh || 20);
    const nEvs      = Math.min(evImpact.fleetSummary.length, 4);

    const h     = pinnedEvImpRow.h;
    const start = Math.max(0, h - 24);
    const end   = Math.min(traceData.length - 1, h + 24);
    const slice = traceData.slice(start, end + 1);
    evImpDiagSliceRef.current = slice;
    const centerIdx = h - start;

    const labels     = slice.map(r => fmtDateHr(r.month, r.day, r.hourOfDay));
    const solarDs    = slice.map(r => r.solarKw);
    const loadDs     = slice.map(r => r.loadKw);
    const batDs      = slice.map(r => r.batKwhEnd);
    const curtDs     = slice.map(r => r.curtailed || 0);
    const solarBotDs = solarDs.map((s, i) => Math.max(0, s - curtDs[i]));
    const dcfcIdx    = slice.reduce((a, r, i) => { if (r.dcfcEvent) a.push(i); return a; }, []);

    const evKwhCaps = evList.slice(0, 4).map(ev => ev.kwh || 1);
    const commonKwhMax = Math.max(batKwhCap, ...evKwhCaps, 1) * 1.05;
    const EV_COLORS = ["#7b2d8b", "#1a6696", "#b05a00", "#1a7a40"];
    const Y2_W = 46;
    const yFit  = scale => { scale.width = 62; };
    const yFit2 = scale => { scale.width = Y2_W; };

    // Helper: right-axis %SOC calibrated to device capacity
    const makeSocAxisY2 = (deviceKwh, kwhMax) => {
      const socMax = deviceKwh > 0 ? kwhMax / deviceKwh * 100 : 100;
      return {
        position: "right",
        title: { display: true, text: "% SOC", font: { size: 9 } },
        min: 0, max: socMax,
        grid: { drawOnChartArea: false },
        afterFit: yFit2,
        afterBuildTicks(axis) {
          axis.ticks = [0, 25, 50, 75, 100]
            .filter(v => v <= socMax + 0.5)
            .map(v => ({ value: v }));
        },
        ticks: { callback: v => (v <= 100.5) ? `${Math.round(v)}%` : null, font: { size: 9 } },
      };
    };

    const allDiagInsts = [evImpDiagP1Inst, evImpDiagBatInst, ...evImpDiagSocInsts.slice(0, nEvs)];

    const centerPlugin = {
      id: "evImpDiagCenter",
      afterDraw(chart) {
        if (centerIdx < 0 || centerIdx >= labels.length) return;
        const { ctx, chartArea, scales } = chart;
        if (!chartArea || !scales.x) return;
        const x = scales.x.getPixelForValue(centerIdx);
        ctx.save(); ctx.strokeStyle = "#996600"; ctx.lineWidth = 2; ctx.setLineDash([6, 3]);
        ctx.beginPath(); ctx.moveTo(x, chartArea.top); ctx.lineTo(x, chartArea.bottom); ctx.stroke();
        ctx.restore();
      },
    };
    const dcfcPlugin = {
      id: "evImpDiagDcfc",
      afterDraw(chart) {
        const { ctx, chartArea, scales } = chart;
        if (!chartArea) return;
        ctx.save(); ctx.strokeStyle = "rgba(192,57,43,0.65)"; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
        for (const i of dcfcIdx) {
          const x = scales.x.getPixelForValue(i);
          ctx.beginPath(); ctx.moveTo(x, chartArea.top); ctx.lineTo(x, chartArea.bottom); ctx.stroke();
        }
        ctx.restore();
      },
    };
    function makeDiagCrosshair(id) {
      return {
        id,
        afterDraw(chart) {
          const idx = evImpDiagCrosshairIdx.current;
          if (idx < 0 || idx >= labels.length) return;
          const { ctx, chartArea, scales } = chart;
          if (!chartArea || !scales.x) return;
          const x = scales.x.getPixelForValue(idx);
          ctx.save(); ctx.strokeStyle = "rgba(40,40,40,0.45)"; ctx.lineWidth = 1; ctx.setLineDash([]);
          ctx.beginPath(); ctx.moveTo(x, chartArea.top); ctx.lineTo(x, chartArea.bottom); ctx.stroke();
          ctx.restore();
        },
        afterEvent(chart, args) {
          const { event } = args;
          if (event.type === "mouseout") {
            if (evImpDiagCrosshairIdx.current !== -1) {
              evImpDiagCrosshairIdx.current = -1; setEvImpDiagHoverRow(null);
              allDiagInsts.forEach(r => { if (r.current) r.current.update("none"); });
            }
            return;
          }
          if (event.type !== "mousemove" || !chart.scales.x) return;
          const idx = Math.max(0, Math.min(Math.round(chart.scales.x.getValueForPixel(event.x)), labels.length - 1));
          if (idx === evImpDiagCrosshairIdx.current) return;
          evImpDiagCrosshairIdx.current = idx; setEvImpDiagHoverRow(slice[idx]);
          allDiagInsts.forEach(r => { if (r.current) r.current.update("none"); });
        },
      };
    }
    const commonOpts = showX => ({
      animation: false, responsive: true, maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: { legend: buildLegend([]), tooltip: { enabled: false } },
      scales: { x: { display: showX, ticks: { maxTicksLimit: 12, font: { size: 9 }, maxRotation: 30 }, grid: { color: "#f0f0f0" } } },
    });
    // Zone-shading plugin: red=WW, green=post-window — derived from per-row flags
    const hasPostWw3 = slice.some(r => r.isPostWindow);
    const wwZonePlugin = {
      id: "evImpDiagZone",
      beforeDraw(chart) {
        const { ctx, chartArea, scales } = chart;
        if (!chartArea) return;
        ctx.save();
        for (let i = 0; i < slice.length - 1; i++) {
          const r = slice[i];
          if (!r.isWorstWindow) continue; // post-window is white like spinup
          const x0 = scales.x.getPixelForValue(i);
          const x1 = scales.x.getPixelForValue(i + 1);
          ctx.fillStyle = "rgba(192,57,43,0.07)";
          ctx.fillRect(x0, chartArea.top, x1 - x0, chartArea.bottom - chartArea.top);
        }
        ctx.restore();
      },
    };
    // Panel 1: Solar + Load (no right axis — padding.right = Y2_W keeps x-axis aligned)
    {
      const opts = commonOpts(false);
      opts.scales.y = { title: { display: true, text: "Power (kW)", font: { size: 10 } }, beginAtZero: true, grid: { color: "#f0f0f0" }, afterFit: yFit };
      opts.layout = { padding: { right: Y2_W } };
      opts.plugins.legend = buildLegend([LEG_WW]);
      evImpDiagP1Inst.current = new Chart(evImpDiagP1Ref.current, {
        type: "line",
        data: { labels, datasets: [
          { label: "Solar kW", data: solarDs, borderColor: "#d48000", backgroundColor: "rgba(244,160,32,0.35)", fill: true, tension: 0.15, pointRadius: 0, borderWidth: 1.5 },
          { label: "Load kW",  data: loadDs,  borderColor: "#204090", backgroundColor: "rgba(48,96,192,0.15)", fill: true, tension: 0.15, pointRadius: 0, borderWidth: 1.5 },
          { label: "", data: solarBotDs, borderColor: "transparent", backgroundColor: "transparent", fill: false, tension: 0.15, pointRadius: 0, borderWidth: 0 },
        ]},
        options: opts,
        plugins: [WHITE_BG, wwZonePlugin, centerPlugin, dcfcPlugin, makeDiagCrosshair("ch_evd1")],
      });
    }
    // Panel 2: Battery SOC — kWh left axis, %SOC right axis, common kWh scale
    {
      const batMinKwh = batKwhCap * BATTERY_MIN_SOC;
      const opts = commonOpts(nEvs === 0);
      opts.scales.y = {
        title: { display: true, text: "kWh", font: { size: 10 } },
        beginAtZero: true, min: 0, max: commonKwhMax, grid: { color: "#f0f0f0" }, afterFit: yFit,
      };
      opts.scales.y2 = makeSocAxisY2(batKwhCap, commonKwhMax);
      opts.plugins.legend = buildLegend([]);
      evImpDiagBatInst.current = new Chart(evImpDiagBatRef.current, {
        type: "line",
        data: { labels, datasets: [
          { label: `Battery (${batKwhCap} kWh)`, data: batDs, borderColor: "#107040", backgroundColor: "rgba(32,160,96,0.35)", fill: true, tension: 0.15, pointRadius: 0, borderWidth: 1.5 },
          { label: `Bat min (${(BATTERY_MIN_SOC*100).toFixed(0)}% = ${batMinKwh.toFixed(1)} kWh)`, data: new Array(slice.length).fill(batMinKwh), borderColor: "#107040", borderDash: [4,3], backgroundColor: "transparent", fill: false, pointRadius: 0, borderWidth: 1 },
        ]},
        options: opts,
        plugins: [WHITE_BG, wwZonePlugin, centerPlugin, dcfcPlugin, makeDiagCrosshair("ch_evd2")],
      });
    }
    // Panels 3..N: per-EV SOC — kWh left axis, %SOC right axis, common kWh scale
    for (let i = 0; i < nEvs; i++) {
      if (!evImpDiagSocRefs[i].current) continue;
      const ev       = evList[i];
      const color    = EV_COLORS[i % 4];
      const evLabel  = evImpact.fleetSummary[i]?.label || ev?.label || `EV ${i+1}`;
      const evKwh    = ev?.kwh || 1;
      const evMinKwh = erDistanceMiles * 1.25 / (ev?.evEfficiency ?? EV_EFFICIENCY);
      const evSocDs  = slice.map(r => r.evAway?.[i] ? null : (r.evKwhEnd?.[i] != null ? r.evKwhEnd[i] : null));
      const awayArr  = slice.map(r => r.evAway?.[i] || false);
      function makeAwayPlugin(pid) {
        return {
          id: pid,
          beforeDraw(chart) {
            const { ctx, chartArea, scales } = chart;
            if (!chartArea) return;
            ctx.save(); ctx.fillStyle = "rgba(100,100,100,0.10)";
            for (let j = 0; j < awayArr.length - 1; j++) {
              if (!awayArr[j]) continue;
              const x0 = scales.x.getPixelForValue(j); const x1 = scales.x.getPixelForValue(j + 1);
              ctx.fillRect(x0, chartArea.top, x1 - x0, chartArea.bottom - chartArea.top);
            }
            ctx.restore();
          },
        };
      }
      const isLast = (i === nEvs - 1);
      const opts = commonOpts(isLast);
      opts.scales.y = {
        title: { display: true, text: `EV ${i+1} — ${evLabel} (${evKwh} kWh)`, font: { size: 10 } },
        beginAtZero: true, min: 0, max: commonKwhMax, grid: { color: "#f0f0f0" }, afterFit: yFit,
      };
      opts.scales.y2 = makeSocAxisY2(evKwh, commonKwhMax);
      opts.plugins.legend = buildLegend([]);
      evImpDiagSocInsts[i].current = new Chart(evImpDiagSocRefs[i].current, {
        type: "line",
        data: { labels, datasets: [
          { label: `${evLabel} (${evKwh} kWh)`, data: evSocDs, borderColor: color, backgroundColor: color.replace(")", ",0.18)").replace("rgb","rgba"), fill: true, tension: 0.15, pointRadius: 0, borderWidth: 1.5, spanGaps: false },
          { label: `${evLabel} min (${evMinKwh.toFixed(1)} kWh)`, data: new Array(slice.length).fill(evMinKwh), borderColor: color, borderDash: [4,3], backgroundColor: "transparent", fill: false, pointRadius: 0, borderWidth: 1 },
        ]},
        options: opts,
        plugins: [WHITE_BG, wwZonePlugin, centerPlugin, makeAwayPlugin(`away_evd${i}`), dcfcPlugin, makeDiagCrosshair(`ch_evd${i+2}`)],
      });
    }
    return () => {
      [evImpDiagP1Inst, evImpDiagBatInst, ...evImpDiagSocInsts].forEach(ref => {
        if (ref.current) { ref.current.destroy(); ref.current = null; }
      });
    };
  }, [evImpact, pinnedEvImpRow, result]);

  // ── Chart: generator dispatch — 3-panel stacked ───────────────────────────

  useEffect(() => {
    // Use the joint-optimisation trace (correct PV+battery+gen config);
    // fall back to the fixed-sweep trace if joint opt didn't produce one.
    const genTrace = result?._genOptResult?.trace || result?._genTrace1;
    const genOpt   = result?._genOptResult?.optimum;
    if (!result || !genTrace) return;
    if (!genP1Ref.current || !genP2Ref.current) return;

    const traceData    = genTrace;
    const spinupHours  = result._cell.spinup_days * 24;
    const wwHours4     = result._cell.window_days * 24;
    const totalH       = traceData.length;
    const displayStart = Math.max(0, spinupHours - 48); // 2-day lead-in — same as PV-only chart
    const slice        = traceData.slice(displayStart, totalH);
    genSliceRef.current = slice; // for onContextMenu position lookup
    const wwMaskStart  = spinupHours - displayStart;
    const wwMaskEnd    = spinupHours + wwHours4 - displayStart; // end of WW only
    const pwMaskStart4 = wwMaskEnd;
    const pwMaskEnd4   = totalH - displayStart;
    const hasPostWw4   = (result._cell.post_window_days || 0) > 0;

    const labels  = slice.map(r => fmtDateHr(r.month, r.day, r.hourOfDay));
    const solarDs = slice.map(r => r.solarKw);
    const loadDs  = slice.map(r => r.loadKw);
    const batDs   = slice.map(r => r.batKwhEnd);
    const genDs   = slice.map(r => r.genKwOut);
    const genRunArr = slice.map(r => r.genRunning);
    // Config labels from joint opt (or fall back to fixed sweep)
    const dispGenKw  = genOpt?.genKw   || result._genTrace1Kw || 0;
    const dispPvKw   = genOpt?.pvKw    || result.optimum?.pvKw || "?";
    const dispBatLbl = genOpt?.batteryLabel || result.optimum?.batteryLabel || "";
    const batKwhCap  = genOpt?.batteryKwh   || result.optimum?.batteryKwh || 20;
    const minSocLine = new Array(slice.length).fill(batKwhCap * BATTERY_MIN_SOC);
    // Y-axis: sized to battery range + allow generator kW to show
    const yMax = Math.max(batKwhCap, ...genDs, dispGenKw) * 1.12;

    const curtDs     = slice.map(r => r.curtailed || 0);
    const hasCurt    = curtDs.some(v => v > 0.01);
    const solarBotDs = solarDs.map((s, i) => Math.max(0, s - curtDs[i]));

    // Curtailment overlay: fills only the tips of PV peaks where storage was full
    function makeGenCurtailPlugin(id) {
      return {
        id,
        afterDatasetsDraw(chart) {
          if (!hasCurt) return;
          const { ctx, scales } = chart;
          if (!scales.x || !scales.y) return;
          const topMeta = chart.getDatasetMeta(0); // solar
          const botMeta = chart.getDatasetMeta(2); // solar − curtailed (hidden dataset)
          if (!topMeta?.data.length || !botMeta?.data.length) return;
          ctx.save();
          ctx.fillStyle = "rgba(140,140,0,0.60)";
          drawCurtainBezier(ctx, topMeta, botMeta, curtDs);
          ctx.restore();
        },
      };
    }

    function makeWwPlugin(id) {
      return {
        id,
        beforeDraw(chart) {
          const { ctx, chartArea, scales } = chart;
          if (!chartArea) return;
          ctx.save();
          const x0 = scales.x.getPixelForValue(Math.max(0, wwMaskStart));
          const x1 = scales.x.getPixelForValue(Math.min(slice.length - 1, wwMaskEnd - 1));
          ctx.fillStyle = "rgba(192,57,43,0.07)";
          ctx.fillRect(x0, chartArea.top, x1 - x0, chartArea.bottom - chartArea.top);
          // Post-window is white like spinup — no tint
          ctx.restore();
        },
      };
    }
    function makeGenRunPlugin(id) {
      return {
        id,
        beforeDraw(chart) {
          const { ctx, chartArea, scales } = chart;
          if (!chartArea) return;
          ctx.save(); ctx.fillStyle = "rgba(192,100,0,0.13)";
          for (let i = 0; i < genRunArr.length - 1; i++) {
            if (!genRunArr[i]) continue;
            const x0 = scales.x.getPixelForValue(i);
            const x1 = scales.x.getPixelForValue(i + 1);
            ctx.fillRect(x0, chartArea.top, x1 - x0, chartArea.bottom - chartArea.top);
          }
          ctx.restore();
        },
      };
    }
    const Y2_W = 46;
    const yFit  = scale => { scale.width = 62; };
    const yFit2 = scale => { scale.width = Y2_W; };
    const makeSocAxisY2 = (deviceKwh, kwhMax) => {
      const socMax = deviceKwh > 0 ? kwhMax / deviceKwh * 100 : 100;
      return {
        position: "right",
        title: { display: true, text: "% SOC", font: { size: 9 } },
        min: 0, max: socMax,
        grid: { drawOnChartArea: false },
        afterBuildTicks(axis) {
          axis.ticks = [0, 25, 50, 75, 100]
            .filter(v => v <= socMax + 0.5)
            .map(v => ({ value: v }));
        },
        ticks: { callback: v => (v <= 100.5) ? `${Math.round(v)}%` : null, font: { size: 9 } },
        afterFit: yFit2,
      };
    };
    const commonOpts = (showX) => ({
      animation: false, responsive: true, maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: { legend: buildLegend([]), tooltip: { bodyFont: { size: 10 }, titleFont: { size: 10 } } },
      scales: { x: { display: showX, ticks: { maxTicksLimit: 14, font: { size: 9 }, maxRotation: 30 }, grid: { color: "#f0f0f0", tickLength: 6, tickColor: "#aaa" } } },
    });

    // Crosshair plugin (synchronized line across both gen panels + side-panel values)
    function makeGenCrosshair(id) {
      return {
        id,
        afterDraw(chart) {
          const idx = genCrosshairIdx.current;
          if (idx < 0 || idx >= labels.length) return;
          const { ctx, chartArea, scales } = chart;
          if (!chartArea || !scales.x) return;
          const x = scales.x.getPixelForValue(idx);
          ctx.save(); ctx.strokeStyle = "rgba(40,40,40,0.45)"; ctx.lineWidth = 1; ctx.setLineDash([]);
          ctx.beginPath(); ctx.moveTo(x, chartArea.top); ctx.lineTo(x, chartArea.bottom); ctx.stroke();
          ctx.restore();
        },
        afterEvent(chart, args) {
          const { event } = args;
          if (event.type === "mouseout") {
            if (genCrosshairIdx.current !== -1) {
              genCrosshairIdx.current = -1; genHoverRowRef.current = null; setGenHoverRow(null);
              [genP1Inst, genP2Inst].forEach(r => { if (r.current) r.current.update("none"); });
            }
            return;
          }
          if (event.type !== "mousemove" || !chart.scales.x) return;
          const idx = Math.max(0, Math.min(Math.round(chart.scales.x.getValueForPixel(event.x)), labels.length - 1));
          if (idx === genCrosshairIdx.current) return;
          genCrosshairIdx.current = idx; genHoverRowRef.current = slice[idx]; setGenHoverRow(slice[idx]);
          [genP1Inst, genP2Inst].forEach(r => { if (r.current) r.current.update("none"); });
        },
      };
    }

    [genP1Inst, genP2Inst, genP3Inst].forEach(ref => { if (ref.current) { ref.current.destroy(); ref.current = null; } });

    // Panel 1: Solar + Load (no-EV context; x-axis hidden)
    // layout.padding.right matches Y2_W so plot area aligns with Panel 2's kWh+%SOC axes.
    { const opts = commonOpts(false); opts.scales.y = { title: { display: true, text: "Power (kW)", font: { size: 10 } }, beginAtZero: true, grid: { color: "#f0f0f0" }, afterFit: yFit };
      opts.layout = { padding: { right: Y2_W } };
      const LEG_CURT_G = { text: "Curtailed solar", fillStyle: "rgba(140,140,0,0.60)", strokeStyle: "rgba(0,0,0,0)", lineWidth: 0, lineDash: [], hidden: false, datasetIndex: null, pointStyle: "rect" };
      const p1gLeg = [LEG_WW]; if (hasCurt) p1gLeg.push(LEG_CURT_G);
      opts.plugins.legend = buildLegend(p1gLeg);
      opts.plugins.tooltip = { enabled: false };
      genP1Inst.current = new Chart(genP1Ref.current, { type: "line",
        data: { labels, datasets: [
          { label: "Solar kW", data: solarDs,    borderColor: "#d48000", backgroundColor: "rgba(244,160,32,0.35)", fill: true,  tension: 0.15, pointRadius: 0, borderWidth: 1.5 },
          { label: "Load kW",  data: loadDs,     borderColor: "#204090", backgroundColor: "rgba(48,96,192,0.15)",  fill: true,  tension: 0.15, pointRadius: 0, borderWidth: 1.5 },
          { label: "", data: solarBotDs, borderColor: "transparent", backgroundColor: "transparent", fill: false, tension: 0.15, pointRadius: 0, borderWidth: 0, _curtBot: true },
        ]}, options: opts, plugins: [WHITE_BG, makeWwPlugin("gww1"), makeGenCurtailPlugin("gcurt1"), makeGenCrosshair("ch_gen1")] });
    }

    // Panel 2: Battery kWh (left) + %SOC (right) + generator output overlay.
    // Right axis calibrated to battery capacity; generator kW rides on the same kWh scale
    // (numerically similar for typical 5–10 kW gen / 10–30 kWh battery combinations).
    { const batMinKwh = batKwhCap * BATTERY_MIN_SOC;
      const opts = commonOpts(true);
      opts.scales.y  = { title: { display: true, text: "Battery (kWh) / Generator (kW)", font: { size: 10 } }, beginAtZero: true, max: yMax, grid: { color: "#f0f0f0" }, afterFit: yFit };
      opts.scales.y2 = makeSocAxisY2(batKwhCap, yMax);
      opts.plugins.legend = buildLegend([LEG_WW, LEG_GEN]);
      opts.plugins.tooltip = { enabled: false };
      genP2Inst.current = new Chart(genP2Ref.current, { type: "line",
        data: { labels, datasets: [
          { label: `Battery (${batKwhCap} kWh)`,                              data: batDs,      borderColor: "#107040", backgroundColor: "rgba(32,160,96,0.35)",  fill: true, tension: 0.15, pointRadius: 0, borderWidth: 1.5 },
          { label: `Bat min (${(BATTERY_MIN_SOC*100).toFixed(0)}% = ${batMinKwh.toFixed(1)} kWh)`, data: minSocLine, borderColor: "#107040", borderDash: [4,3], backgroundColor: "transparent", fill: false, pointRadius: 0, borderWidth: 1 },
          { label: `Generator output (${dispGenKw} kW)`,                      data: genDs,      borderColor: "#802000", backgroundColor: "rgba(192,64,0,0.30)", fill: true, stepped: "before", pointRadius: 0, borderWidth: 1.5 },
        ]}, options: opts, plugins: [WHITE_BG, makeWwPlugin("gww2"), makeGenRunPlugin("grun2"), makeGenCrosshair("ch_gen2")] });
    }

    return () => { [genP1Inst, genP2Inst, genP3Inst].forEach(ref => { if (ref.current) { ref.current.destroy(); ref.current = null; } }); };
  }, [result]);


  // ── Chart: detail view (Dec 17-18 default; ±24h around last right-click) ────
  useEffect(() => {
    if (!result || !result._traceData) return;
    if (!diagP1Ref.current || !diagP2Ref.current) return;

    // Determine active trace and type based on which chart was right-clicked last.
    // Only one of the three pinned states is set at a time (onContextMenu clears the others).
    const traceType  = pinnedGenRow ? "gen" : "ev";
    const activeTrace = pinnedGenRow  ? (result._genTrace1 || result._traceData)
                      : result._traceData;
    const activePinned = pinnedEvRow || pinnedGenRow;

    let diagRows;
    if (activePinned) {
      const h = activePinned.h;
      const start = Math.max(0, h - 24);
      const end   = Math.min(activeTrace.length - 1, h + 24);
      diagRows = activeTrace.slice(start, end + 1);
    } else {
      // Default: Dec 17-18 from EV trace
      diagRows = result._traceData.filter(r => r.month === 12 && (r.day === 17 || r.day === 18));
    }
    if (diagRows.length === 0) return;
    const dec = diagRows;

    [diagP1Inst, diagP2Inst].forEach(ref => { if (ref.current) { ref.current.destroy(); ref.current = null; } });

    const labels     = dec.map(r => `${r.month}/${r.day} ${String(r.hourOfDay).padStart(2,"0")}:00`);
    const solarDs    = dec.map(r => parseFloat(r.solarKw.toFixed(3)));
    const loadDs     = dec.map(r => parseFloat(r.loadKw.toFixed(3)));
    const batDs      = dec.map(r => parseFloat(r.batKwhEnd.toFixed(3)));
    const curtDsDiag    = dec.map(r => parseFloat((r.curtailed || 0).toFixed(3)));
    const hasDiagCurt   = curtDsDiag.some(v => v > 0.01);
    const solarBotDsDiag = solarDs.map((s, i) => Math.max(0, parseFloat((s - curtDsDiag[i]).toFixed(3))));
    // EV-trace extras
    const evDs    = (traceType === "ev" && dec[0] && dec[0].evKwhEnd && dec[0].evKwhEnd.length > 0)
                    ? dec.map(r => parseFloat(r.evKwhEnd[0].toFixed(3))) : null;
    // Gen-trace extras
    const genDs   = (traceType !== "ev") ? dec.map(r => parseFloat((r.genKwOut || 0).toFixed(3))) : null;
    const batKwhCap = result.optimum.batteryKwh;

    const yFitD = scale => { scale.width = 62; };
    const diagOpts = (showX) => ({
      animation: false, responsive: true, maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: { legend: buildLegend([]), tooltip: { enabled: false } },
      scales: { x: { display: showX, ticks: { maxTicksLimit: 24, font: { size: 9 }, maxRotation: 45 }, grid: { color: "#f0f0f0", tickLength: 6, tickColor: "#aaa" } } },
    });

    // Crosshair plugin — synchronized across both diag panels, updates hover sidebar
    function makeDiagCrosshair(id) {
      return {
        id,
        afterDraw(chart) {
          const idx = diagCrosshairIdx.current;
          if (idx < 0 || idx >= labels.length) return;
          const { ctx, chartArea, scales } = chart;
          if (!chartArea || !scales.x) return;
          const x = scales.x.getPixelForValue(idx);
          ctx.save(); ctx.strokeStyle = "rgba(40,40,40,0.45)"; ctx.lineWidth = 1; ctx.setLineDash([]);
          ctx.beginPath(); ctx.moveTo(x, chartArea.top); ctx.lineTo(x, chartArea.bottom); ctx.stroke();
          ctx.restore();
        },
        afterEvent(chart, args) {
          const { event } = args;
          if (event.type === "mouseout") {
            if (diagCrosshairIdx.current !== -1) {
              diagCrosshairIdx.current = -1; setDiagHoverRow(null);
              [diagP1Inst, diagP2Inst].forEach(r => { if (r.current) r.current.update("none"); });
            }
            return;
          }
          if (event.type !== "mousemove" || !chart.scales.x) return;
          const idx = Math.max(0, Math.min(Math.round(chart.scales.x.getValueForPixel(event.x)), labels.length - 1));
          if (idx === diagCrosshairIdx.current) return;
          diagCrosshairIdx.current = idx; setDiagHoverRow(dec[idx] || null);
          [diagP1Inst, diagP2Inst].forEach(r => { if (r.current) r.current.update("none"); });
        },
      };
    }

    // Curtailment overlay plugin for panel 1 — smooth bezier fill
    const diagCurtailPlugin = {
      id: "diagCurtFill",
      afterDatasetsDraw(chart) {
        if (!hasDiagCurt) return;
        const { ctx, scales } = chart;
        if (!scales.x || !scales.y) return;
        const topMeta = chart.getDatasetMeta(0); // solar
        const botMeta = chart.getDatasetMeta(2); // solar − curtailed (hidden dataset)
        if (!topMeta?.data.length || !botMeta?.data.length) return;
        ctx.save();
        ctx.fillStyle = "rgba(140,140,0,0.60)";
        drawCurtainBezier(ctx, topMeta, botMeta, curtDsDiag);
        ctx.restore();
      },
    };

    // Panel 1: Solar vs Load + curtailment overlay
    { const opts = diagOpts(false);
      opts.scales.y = { title: { display: true, text: "Power (kW)", font: { size: 10 } }, beginAtZero: true, grid: { color: "#f0f0f0" }, afterFit: yFitD };
      const LEG_CURT_D = { text: "Curtailed solar", fillStyle: "rgba(140,140,0,0.45)", strokeStyle: "rgba(0,0,0,0)", lineWidth: 0, lineDash: [], hidden: false, datasetIndex: null, pointStyle: "rect" };
      opts.plugins.legend = buildLegend(hasDiagCurt ? [LEG_CURT_D] : []);
      diagP1Inst.current = new Chart(diagP1Ref.current, { type: "line",
        data: { labels, datasets: [
          { label: "Solar kW", data: solarDs,       borderColor: "#d48000", backgroundColor: "rgba(244,160,32,0.35)", fill: true,  tension: 0, pointRadius: 0, borderWidth: 1.5 },
          { label: "Load kW",  data: loadDs,        borderColor: "#204090", backgroundColor: "rgba(48,96,192,0.15)",  fill: true,  tension: 0, pointRadius: 0, borderWidth: 1.5 },
          { label: "", data: solarBotDsDiag, borderColor: "transparent", backgroundColor: "transparent", fill: false, tension: 0, pointRadius: 0, borderWidth: 0, _curtBot: true },
        ]}, options: opts, plugins: [WHITE_BG, diagCurtailPlugin, makeDiagCrosshair("dch1")] });
    }

    // Panel 2: Battery SOC + EV SOC (ev trace) OR Battery SOC + Generator output (gen/bridge trace)
    { const p2extras = evDs ? evDs.reduce((a,b) => Math.max(a,b), 0)
                            : genDs ? Math.max(...genDs) : 0;
      const yMax = Math.max(batKwhCap, ...batDs, p2extras) * 1.08;
      const opts = diagOpts(true);
      const p2Label = traceType === "ev" ? "Energy (kWh)" : "Energy (kWh) / Generator (kW)";
      opts.scales.y = { title: { display: true, text: p2Label, font: { size: 10 } }, beginAtZero: true, max: yMax, grid: { color: "#f0f0f0" }, afterFit: yFitD };
      const minSocLine = dec.map(() => parseFloat((batKwhCap * BATTERY_MIN_SOC).toFixed(3)));
      const batLabel = `Battery SOC (cap ${batKwhCap} kWh)`;
      const datasets = [
        { label: batLabel, data: batDs, borderColor: "#107040", backgroundColor: "rgba(32,160,96,0.25)", fill: true, tension: 0, pointRadius: 0, borderWidth: 1.5 },
        { label: `Bat min SOC (${(BATTERY_MIN_SOC*100).toFixed(0)}%)`, data: minSocLine, borderColor: "#107040", borderDash: [4,3], backgroundColor: "transparent", fill: false, pointRadius: 0, borderWidth: 1 },
      ];
      if (evDs)  datasets.push({ label: "EV SOC (kWh)",  data: evDs,  borderColor: "#7b2d8b", backgroundColor: "rgba(123,45,139,0.15)", fill: true, tension: 0, pointRadius: 0, borderWidth: 1.5 });
      if (genDs) datasets.push({ label: "Generator (kW)", data: genDs, borderColor: "#802000", backgroundColor: "rgba(192,64,0,0.25)",   fill: true, stepped: "before", pointRadius: 0, borderWidth: 1.5 });
      opts.plugins.legend = buildLegend([]);
      diagP2Inst.current = new Chart(diagP2Ref.current, { type: "line",
        data: { labels, datasets }, options: opts, plugins: [WHITE_BG, makeDiagCrosshair("dch2")] });
    }

    return () => { [diagP1Inst, diagP2Inst].forEach(ref => { if (ref.current) { ref.current.destroy(); ref.current = null; } }); };
  }, [result, pinnedEvRow, pinnedGenRow]);

  // ── Native contextmenu capture listeners for right-click detail pin ─────────
  // React synthetic events can miss right-clicks on Chart.js canvases; native
  // capture-phase listeners fire before Chart.js can intercept the event.
  useEffect(() => {
    const el = evChartContainerRef.current;
    if (!el) return;
    const handler = e => {
      e.preventDefault();
      const row = evHoverRowRef.current;
      if (row) { setPinnedEvRow(row); setPinnedGenRow(null); }
    };
    el.addEventListener('contextmenu', handler, { capture: true });
    return () => el.removeEventListener('contextmenu', handler, { capture: true });
  }, [result]); // [result]: chart container div only exists after result is set

  useEffect(() => {
    const el = genChartContainerRef.current;
    if (!el) return;
    const handler = e => {
      e.preventDefault();
      const row = genHoverRowRef.current;
      if (row) { setPinnedGenRow(row); setPinnedEvRow(null); }
    };
    el.addEventListener('contextmenu', handler, { capture: true });
    return () => el.removeEventListener('contextmenu', handler, { capture: true });
  }, [result]); // [result]: chart container div only exists after result is set

  useEffect(() => {
    const el = evImpChartContainerRef.current;
    if (!el) return;
    const handler = e => {
      e.preventDefault();
      const row = evImpHoverRowRef.current;
      if (row) { setPinnedEvImpRow(row); }
    };
    el.addEventListener('contextmenu', handler, { capture: true });
    return () => el.removeEventListener('contextmenu', handler, { capture: true });
  }, [evImpact]); // [evImpact]: chart container div only exists after EV impact result is set

  // ── Derived state ─────────────────────────────────────────────────────────

  const canRun = nsrdbStatus === "ok" && apiKey.trim().length > 0
    && mounts.length > 0 && selectedBatteries.size > 0 && !running;

  const ww = result && result.worstWindow;
  const hasEv = !!(result && result._traceData && result._traceData[0] && result._traceData[0].evKwhEnd.length > 0);

  // ── Render ────────────────────────────────────────────────────────────────

  // Help modal style helpers
  const Hd2 = { fontSize:"14px", fontWeight:700, color:"#1a4a7a", marginTop:"18px", marginBottom:"4px", borderBottom:"1px solid #dce3ec", paddingBottom:"3px" };
  const Hd3 = { fontSize:"13px", fontWeight:700, color:"#333", marginTop:"12px", marginBottom:"3px" };
  const TBL = { width:"100%", borderCollapse:"collapse", marginTop:"4px", marginBottom:"6px", fontSize:"12px" };
  const Tr  = ({ l, v }) => (
    <tr>
      <td style={{ padding:"3px 8px 3px 0", verticalAlign:"top", width:"34%", color:"#555", fontWeight:500 }}>{l}</td>
      <td style={{ padding:"3px 0 3px 8px", verticalAlign:"top", borderLeft:"2px solid #e8edf3" }}>{v}</td>
    </tr>
  );

  return (
    <div>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        input:focus, select:focus { border-color: #1a4a7a !important; }
        button:disabled { opacity: 0.5; cursor: not-allowed; }
        /* Remove number-input spinners so values are never obscured */
        input[type=number]::-webkit-inner-spin-button,
        input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
        input[type=number] { -moz-appearance: textfield; appearance: textfield; }
      `}</style>

      {/* Top bar */}
      <div style={S.topBar}>
        <span style={S.orgName}>CCE / Makello</span>
        <span style={S.toolTitle}>Off-Grid Optimizer</span>
        <span style={S.version}>v0.4.138</span>
        <span style={S.version}>MOD-06</span>
        <span style={{...S.tagline, marginLeft:"auto", display:"flex", alignItems:"center", gap:"10px"}}>
          <button
            onClick={() => setShowHelp(true)}
            title="User manual"
            style={{ background:"rgba(255,255,255,0.18)", border:"1px solid rgba(255,255,255,0.4)",
                     color:"#fff", borderRadius:"50%", width:"24px", height:"24px", fontSize:"13px",
                     fontWeight:700, cursor:"pointer", lineHeight:1, padding:0 }}>
            ?
          </button>
          <a href="https://tools.cc-energy.org/index.html"
             style={{color:"rgba(255,255,255,0.7)",textDecoration:"none",fontSize:"12px"}}>
            ← All Tools
          </a>
        </span>
      </div>

      <div style={S.container}>

        {/* NSRDB status bar */}
        {nsrdbStatus === "loading" && (
          <div style={{ ...S.statusMsg("warn"), marginBottom: "12px" }}>
            <span style={S.spinner} /> Loading NSRDB stress window data (16.5 MB)...
          </div>
        )}
        {nsrdbStatus === "error" && (
          <div style={{ ...S.statusMsg("error"), marginBottom: "12px" }}>
            Failed to load nsrdb_stress_window.json: {nsrdbError}
            <br />Ensure the file is in the same directory and you are running via{" "}
            <code>python3 -m http.server 8080</code> (not file://).
          </div>
        )}
        {/* nsrdbStatus === "ok" is silent — only loading and error states are shown */}

        <div style={S.layout}>
          {/* ── LEFT PANEL: inputs ── */}
          <div style={S.leftPanel}>

            {/* A) Restore/Reset block + last-saved time — at TOP */}
            {/* Hidden file input for summary CSV restore */}
            <input type="file" accept=".csv" ref={restoreFileRef} style={{ display: "none" }}
              onChange={handleRestoreFile} />
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <button style={{ ...S.btnSmall, flex: 1 }} onClick={() => restoreFileRef.current?.click()}>
                {btnFeedback === "restored" ? "✓ Restored" : "📂 Restore"}
              </button>
              <button style={{ ...S.btnSmall, flex: 1, background: "#721c24", color: "#fff" }}
                onClick={() => { if (window.confirm("Reset all inputs to factory defaults?")) handleResetDefaults(); }}>
                Reset defaults
              </button>
            </div>
            {lastSavedTime && (
              <div style={{ fontSize: "11px", color: "#888", marginTop: "-4px" }}>
                Summary CSV downloaded at {lastSavedTime} — open it with "📂 Restore" to reload these inputs.
              </div>
            )}

            {/* B) Site */}
            <div style={S.card}>
              <div style={S.cardTitle}>Site</div>
              <div style={S.fieldRow}>
                <label style={S.label}>Site Name</label>
                <input style={S.input} value={siteName} onChange={e => setSiteName(e.target.value)} />
              </div>
              <div style={S.fieldRow}>
                <label style={S.label}>Address</label>
                <div style={{ display: "flex", gap: "6px" }}>
                  <input style={{ ...S.input, flex: 1 }} value={geoAddress}
                    onChange={e => setGeoAddress(e.target.value)}
                    placeholder="123 Main St, Anytown CA 90000"
                    onKeyDown={e => e.key === "Enter" && handleGeocode()} />
                  <button style={{ ...S.btnSmall, whiteSpace: "nowrap" }} onClick={handleGeocode}>Look up</button>
                </div>
                {geoStatus && <div style={{ fontSize: "11px", color: "#555", marginTop: "3px" }}>{geoStatus}</div>}
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                <div style={{ ...S.fieldRow, flex: 1 }}>
                  <label style={S.label}>Latitude</label>
                  <input style={S.input} type="number" step="0.001" value={lat}
                    onChange={e => setLat(parseFloat(e.target.value))} />
                </div>
                <div style={{ ...S.fieldRow, flex: 1 }}>
                  <label style={S.label}>Longitude</label>
                  <input style={S.input} type="number" step="0.001" value={lon}
                    onChange={e => setLon(parseFloat(e.target.value))} />
                </div>
              </div>
            </div>

            {/* C) Building (renamed from "Building Code — Title 24 §150.1-C") */}
            <div style={S.card}>
              <div style={S.cardTitle}>Building</div>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <div style={{ ...S.fieldRow, flex: "0 0 auto", minWidth: "90px" }}>
                  <label style={S.label}>Climate Zone</label>
                  <select style={{ ...S.select, width: "80px" }} value={climateZone}
                    onChange={e => setClimateZone(parseInt(e.target.value))}>
                    {Array.from({ length: 16 }, (_, i) => i + 1).map(cz => (
                      <option key={cz} value={cz}>CZ {cz}</option>
                    ))}
                  </select>
                </div>
                <div style={{ ...S.fieldRow, flex: 1, minWidth: "120px" }}>
                  <label style={S.label}>Cond. floor area (sqft)</label>
                  <input style={S.input} type="number" step="50" value={cfa}
                    onChange={e => setCfa(parseInt(e.target.value) || 0)} />
                </div>
                <div style={{ ...S.fieldRow, flex: "0 0 auto", minWidth: "80px" }}>
                  <label style={S.label}>Dwelling units</label>
                  <input style={S.input} type="number" step="1" min="1" value={ndu}
                    onChange={e => setNdu(parseInt(e.target.value) || 1)} />
                </div>
              </div>
              <div style={{ ...S.fieldRow, marginTop: "6px" }}>
                <label style={S.label}>
                  Critical load panel — est. daily energy (kWh/day)
                  <span style={{ fontWeight: "normal", color: "#555" }}>
                    &nbsp;heat + fridge + 1 lighting + 1 outlet circuit
                  </span>
                </label>
                <input style={{ ...S.input, maxWidth: "100px" }} type="number" step="0.5" min="1"
                  value={criticalLoadKwhPerDay}
                  onChange={e => setCriticalLoadKwhPerDay(parseFloat(e.target.value) || 1)} />
              </div>
              {(() => {
                const czC      = TABLE_150_1_C[climateZone] || TABLE_150_1_C[10];
                const pv       = Math.round(((cfa * czC.A) / 1000 + ndu * czC.B) * 100) / 100;
                const batMin   = Math.round(criticalLoadKwhPerDay * 3 * 10) / 10;
                const genSzArr = genSizesStr.split(",").map(s => parseFloat(s.trim())).filter(v => !isNaN(v) && v >= 10) // 10 kW minimum — only size with AHJ-acceptable soundproofing;
                const minGen   = genSzArr.length > 0 ? Math.min(...genSzArr) : 10;
                const batWithGen = Math.round(Math.max(0, criticalLoadKwhPerDay * 3 - minGen * genHrLimit) / (1 - BATTERY_MIN_SOC) * 10) / 10;
                return (
                  <div style={{ fontSize: "11px", color: "#1a4a7a", marginTop: "6px", background: "#e8f0f8", borderRadius: "4px", padding: "6px 8px", lineHeight: 1.8 }}>
                    <div>① PV min: <strong>{pv} kWdc</strong> (CFA × {czC.A} / 1000 + {ndu} × {czC.B})</div>
                    <div>② Battery min (3-day critical load test):
                      &nbsp;Battery-only: <strong>{batMin} kWh</strong>
                      &nbsp;·&nbsp; With {minGen} kW gen: <strong>{batWithGen} kWh</strong>
                    </div>
                    <div>③ Generator: ≤ {genHrLimit} hr/yr normal · ≤ {emergencyGenHrLimit} hr worst-window</div>
                  </div>
                );
              })()}
            </div>

            {/* D) Load Profile — daytime shift moved to BOTTOM */}
            <div style={S.card}>
              <div style={S.cardTitle}>Load Profile</div>
              <div style={S.radioRow}>
                <input type="radio" id="lm-syn" name="loadMode" value="synthetic"
                  checked={loadMode === "synthetic"} onChange={() => setLoadMode("synthetic")} />
                <label htmlFor="lm-syn" style={{ fontSize: "13px" }}>Use synthetic profile</label>
              </div>
              <div style={S.radioRow}>
                <input type="radio" id="lm-up" name="loadMode" value="upload"
                  checked={loadMode === "upload"} onChange={() => setLoadMode("upload")} />
                <label htmlFor="lm-up" style={{ fontSize: "13px" }}>Upload Green Button CSV</label>
              </div>
              {loadMode === "synthetic" && (
                <div style={S.fieldRow}>
                  <label style={S.label}>Annual kWh</label>
                  <input style={S.input} type="number" step="100" value={annualKwh}
                    onChange={e => setAnnualKwh(parseFloat(e.target.value))} />
                </div>
              )}
              {loadMode === "upload" && (
                <div style={S.fieldRow}>
                  <label style={S.label}>Green Button CSV file</label>
                  <input type="file" accept=".csv,.txt" onChange={handleFileUpload} style={{ fontSize: "12px" }} />
                  {uploadedFileName && (
                    <div style={{ fontSize: "12px", fontWeight: 600, color: "#155724", marginTop: "3px" }}>
                      📄 {uploadedFileName}
                    </div>
                  )}
                  {!uploadedFileName && uploadedLoad && (
                    <div style={{ fontSize: "11px", color: "#888", marginTop: "3px", fontStyle: "italic" }}>
                      (filename not saved — re-upload to display)
                    </div>
                  )}
                  {uploadStatus && (
                    <div style={{ fontSize: "11px", color: uploadedLoad ? "#155724" : "#721c24", marginTop: "2px" }}>
                      {uploadStatus}
                    </div>
                  )}
                </div>
              )}
              <div style={{ marginTop: "8px", paddingTop: "8px", borderTop: "1px solid #e9ecef" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                  <label style={{ ...S.label, whiteSpace: "nowrap" }}>Daytime shift</label>
                  <span style={{ fontSize: "13px", fontWeight: 700, color: daytimeShiftPct > 0 ? "#107040" : "#aaa", minWidth: "36px", textAlign: "right" }}>
                    {daytimeShiftPct}%
                  </span>
                </div>
                <input type="range" min="0" max="20" step="1" value={daytimeShiftPct}
                  onChange={e => setDaytimeShiftPct(parseInt(e.target.value))}
                  style={{ width: "100%", accentColor: "#107040" }} />
                <div style={{ fontSize: "10px", color: "#888", marginTop: "2px", lineHeight: 1.4 }}>
                  Move this % of 6 PM–midnight load to 9 AM–3 PM (smart appliances / mindful use). Default: 0%.
                </div>
              </div>
            </div>

            {/* E) Financial */}
            <div style={S.card}>
              <div style={S.cardTitle}>Financial</div>
              <div style={{ display: "flex", gap: "8px" }}>
                <div style={{ ...S.fieldRow, flex: 1 }}>
                  <label style={S.label}>NPV years</label>
                  <input style={S.input} type="number" step="1" value={npvYears}
                    onChange={e => setNpvYears(parseInt(e.target.value))} />
                </div>
                <div style={{ ...S.fieldRow, flex: 1 }}>
                  <label style={S.label}>Discount rate %</label>
                  <input style={S.input} type="number" step="0.5" value={discountRate}
                    onChange={e => setDiscountRate(parseFloat(e.target.value))} />
                </div>
              </div>
            </div>

            {/* F) EV Fleet (Phase 2 divider removed) */}
            <div style={S.card}>
              <div style={S.cardTitle}>EV Fleet (0–3 vehicles)</div>
              {evList.length === 0 && (
                <div style={{ fontSize: "12px", color: "#888", marginBottom: "8px" }}>
                  No EVs configured.
                </div>
              )}
              {evList.map((ev, i) => (
                <div key={i} style={{ border: "1px solid #c5d3e0", borderRadius: "6px", padding: "8px 10px", marginBottom: "8px", background: "#f8fbff" }}>
                  {/* Row 1: Battery + travel frequency + trip distance */}
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 700, fontSize: "12px", minWidth: "32px" }}>EV {i + 1}</span>
                    <label style={{ ...S.label, minWidth: "auto" }}>Battery kWh</label>
                    <input style={{ ...S.input, width: "56px" }} type="number" step="1" value={ev.kwh}
                      onChange={e => updateEv(i, "kwh", parseFloat(e.target.value) || 0)} />
                    <label style={{ ...S.label, minWidth: "auto" }}>Trips/wk</label>
                    <input style={{ ...S.input, width: "60px" }} type="number" step="0.5" min="0" max="7"
                      value={ev.tripsPerWeek ?? 5}
                      onChange={e => updateEv(i, "tripsPerWeek", parseFloat(e.target.value) || 0)}
                      title="0=always home, 0.5=biweekly, 5=weekday commute, 5.5=weekday+every-other-weekend, 7=daily" />
                    <label style={{ ...S.label, minWidth: "auto" }}>Trip mi (one-way)</label>
                    <input style={{ ...S.input, width: "60px" }} type="number" step="1" min="0"
                      value={ev.tripMiles ?? 15}
                      onChange={e => updateEv(i, "tripMiles", parseFloat(e.target.value) || 0)} />
                    <label style={{ ...S.label, minWidth: "auto" }}>Efficiency mi/kWh</label>
                    <input style={{ ...S.input, width: "64px" }} type="number" step="0.1" min="1" max="8"
                      value={ev.evEfficiency ?? 3.5}
                      onChange={e => updateEv(i, "evEfficiency", parseFloat(e.target.value) || 3.5)}
                      title="Vehicle efficiency in miles per kWh (e.g. 3.5 = ~286 Wh/mi). Used for driving energy and emergency-range minimum." />
                    <button style={{ ...S.btnSmall, marginLeft: "auto", background: "#721c24", color: "#fff", padding: "2px 8px", fontSize: "11px" }}
                      onClick={() => removeEv(i)}>Remove</button>
                  </div>
                  {/* Row 1b: V2H bidirectional */}
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "5px" }}>
                    <input type="checkbox" id={`ev_v2h_${i}`}
                      checked={ev.canV2G === true}
                      onChange={e => updateEv(i, "canV2G", e.target.checked)} />
                    <label htmlFor={`ev_v2h_${i}`} style={{ fontSize: "12px", cursor: "pointer", userSelect: "none" }}>
                      V2H bidirectional (can discharge to home)
                    </label>
                  </div>
                  {/* Row 2: Destination charging */}
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "6px" }}>
                    <label style={{ ...S.label, minWidth: "auto" }}>Dest charging</label>
                    <select style={{ ...S.select, width: "160px" }} value={ev.destCharging || "none"}
                      onChange={e => updateEv(i, "destCharging", e.target.value)}>
                      <option value="none">None (home only)</option>
                      <option value="l2_free">Free L2 at destination</option>
                      <option value="l2_paid">Paid L2 at destination</option>
                    </select>
                    {ev.destCharging === "l2_paid" && (
                      <>
                        <label style={{ ...S.label, minWidth: "auto" }}>Rate $/kWh</label>
                        <input style={{ ...S.input, width: "68px" }} type="number" step="0.01" min="0"
                          value={ev.destChargeRate || 0.25}
                          onChange={e => updateEv(i, "destChargeRate", parseFloat(e.target.value) || 0)} />
                      </>
                    )}
                  </div>
                  {/* Row 3: Planned en-route DCFC */}
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "4px", flexWrap: "wrap" }}>
                    <label style={{ ...S.label, minWidth: "auto" }}>Planned DCFC/yr</label>
                    <input style={{ ...S.input, width: "56px" }} type="number" step="1" min="0"
                      value={ev.dcfcPlannedPerYear || 0}
                      onChange={e => updateEv(i, "dcfcPlannedPerYear", parseInt(e.target.value) || 0)}
                      title="En-route planned fast-charge stops driver accepts per year (0 = home charging only)" />
                    <span style={{ fontSize: "11px", color: "#888" }}>planned stops/yr this driver accepts</span>
                  </div>
                  {/* Row 4: Charge targets */}
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "4px", flexWrap: "wrap" }}>
                    <label style={{ ...S.label, minWidth: "auto" }}>DCFC target</label>
                    <input style={{ ...S.input, width: "56px" }} type="number" step="1" min="50" max="100"
                      value={Math.round((ev.dcfcTargetPct ?? 0.80) * 100)}
                      onChange={e => updateEv(i, "dcfcTargetPct", Math.max(0.5, Math.min(1.0, (parseInt(e.target.value) || 80) / 100)))}
                      title="DC fast charger target SOC % (industry standard 80 %)" />
                    <span style={{ fontSize: "11px", color: "#888" }}>%</span>
                    <label style={{ ...S.label, minWidth: "auto", marginLeft: "8px" }}>Dest L2 target</label>
                    <input style={{ ...S.input, width: "56px" }} type="number" step="1" min="50" max="100"
                      value={Math.round((ev.destL2TargetPct ?? 0.95) * 100)}
                      onChange={e => updateEv(i, "destL2TargetPct", Math.max(0.5, Math.min(1.0, (parseInt(e.target.value) || 95) / 100)))}
                      title="Destination L2 charger target SOC % (hotel / workplace overnight, default 95 %)" />
                    <span style={{ fontSize: "11px", color: "#888" }}>%</span>
                  </div>
                  {/* Summary hint — mirrors evConfigToDispatch defaults exactly */}
                  <div style={{ fontSize: "11px", color: "#888", marginTop: "4px" }}>
                    {(() => {
                      const disp = evConfigToDispatch(ev);
                      const ann  = Math.round(disp.tripsPerWeek * 52 * disp.tripMiles * 2);
                      const rtKwh = (disp.roundTripKwh).toFixed(1);
                      const erMin = (erDistanceMiles * 1.25 / disp.efficiency).toFixed(1);
                      if (disp.tripsPerWeek === 0) return `Always home — ER min ${erMin} kWh`;
                      return `≈ ${ann.toLocaleString()} mi/yr · ${rtKwh} kWh/trip round-trip · ER min ${erMin} kWh · departs 07:00`;
                    })()}
                  </div>
                </div>
              ))}
              {evList.length < 3 && (
                <button style={{ ...S.btnSmall, marginBottom: "6px" }} onClick={addEv}>+ Add EV</button>
              )}
              <div style={{ fontSize: "11px", color: "#888", marginTop: "4px", fontStyle: "italic" }}>
                Trips/wk: 0=always home · 0.5=biweekly · 5=weekday · 5.5=weekday+every-other-weekend · 7=daily
              </div>
            </div>

            {/* G) EV Charging Parameters */}
            <div style={S.card}>
              <div style={S.cardTitle}>EV Charging Parameters</div>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <div style={{ ...S.fieldRow, flex: 1, minWidth: "130px" }}>
                  <label style={S.label}>En-route DCFC stops/yr (fleet max)</label>
                  <input style={S.input} type="number" step="1" min="0" value={maxEnrouteDcfc}
                    onChange={e => setMaxEnrouteDcfc(parseInt(e.target.value) || 0)}
                    title="DCFC added to an already-scheduled trip (cost concern). Default 26 ≈ biweekly." />
                </div>
                <div style={{ ...S.fieldRow, flex: 1, minWidth: "130px" }}>
                  <label style={S.label}>Emergency DCFC stops/yr (fleet max)</label>
                  <input style={S.input} type="number" step="1" min="0" value={maxEmergencyDcfc}
                    onChange={e => setMaxEmergencyDcfc(parseInt(e.target.value) || 0)}
                    title="Special trip made solely to charge (inconvenience concern). Default 5." />
                </div>
                <div style={{ ...S.fieldRow, flex: 1, minWidth: "110px" }}>
                  <label style={S.label}>DCFC cost $/kWh</label>
                  <input style={S.input} type="text" inputMode="decimal" value={dcfcCostPerKwh}
                    onChange={e => { const v = parseFloat(e.target.value); setDcfcCostPerKwh(isNaN(v) ? e.target.value : v); }} />
                </div>
                <div style={{ ...S.fieldRow, flex: 1, minWidth: "110px" }}>
                  <label style={S.label}>EVSE installed $</label>
                  <input style={S.input} type="number" step="100" value={evseCost}
                    onChange={e => setEvseCost(parseFloat(e.target.value) || 0)} />
                </div>
                <div style={{ ...S.fieldRow, flex: 1, minWidth: "110px" }}>
                  <label style={S.label}>ER distance mi (site)</label>
                  <input style={S.input} type="number" step="1" min="5" value={erDistanceMiles}
                    onChange={e => setErDistanceMiles(parseInt(e.target.value) || 30)} />
                </div>
              </div>
              <div style={{ fontSize: "11px", color: "#888", marginTop: "4px" }}>
                En-route: DCFC added to a trip already underway — primary concern is cost.
                Emergency: special trip made solely to charge — primary concern is inconvenience.
                The EV impact sweep finds the minimum additional PV to stay within both limits.
                ER distance (×1.25 safety buffer) = minimum charge required for an emergency return trip.
              </div>
            </div>

            {/* H) Solar/PVWatts — API key hidden by default */}
            <div style={S.card}>
              <div style={S.cardTitle}>Solar (PVWatts)</div>
              <div style={S.fieldRow}>
                {apiKeySource === "config" && !apiKeyOverride ? (
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                    <span style={{ fontSize: "11px", fontWeight: 600, color: "#155724", background: "#d4edda", border: "1px solid #c3e6cb", borderRadius: "4px", padding: "2px 8px" }}>
                      API key ✓
                    </span>
                    <button style={S.btnSmall} onClick={() => setApiKeyOverride(true)}>Change</button>
                  </div>
                ) : (
                  <>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                      <label style={{ ...S.label, marginBottom: 0 }}>API key</label>
                      <button style={S.btnSmall} onClick={() => setShowApiKey(v => !v)}>
                        {showApiKey ? "Hide" : "Show"}
                      </button>
                      {!showApiKey && (
                        <span style={{ fontSize: "13px", color: "#888", fontFamily: "monospace" }}>
                          {apiKey && apiKey.trim().length >= 4 ? "••••" : "not set"}
                        </span>
                      )}
                    </div>
                    {showApiKey && (
                      <input style={S.input} type="text" value={apiKey}
                        onChange={e => { setApiKey(e.target.value); if (apiKeySource === "config") setApiKeySource("manual"); }}
                        placeholder="Enter NREL API key" />
                    )}
                  </>
                )}
                {(!apiKey || apiKey.trim().length < 4) && (
                  <div style={{ fontSize: "11px", color: "#888", marginTop: "2px" }}>
                    If PVWatts returns a CORS error, open via{" "}
                    <code>python3 -m http.server 8080</code> and use{" "}
                    <code>http://localhost:8080/island_dispatch.html</code>
                  </div>
                )}
              </div>

              <div style={{ ...S.fieldRow, marginBottom: 0 }}>
                <label style={S.label}>Mount types</label>
                <div style={{ overflowX: "auto" }}>
                  <table style={S.mountTable}>
                    <thead>
                      <tr>
                        <th style={S.mountTh}>Label</th>
                        <th style={S.mountTh}>Type</th>
                        <th style={S.mountTh}>Tilt</th>
                        <th style={S.mountTh}>Azim</th>
                        <th style={S.mountTh}>DC/AC</th>
                        <th style={S.mountTh}>Loss%</th>
                        <th style={S.mountTh}>$/kW</th>
                        <th style={S.mountTh}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {mounts.map((m, i) => (
                        <MountRow key={i} idx={i} row={m} onChange={handleMountChange} onRemove={handleRemoveMount} />
                      ))}
                    </tbody>
                  </table>
                </div>
                <button style={{ ...S.btnSmall, marginTop: "4px" }} onClick={handleAddMount}>+ Add mount</button>
              </div>

              <div style={{ ...S.fieldRow, marginTop: "8px" }}>
                <label style={S.label}>PV sizes to sweep (kW, comma-separated)</label>
                <input style={S.input} value={pvSizesStr}
                  onChange={e => setPvSizesStr(e.target.value)} />
              </div>
            </div>

            {/* I) Battery Options */}
            <div style={S.card}>
              <div style={S.cardTitle}>Battery Options</div>
              <div style={{ display: "flex", justifyContent: "flex-end", fontSize: "10px", color: "#888", marginBottom: "3px", paddingRight: "2px" }}>
                Installed cost ($)
              </div>
              {Object.keys(BATTERY_LIBRARY).map(key => (
                <div key={key} style={{ ...S.checkRow, alignItems: "center", gap: "6px" }}>
                  <input type="checkbox" id={"bat-" + key} checked={selectedBatteries.has(key)}
                    onChange={() => toggleBattery(key)} />
                  <label htmlFor={"bat-" + key} style={{ fontSize: "12px", flex: 1 }}>
                    {key} — {BATTERY_LIBRARY[key].kwh} kWh / {BATTERY_LIBRARY[key].kw} kW
                  </label>
                  <input
                    type="number" step="500" min="0"
                    value={batteryCosts[key] ?? BATTERY_LIBRARY[key].fixedCost}
                    onChange={e => {
                      const v = parseInt(e.target.value) || 0;
                      setBatteryCosts(prev => ({ ...prev, [key]: v }));
                    }}
                    style={{ width: "82px", textAlign: "right", fontSize: "12px",
                      padding: "1px 4px", border: "1px solid #ccc", borderRadius: "3px",
                      background: "#fff" }}
                  />
                </div>
              ))}
            </div>

            {/* J) Generator (renamed from "Generator (backup option)") */}
            <div style={S.card}>
              <div style={S.cardTitle}>Generator</div>
              <div style={{ fontSize: "11px", color: "#555", background: "#f5f5f5", borderRadius: "4px", padding: "5px 8px", marginBottom: "8px", lineHeight: 1.6 }}>
                <strong>10 kW only</strong> — smallest unit with AHJ-acceptable sound attenuation enclosure.
                Larger units exceed residential noise limits; smaller units lack adequate soundproofing.
              </div>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <div style={{ ...S.fieldRow, flex: 1 }}>
                  <label style={S.label}>Fuel cost $/kW-hr</label>
                  <input style={S.input} type="text" inputMode="decimal" value={fuelCostPerHour}
                    onChange={e => { const v = parseFloat(e.target.value); setFuelCostPerHour(isNaN(v) ? e.target.value : v); }} />
                </div>
                <div style={{ ...S.fieldRow, flex: 1 }}>
                  <label style={S.label}>Lookahead days</label>
                  <input style={S.input} type="number" step="1" value={genLookaheadDays}
                    onChange={e => setGenLookaheadDays(parseInt(e.target.value))} />
                </div>
                <div style={{ ...S.fieldRow, flex: 1 }}>
                  <label style={S.label}>Installed cost ($)</label>
                  <input style={S.input} type="number" step="500" value={genInstalledCost}
                    onChange={e => setGenInstalledCost(parseInt(e.target.value) || 0)} />
                </div>
                <div style={{ ...S.fieldRow, flex: 1 }}>
                  <label style={S.label}>Normal-year limit (hrs/yr)</label>
                  <input style={S.input} type="number" step="4" min="0" value={genHrLimit}
                    onChange={e => setGenHrLimit(parseInt(e.target.value) || 0)} />
                </div>
                <div style={{ ...S.fieldRow, flex: 1 }}>
                  <label style={S.label}>Emergency limit (hrs)</label>
                  <input style={S.input} type="number" step="10" min="0" value={emergencyGenHrLimit}
                    onChange={e => setEmergencyGenHrLimit(parseInt(e.target.value) || 0)} />
                </div>
              </div>
            </div>

            {/* K) Run Sweep button */}
            <button style={{ ...S.btnPrimary, opacity: canRun ? 1 : 0.5 }}
              disabled={!canRun} onClick={handleRunWithTrace}>
              {running ? "Running..." : "Run Sweep"}
            </button>

            {/* L) Analyze EV Impact button: only for EVs added AFTER the last sweep */}
            {(() => {
              const addedEvCount = Math.max(0, evList.length - sweepEvList.length);
              const v2gInSweep = sweepEvList.some(ev => ev.canV2G);
              return (
                <>
                  {result !== null && addedEvCount > 0 && (
                    <button
                      style={{ ...S.btnPrimary, background: evImpactRunning ? "#6c757d" : "#1a6b3a",
                               opacity: evImpactRunning ? 0.7 : 1, marginTop: "2px" }}
                      disabled={evImpactRunning}
                      onClick={handleAnalyzeEv}>
                      {evImpactRunning ? "Analyzing EV impact…"
                        : `Eval Added EV Impact (${addedEvCount} new EV${addedEvCount > 1 ? "s" : ""})`}
                    </button>
                  )}
                  {result !== null && v2gInSweep && (
                    <div style={{ fontSize: "10px", color: "#155724", marginTop: "2px" }}>
                      ✓ V2G EV included in sweep — criteria 2 & 3 use EV battery (criterion 1 stationary only)
                    </div>
                  )}
                </>
              );
            })()}

            {/* M) Status messages */}
            {running && runStatus && (
              <div style={S.statusMsg("warn")}>
                <span style={S.spinner} /> {runStatus}
              </div>
            )}
            {!running && runStatus && !runError && (
              <div style={S.statusMsg("ok")}>{runStatus}</div>
            )}
            {runError && (
              <div style={S.statusMsg("error")}>Error: {runError}</div>
            )}
          </div>

          {/* ── RIGHT PANEL: results ── */}
          <div style={S.rightPanel}>

            {!result && !running && (
              <div style={{ ...S.card, color: "#888", fontSize: "13px", textAlign: "center", padding: "40px" }}>
                Configure inputs on the left and click Run Sweep to see results.
              </div>
            )}

            {result && (
              <>
                {/* ── COMPARISON CARD: Battery-Only vs Battery+Generator ── */}
                <div style={S.compareCard}>
                  <div style={{ fontSize: "15px", fontWeight: 700, color: "#1a4a7a", marginBottom: "12px" }}>
                    {sweepEvList.length > 0
                      ? `Phase 1 — Co-designed System (${sweepEvList.length} EV${sweepEvList.length > 1 ? "s" : ""} included in sizing)`
                      : "Phase 1 — System Sizing (no EVs)"}
                  </div>
                  <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>

                    {/* Battery-only column */}
                    <div style={{ ...S.compareCol, background: result.optimum ? "#d4edda" : "#f8d7da", border: `1.5px solid ${result.optimum ? "#2d7d46" : "#c0392b"}` }}>
                      <div style={{ fontSize: "12px", fontWeight: 700, color: "#155724", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                        Battery-Only
                      </div>
                      {(() => {
                        const opt = result.optimum || result._wwOnlyOptimum;
                        if (!opt) {
                          return (
                            <div style={{ fontSize: "12px", color: "#721c24" }}>
                              No passing configuration.<br/>Try larger PV or battery sizes.
                            </div>
                          );
                        }
                        const isAnnualValid = !!result.optimum;
                        const c1Need = result._criticalLoadKwhPerDay * 3;
                        const c1Have = opt.batteryKwh;
                        const c1Pass = c1Have >= c1Need;
                        const annChk = result._wwOnlyAnnualCheck;
                        return (
                          <>
                            {!isAnnualValid && (
                              <div style={{ fontSize: "10px", background: "#fff3cd", border: "1px solid #ffc107", borderRadius: "4px", padding: "4px 7px", marginBottom: "6px", color: "#856404" }}>
                                ⚠ WW-only result — no battery-only config in the selected range passes full-year coverage.
                                {annChk && annChk.unservedHours > 0 && ` Best: ${annChk.unservedHours} hr / ${annChk.unservedKwh} kWh unserved. Try larger batteries.`}
                              </div>
                            )}
                            <div style={{ fontSize: "13px", fontWeight: 600, marginBottom: "6px", lineHeight: 1.4 }}>
                              {opt.mountLabel}<br/>
                              {opt.pvKw} kW PV<br/>
                              {opt.batteryLabel} ({opt.batteryKwh} kWh)
                            </div>
                            <div style={{ fontSize: "11px", color: "#555", lineHeight: 1.8 }}>
                              <div>PV: <strong>{fmtCurrency(opt.pvCost)}</strong></div>
                              <div>Battery: <strong>{fmtCurrency(opt.batteryCost)}</strong></div>
                              {sweepEvList.length > 0 && (() => {
                                const enr = opt.annualEnrouteDcfc ?? opt.annualEnrouteDcfcTrips ?? null;
                                const emr = opt.annualEmergencyDcfc ?? opt.annualEmergencyDcfcTrips ?? null;
                                const enrCost = opt.annualEnrouteDcfcCost || 0;
                                const emrCost = opt.annualEmergencyDcfcCost || 0;
                                const hasData = enr != null || emr != null;
                                if (!hasData) return null;
                                return (
                                  <div style={{ marginTop: "5px", paddingTop: "4px", borderTop: "1px solid #ddd" }}>
                                    <div style={{ fontSize: "10px", color: "#777", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "2px" }}>Annual operating costs</div>
                                    {enr != null && (
                                      <div>En-route DCFC: <strong>{enr}</strong> trips/yr{enrCost > 0 && <span style={{ color: "#555" }}> · {fmtCurrency(enrCost)}/yr</span>}</div>
                                    )}
                                    {emr != null && (
                                      <div style={{ color: emr > 0 ? "#c0392b" : "#555" }}>
                                        Emergency DCFC: <strong>{emr}</strong> trips/yr
                                        {emr > 0 && <span> ⚠</span>}
                                        {emrCost > 0 && <span style={{ color: "#c0392b" }}> · {fmtCurrency(emrCost)}/yr</span>}
                                      </div>
                                    )}
                                  </div>
                                );
                              })()}
                              <div style={{ borderTop: "1px solid #aaa", marginTop: "4px", paddingTop: "4px", fontSize: "13px", color: isAnnualValid ? "#155724" : "#856404", fontWeight: 700 }}>
                                Total NPV: {fmtCurrency(opt.totalCost)}
                                {!isAnnualValid && <span style={{ fontSize: "10px", fontWeight: 400, marginLeft: "4px" }}>(WW only)</span>}
                              </div>
                            </div>
                            <div style={{ fontSize: "10px", color: "#333", marginTop: "6px", lineHeight: 1.9, background: isAnnualValid ? "#e8f7ed" : "#fffbe6", borderRadius: "4px", padding: "5px 8px" }}>
                              <div>
                                {c1Pass ? "✓" : "⚠"}&nbsp;
                                <strong>Criterion 1</strong> (3-day critical load, no solar — stationary battery only):&nbsp;
                                battery {c1Have} kWh {c1Pass ? "≥" : "<"} {c1Need} kWh needed
                                {!c1Pass && <span style={{ color: "#856404" }}> — shortfall {Math.round((c1Need - c1Have)*10)/10} kWh</span>}
                              </div>
                              <div>
                                {isAnnualValid
                                  ? <><span style={{color:"#155724"}}>✓</span>&nbsp;<strong>Criterion 2</strong> (typical year): full-year coverage verified — 0 unserved hours</>
                                  : annChk
                                    ? <><span style={{color:"#856404"}}>⚠</span>&nbsp;<strong>Criterion 2</strong> (typical year): <strong>{annChk.unservedHours} hr / {annChk.unservedKwh} kWh</strong> unserved — needs larger PV or battery for full annual coverage</>
                                    : <><span style={{color:"#666"}}>—</span>&nbsp;<strong>Criterion 2</strong> (typical year): not checked (V2G in sweep — trust WW pass)</>
                                }
                              </div>
                              <div>
                                ✓&nbsp;
                                <strong>Criterion 3</strong> (worst 10-day window, full load{result._sweepHasV2g ? " + V2G" : ""}):&nbsp;
                                {opt.wwPct}% coverage
                                {result._v2gEffKwh > 0 && <span style={{ color: "#555", fontSize: "9px", marginLeft: "4px" }}>({result._v2gEffKwh} kWh V2G)</span>}
                              </div>
                            </div>
                            <button
                              style={{ marginTop: "10px", width: "100%", padding: "6px 0", fontSize: "12px", fontWeight: 700, borderRadius: "5px", border: "none", cursor: "pointer",
                                background: chosenPath === "battery_only" ? "#155724" : isAnnualValid ? "#2d7d46" : "#9a6b1e",
                                color: "#fff", letterSpacing: "0.02em" }}
                              onClick={() => { setChosenPath("battery_only"); setEvImpact(null); }}>
                              {chosenPath === "battery_only" ? "✓ Battery-Only selected" : isAnnualValid ? "Select Battery-Only path" : "Select Battery-Only path (WW only)"}
                            </button>
                            <button
                              style={{ marginTop: "6px", width: "100%", padding: "4px 0", fontSize: "11px", borderRadius: "5px", border: "1px solid #2d7d46", cursor: "pointer", background: "#fff", color: "#155724" }}
                              onClick={() => {
                                const ts = new Date().toLocaleString();
                                const lines = [
                                  "CCE Solar Tools — Battery-Only System Design Report",
                                  `Generated: ${ts}`,
                                  `Site: ${siteName || "(unnamed)"}`,
                                  "",
                                  "═══ System Configuration ═══",
                                  `Mount:   ${opt.mountLabel}`,
                                  `PV:      ${opt.pvKw} kW`,
                                  `Battery: ${opt.batteryLabel} (${opt.batteryKwh} kWh)`,
                                  "",
                                  "═══ Cost Summary ═══",
                                  `PV cost:      ${fmtCurrency(opt.pvCost)}`,
                                  `Battery cost: ${fmtCurrency(opt.batteryCost)}`,
                                  `Total NPV (${npvYears} yr): ${fmtCurrency(opt.totalCost)}`,
                                  "",
                                  "═══ Design Criteria ═══",
                                  `Criterion 1 (3-day critical load, no solar): ${c1Pass ? "PASS" : "FAIL"}`,
                                  `  Battery ${opt.batteryKwh} kWh ${c1Pass ? "≥" : "<"} ${c1Need} kWh needed`,
                                  isAnnualValid
                                    ? `Criterion 2 (full year): PASS — 0 unserved hours`
                                    : annChk
                                      ? `Criterion 2 (full year): FAIL — ${annChk.unservedHours} hr / ${annChk.unservedKwh} kWh unserved`
                                      : `Criterion 2 (full year): not checked (V2G)`,
                                  `Criterion 3 (worst 10-day window, full load): ${opt.wwPct}% coverage`,
                                  "",
                                  `Configurations evaluated: ${result.nPassing ?? "—"} passing of ${result.nTotal ?? "—"} total`,
                                ];
                                downloadTextReport(`battery_only_report_${(siteName||"site").replace(/\s+/g,"_")}.txt`, lines.join("\n"));
                              }}>
                              📄 Report
                            </button>
                          </>
                        );
                      })()}
                    </div>

                    {/* Battery + Generator column */}
                    <div style={{ ...S.compareCol, background: result._genOptResult?.optimum ? "#fff8e8" : "#f8d7da", border: `1.5px solid ${result._genOptResult?.optimum ? "#b07800" : "#c0392b"}` }}>
                      <div style={{ fontSize: "12px", fontWeight: 700, color: "#6b4a10", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                        Battery + Generator
                      </div>
                      {result._genOptResult?.optimum ? (() => {
                        const g = result._genOptResult.optimum;
                        return (
                          <>
                            <div style={{ fontSize: "13px", fontWeight: 600, marginBottom: "6px", lineHeight: 1.4 }}>
                              {g.mountLabel}<br/>
                              {g.pvKw} kW PV<br/>
                              {g.batteryLabel} ({g.batteryKwh} kWh)<br/>
                              {g.genKw} kW generator
                            </div>
                            <div style={{ fontSize: "11px", color: "#555", lineHeight: 1.8 }}>
                              <div>PV: <strong>{fmtCurrency(g.pvCost)}</strong></div>
                              <div>Battery: <strong>{fmtCurrency(g.batCost)}</strong></div>
                              <div>Generator: <strong>{fmtCurrency(g.genCap)}</strong></div>
                              <div style={{ marginTop: "5px", paddingTop: "4px", borderTop: "1px solid #ddd" }}>
                                <div style={{ fontSize: "10px", color: "#777", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "2px" }}>Annual operating costs</div>
                                <div>Generator: <strong>{g.annualGenHours}</strong> hr/yr · <strong>{fmtCurrency(g.annualFuelCost)}/yr</strong> fuel</div>
                                {sweepEvList.length > 0 && (() => {
                                  const enr = g.annualEnrouteDcfc ?? null;
                                  const emr = g.annualEmergencyDcfc ?? null;
                                  if (enr == null && emr == null) return null;
                                  return (
                                    <>
                                      {enr != null && <div>En-route DCFC: <strong>{enr}</strong> trips/yr</div>}
                                      {emr != null && (
                                        <div style={{ color: emr > 0 ? "#c0392b" : "#555" }}>
                                          Emergency DCFC: <strong>{emr}</strong> trips/yr
                                          {emr > 0 && <span> ⚠</span>}
                                        </div>
                                      )}
                                    </>
                                  );
                                })()}
                                <div style={{ marginTop: "2px" }}>Fuel NPV ({npvYears} yr): <strong>{fmtCurrency(g.fuelNpv)}</strong></div>
                              </div>
                              <div style={{ borderTop: "1px solid #aaa", marginTop: "4px", paddingTop: "4px", fontSize: "13px", color: "#6b4a10", fontWeight: 700 }}>
                                Total NPV: {fmtCurrency(g.totalCost)}
                              </div>
                            </div>
                            <div style={{ fontSize: "10px", color: "#333", marginTop: "6px", lineHeight: 1.9, background: "#fff8e8", borderRadius: "4px", padding: "5px 8px" }}>
                              <div>
                                {g.criterion1Pass !== false ? "✓" : "⚠"}&nbsp;
                                <strong>Criterion 1</strong> (3-day critical load, no solar — stationary battery only):&nbsp;
                                gen runs <strong>{g.criterion1GenHours ?? "—"} hr</strong>
                                &nbsp;of {result._emergencyGenHrLimit} hr emergency limit
                              </div>
                              <div>
                                {g.annualGenHours <= result._genHrLimit ? "✓" : "⚠"}&nbsp;
                                <strong>Criterion 2</strong> (typical year, excl. worst window):&nbsp;
                                gen runs <strong>{g.annualGenHours} hr/yr</strong>
                                &nbsp;of {result._genHrLimit} hr/yr limit
                              </div>
                              <div>
                                {(g.wwGenHours ?? 0) <= result._emergencyGenHrLimit ? "✓" : "⚠"}&nbsp;
                                <strong>Criterion 3</strong> (worst 10-day window):&nbsp;
                                gen runs <strong>{g.wwGenHours ?? "—"} hr</strong>
                                &nbsp;of {result._emergencyGenHrLimit} hr limit
                              </div>
                            </div>
                            <button
                              style={{ marginTop: "10px", width: "100%", padding: "6px 0", fontSize: "12px", fontWeight: 700, borderRadius: "5px", border: "none", cursor: "pointer",
                                background: chosenPath === "battery_gen" ? "#6b4a10" : "#9a6b1e",
                                color: "#fff", letterSpacing: "0.02em" }}
                              onClick={() => { setChosenPath("battery_gen"); setEvImpact(null); }}>
                              {chosenPath === "battery_gen" ? "✓ Battery+Generator selected" : "Select Battery+Generator path"}
                            </button>
                            <button
                              style={{ marginTop: "6px", width: "100%", padding: "4px 0", fontSize: "11px", borderRadius: "5px", border: "1px solid #9a6b1e", cursor: "pointer", background: "#fff", color: "#6b4a10" }}
                              onClick={() => {
                                const ts = new Date().toLocaleString();
                                const c1Pass = g.criterion1Pass !== false;
                                const c2Pass = g.annualGenHours <= result._genHrLimit;
                                const c3Pass = (g.wwGenHours ?? 0) <= result._emergencyGenHrLimit;
                                const lines = [
                                  "CCE Solar Tools — Battery + Generator System Design Report",
                                  `Generated: ${ts}`,
                                  `Site: ${siteName || "(unnamed)"}`,
                                  "",
                                  "═══ System Configuration ═══",
                                  `Mount:     ${g.mountLabel}`,
                                  `PV:        ${g.pvKw} kW`,
                                  `Battery:   ${g.batteryLabel} (${g.batteryKwh} kWh)`,
                                  `Generator: ${g.genKw} kW`,
                                  "",
                                  "═══ Cost Summary ═══",
                                  `PV cost:      ${fmtCurrency(g.pvCost)}`,
                                  `Battery cost: ${fmtCurrency(g.batteryCost)}`,
                                  `Generator:    ${fmtCurrency(g.genCost ?? 0)}`,
                                  `Fuel (annual): ${fmtCurrency(g.annualFuelCost)}/yr`,
                                  `Total NPV (${npvYears} yr): ${fmtCurrency(g.totalCost)}`,
                                  "",
                                  "═══ Design Criteria ═══",
                                  `Criterion 1 (3-day critical load, no solar): ${c1Pass ? "PASS" : "FAIL"} — gen ${g.criterion1GenHours ?? "—"} hr of ${result._emergencyGenHrLimit} hr emergency limit`,
                                  `Criterion 2 (typical year, excl. worst window): ${c2Pass ? "PASS" : "FAIL"} — gen ${g.annualGenHours} hr/yr of ${result._genHrLimit} hr/yr limit`,
                                  `Criterion 3 (worst 10-day window): ${c3Pass ? "PASS" : "FAIL"} — gen ${g.wwGenHours ?? "—"} hr of ${result._emergencyGenHrLimit} hr limit`,
                                ];
                                downloadTextReport(`battery_gen_report_${(siteName||"site").replace(/\s+/g,"_")}.txt`, lines.join("\n"));
                              }}>
                              📄 Report
                            </button>
                          </>
                        );
                      })() : (
                        <div style={{ fontSize: "12px", color: "#721c24" }}>
                          No passing configuration.<br/>
                          Try smaller generator or larger battery sizes.
                        </div>
                      )}
                    </div>

                    {/* Delta column — shows savings or cost premium */}
                    {result.optimum && result._genOptResult?.optimum && (() => {
                      const batTotal = result.optimum.totalCost;
                      const genTotal = result._genOptResult.optimum.totalCost;
                      const delta    = batTotal - genTotal;
                      return (
                        <div style={{ ...S.compareCol, background: "#f0f4ff", border: "1.5px solid #8fa8d0", flex: "0 0 auto", minWidth: "130px", textAlign: "center" }}>
                          <div style={{ fontSize: "12px", fontWeight: 700, color: "#1a4a7a", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                            Difference
                          </div>
                          <div style={{ fontSize: "22px", fontWeight: 800, color: delta > 0 ? "#155724" : "#721c24", marginBottom: "4px" }}>
                            {delta > 0 ? "+" : "−"}{fmtCurrency(Math.abs(delta))}
                          </div>
                          <div style={{ fontSize: "11px", color: "#555", lineHeight: 1.5 }}>
                            {delta > 0
                              ? <>Battery-only costs<br/><strong>{fmtCurrency(delta)} more</strong><br/>over {npvYears} yr NPV.<br/>Generator saves this.</>
                              : <>Generator path costs<br/><strong>{fmtCurrency(Math.abs(delta))} more</strong><br/>over {npvYears} yr NPV.</>
                            }
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>

                {/* Annual Dispatch — Battery-only and Generator charts, synchronized */}
                {(result._annualTrace || result._genOptResult?.annualTrace) && (() => {
                  // Shared zoom state: annZoomH / annZoomW
                  const zoomDays = (annZoomW / 24).toFixed(1);
                  const zoomLabel = annZoomW < 96 ? `${annZoomW} hr`
                    : annZoomW < 336 ? `${zoomDays} days`
                    : annZoomW < 8760 ? `${(annZoomW / 168).toFixed(1)} weeks`
                    : "full year";
                  const sliderMax = Math.max(0, 8760 - annZoomW);
                  function scrollAnn(dir) {
                    setAnnZoomH(h => Math.max(0, Math.min(sliderMax, h + dir * Math.round(annZoomW * 0.5))));
                  }
                  function handleBatOverviewClick(e) {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const frac = (e.clientX - rect.left) / rect.width;
                    const center = Math.round(frac * 8760);
                    setAnnZoomH(Math.max(0, Math.min(sliderMax, center - Math.round(annZoomW / 2))));
                  }
                  function handleGenOverviewClick(e) {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const frac = (e.clientX - rect.left) / rect.width;
                    const center = Math.round(frac * 8760);
                    setAnnZoomH(Math.max(0, Math.min(sliderMax, center - Math.round(annZoomW / 2))));
                  }

                  // Center-of-window values for both solutions
                  const centerH = Math.min(8759, Math.floor(annZoomH + annZoomW / 2));
                  const batTr   = result._annualTrace;
                  const genTr   = result._genOptResult?.annualTrace;
                  const batOpt  = result.optimum || result._wwOnlyOptimum;
                  const genOpt  = result._genOptResult?.optimum;
                  const fmtKw   = v => (v || 0).toFixed(2);
                  const fmtKwh  = v => (v || 0).toFixed(1);

                  const annUnsKwh   = batTr?.annUnservedKwh   || 0;
                  const annUnsHours = batTr?.annUnservedHours  || 0;
                  const batHasUnsv  = annUnsKwh > 0;
                  const annGenTrace = result._genOptResult?.annualTrace;

                  return (
                    <>
                      {/* Shared zoom controls + center-of-window values panel */}
                      <div style={S.card} tabIndex={0} onKeyDown={e => {
                        if (e.key === "ArrowLeft")  { e.preventDefault(); setAnnZoomH(h => Math.max(0, h - 1)); }
                        if (e.key === "ArrowRight") { e.preventDefault(); setAnnZoomH(h => Math.min(Math.max(0, 8760 - annZoomW), h + 1)); }
                      }}>
                        <div style={{ fontSize: "12px", fontWeight: 700, color: "#333", marginBottom: "6px" }}>
                          📅 Annual Dispatch — Comparison
                        </div>
                        <div style={{ fontSize: "10px", color: "#666", marginBottom: "4px" }}>
                          Scroll wheel to zoom · click overview to navigate · arrow keys (when focused) = ±1 hr · dashed line = center values
                        </div>

                        {/* Center-of-window values panel — two columns */}
                        <div style={{ background: "#f4f6f8", border: "1px solid #d0d6de", borderRadius: "5px", padding: "7px 10px" }}>
                          <div style={{ fontSize: "10px", fontWeight: 700, color: "#444", marginBottom: "5px" }}>
                            Values at center: <span style={{ fontWeight: 400, color: "#555" }}>{hourToLabel(centerH)}</span>
                          </div>
                          <div style={{ display: "flex", gap: "12px" }}>
                            {/* Battery (+ EV if co-designed) column */}
                            {batTr && batOpt && (() => {
                              const sol    = batTr.sol?.[centerH] || 0;
                              const ld     = batTr.ld?.[centerH]  || 0;
                              const bat    = batTr.bat?.[centerH] || 0;
                              const batPrev= centerH > 0 ? (batTr.bat?.[centerH-1] || 0) : bat;
                              const curt   = batTr.curtailed?.[centerH] || 0;
                              const unsrv  = batTr.unserved?.[centerH]  || 0;
                              const nEv    = (batTr.evTraces || []).filter(Boolean).length;
                              const EV_COLORS = ["#b07010","#107050","#186090","#8b2020"];
                              const dBat   = bat - batPrev;
                              // Label for battery Δ: distinguish charging source from discharging destination
                              const batDeltaLabel = Math.abs(dBat) < 0.1 ? null
                                : dBat > 0
                                  ? (sol > 0.5 ? "↑ solar" : "↑ gen/—")
                                  : (nEv > 0   ? "↓ load/EV" : "↓ load");
                              return (
                                <div style={{ flex: 1, fontSize: "10px", lineHeight: 1.9, minWidth: 0 }}>
                                  <div style={{ fontWeight: 700, color: "#155724", marginBottom: "2px", borderBottom: "1px solid #b8d6c0", paddingBottom: "2px" }}>
                                    🔋 {sweepEvList.length > 0 ? `Battery + ${sweepEvList.length} EV` : "Battery-only"} — {batOpt.pvKw} kW · {batOpt.batteryLabel}
                                  </div>
                                  <div><span style={{ color: "#888" }}>Solar:</span> <strong>{sol.toFixed(2)} kW</strong></div>
                                  <div><span style={{ color: "#888" }}>Load:</span> <strong>{ld.toFixed(2)} kW</strong></div>
                                  {curt > 0.01 && <div style={{ color: "#996600" }}><span style={{ color: "#888" }}>Curtailed PV:</span> <strong>{curt.toFixed(2)} kW</strong></div>}
                                  <div>
                                    <span style={{ color: unsrv > 0.01 ? "#c01414" : "#888" }}>Unserved (checksum):</span>{" "}
                                    {unsrv > 0.01
                                      ? <strong style={{ color: "#c01414" }}>⚠ {unsrv.toFixed(2)} kW</strong>
                                      : <strong style={{ color: "#155724" }}>✓ 0 kW</strong>}
                                  </div>
                                  <div style={{ marginTop: "3px", borderTop: "1px solid #ccc", paddingTop: "2px" }}>
                                    <span style={{ color: "#888" }}>Battery SOC:</span>{" "}
                                    <strong>{fmtKwh(bat)} kWh</strong>
                                    <span style={{ color: "#888", marginLeft: "4px" }}>({batTr.batKwh > 0 ? Math.round(bat / batTr.batKwh * 100) : 0}%)</span>
                                    {batDeltaLabel && (
                                      <span style={{ color: dBat > 0 ? "#107040" : "#c05010", fontStyle: "italic", marginLeft: "5px" }}>
                                        {dBat > 0 ? "+" : ""}{dBat.toFixed(1)} kWh {batDeltaLabel}
                                      </span>
                                    )}
                                  </div>
                                  {Array.from({ length: nEv }, (_, ei) => {
                                    const evKwh  = batTr.evTraces[ei]?.[centerH] || 0;
                                    const evPrev = centerH > 0 ? (batTr.evTraces[ei]?.[centerH-1] || 0) : evKwh;
                                    const evCap  = batTr.evKwh?.[ei]  || 1;
                                    const isAway     = !!(batTr.evAwayTraces?.[ei]?.[centerH]);
                                    const wasAway    = centerH > 0 && !!(batTr.evAwayTraces?.[ei]?.[centerH-1]);
                                    const justReturn = wasAway && !isAway;
                                    const justDepart = !wasAway && isAway;
                                    const dEv    = evKwh - evPrev;
                                    const label  = batTr.evLabels?.[ei] || `EV ${ei+1}`;
                                    // Label explaining direction of charge change
                                    const evDeltaLabel = Math.abs(dEv) < 0.1 ? null
                                      : justDepart     ? "↓ departed"
                                      : justReturn     ? (dEv < 0 ? "↓ return trip" : dEv > 0.5 ? "↓ trip + ↑ bat→EV" : "↓ return trip")
                                      : dEv > 0.1      ? (sol > 0.5 ? "↑ solar" : "↑ bat→EV")
                                      : "↓ V2H/drive";
                                    return (
                                      <div key={ei} style={{ color: EV_COLORS[ei % 4] }}>
                                        <span style={{ color: "#888" }}>{label}:</span>{" "}
                                        <strong>{evKwh.toFixed(1)} kWh</strong>
                                        <span style={{ color: "#888", marginLeft: "4px" }}>({Math.round(evKwh / evCap * 100)}%)</span>
                                        {isAway && <span style={{ color: "#999", fontStyle: "italic", marginLeft: "4px" }}>· away</span>}
                                        {evDeltaLabel && (
                                          <span style={{ color: dEv > 0 ? "#107040" : "#c05010", fontStyle: "italic", marginLeft: "5px" }}>
                                            {dEv > 0 ? "+" : ""}{dEv.toFixed(1)} {evDeltaLabel}
                                          </span>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              );
                            })()}
                            {/* Generator column */}
                            {genTr && genOpt && (() => {
                              const sol    = genTr.sol?.[centerH]       || 0;
                              const ld     = genTr.ld?.[centerH]        || 0;
                              const bat    = genTr.bat?.[centerH]       || 0;
                              const batPrev= centerH > 0 ? (genTr.bat?.[centerH-1] || 0) : bat;
                              const curt   = genTr.curtailed?.[centerH] || 0;
                              const unsrv  = genTr.unserved?.[centerH]  || 0;
                              const genOn  = genTr.gen?.[centerH]       || 0;
                              const nEv    = (genTr.evTraces || []).filter(Boolean).length;
                              const EV_COLORS = ["#b07010","#107050","#186090","#8b2020"];
                              const dBat   = bat - batPrev;
                              // Label for battery Δ: distinguish charging source from discharging destination
                              const batDeltaLabel = Math.abs(dBat) < 0.1 ? null
                                : dBat > 0
                                  ? (sol > 0.5 ? "↑ solar" : genOn ? "↑ gen" : "↑ gen/—")
                                  : (nEv > 0   ? "↓ load/EV" : "↓ load");
                              return (
                                <div style={{ flex: 1, fontSize: "10px", lineHeight: 1.9, minWidth: 0 }}>
                                  <div style={{ fontWeight: 700, color: "#6b4a10", marginBottom: "2px", borderBottom: "1px solid #e0c870", paddingBottom: "2px" }}>
                                    ⚡ Battery + Gen — {genOpt.pvKw} kW · {genOpt.batteryLabel} · {genOpt.genKw} kW
                                  </div>
                                  <div><span style={{ color: "#888" }}>Solar:</span> <strong>{sol.toFixed(2)} kW</strong></div>
                                  <div><span style={{ color: "#888" }}>Load:</span> <strong>{ld.toFixed(2)} kW</strong></div>
                                  {curt > 0.01 && <div style={{ color: "#996600" }}><span style={{ color: "#888" }}>Curtailed PV:</span> <strong>{curt.toFixed(2)} kW</strong></div>}
                                  <div>
                                    <span style={{ color: unsrv > 0.01 ? "#c01414" : "#888" }}>Unserved (checksum):</span>{" "}
                                    {unsrv > 0.01
                                      ? <strong style={{ color: "#c01414" }}>⚠ {unsrv.toFixed(2)} kW</strong>
                                      : <strong style={{ color: "#155724" }}>✓ 0 kW</strong>}
                                  </div>
                                  <div style={{ marginTop: "3px", borderTop: "1px solid #ccc", paddingTop: "2px" }}>
                                    <span style={{ color: "#888" }}>Battery SOC:</span>{" "}
                                    <strong>{fmtKwh(bat)} kWh</strong>
                                    <span style={{ color: "#888", marginLeft: "4px" }}>({genTr.batKwh > 0 ? Math.round(bat / genTr.batKwh * 100) : 0}%)</span>
                                    {batDeltaLabel && (
                                      <span style={{ color: dBat > 0 ? "#107040" : "#c05010", fontStyle: "italic", marginLeft: "5px" }}>
                                        {dBat > 0 ? "+" : ""}{dBat.toFixed(1)} kWh {batDeltaLabel}
                                      </span>
                                    )}
                                  </div>
                                  {Array.from({ length: nEv }, (_, ei) => {
                                    const evKwh  = genTr.evTraces[ei]?.[centerH] || 0;
                                    const evPrev = centerH > 0 ? (genTr.evTraces[ei]?.[centerH-1] || 0) : evKwh;
                                    const evCap  = genTr.evKwh?.[ei]  || 1;
                                    const isAway     = !!(genTr.evAwayTraces?.[ei]?.[centerH]);
                                    const wasAway    = centerH > 0 && !!(genTr.evAwayTraces?.[ei]?.[centerH-1]);
                                    const justReturn = wasAway && !isAway;
                                    const justDepart = !wasAway && isAway;
                                    const dEv    = evKwh - evPrev;
                                    const label  = genTr.evLabels?.[ei] || `EV ${ei+1}`;
                                    // Label explaining direction of charge change
                                    const evDeltaLabel = Math.abs(dEv) < 0.1 ? null
                                      : justDepart     ? "↓ departed"
                                      : justReturn     ? (dEv < 0 ? "↓ return trip" : dEv > 0.5 ? "↓ trip + ↑ bat→EV" : "↓ return trip")
                                      : dEv > 0.1      ? (sol > 0.5 ? "↑ solar" : genOn ? "↑ gen→EV" : "↑ bat→EV")
                                      : "↓ V2H/drive";
                                    return (
                                      <div key={ei} style={{ color: EV_COLORS[ei % 4] }}>
                                        <span style={{ color: "#888" }}>{label}:</span>{" "}
                                        <strong>{evKwh.toFixed(1)} kWh</strong>
                                        <span style={{ color: "#888", marginLeft: "4px" }}>({Math.round(evKwh / evCap * 100)}%)</span>
                                        {isAway && <span style={{ color: "#999", fontStyle: "italic", marginLeft: "4px" }}>· away</span>}
                                        {evDeltaLabel && (
                                          <span style={{ color: dEv > 0 ? "#107040" : "#c05010", fontStyle: "italic", marginLeft: "5px" }}>
                                            {dEv > 0 ? "+" : ""}{dEv.toFixed(1)} {evDeltaLabel}
                                          </span>
                                        )}
                                      </div>
                                    );
                                  })}
                                  <div style={{ marginTop: "3px", borderTop: "1px solid #ccc", paddingTop: "2px", color: genOn ? "#c05010" : "#555" }}>
                                    🔧 Generator: <strong>{genOn ? `${genTr.genKw} kW running` : "off"}</strong>
                                  </div>
                                </div>
                              );
                            })()}
                            {!batTr && !genTr && (
                              <div style={{ fontSize: "10px", color: "#888" }}>No annual trace available.</div>
                            )}
                          </div>
                        </div>

                        {/* Shared slider controls — below values panel, close to the charts */}
                        <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "8px" }}>
                          <button
                            style={{ padding: "3px 12px", fontSize: "14px", cursor: "pointer",
                                     border: "1px solid #aaa", borderRadius: "4px", background: "#f5f5f5", lineHeight: 1.2 }}
                            onClick={() => scrollAnn(-1)}>←</button>
                          <input
                            type="range" min={0} max={sliderMax} value={Math.min(annZoomH, sliderMax)}
                            onChange={e => setAnnZoomH(Number(e.target.value))}
                            style={{ flex: 1 }}
                          />
                          <button
                            style={{ padding: "3px 12px", fontSize: "14px", cursor: "pointer",
                                     border: "1px solid #aaa", borderRadius: "4px", background: "#f5f5f5", lineHeight: 1.2 }}
                            onClick={() => scrollAnn(1)}>→</button>
                          <span style={{ fontSize: "10px", color: "#888", whiteSpace: "nowrap",
                                         minWidth: "60px", textAlign: "right" }}>{zoomLabel}</span>
                        </div>
                      </div>

                      {/* Annual dispatch chart card */}
                      {batTr && batOpt && (
                        <div style={S.card}>
                          <div style={{ fontSize: "12px", fontWeight: 700, color: "#155724", marginBottom: "4px" }}>
                            📅 Annual Dispatch — {batOpt.pvKw} kW {batOpt.mountLabel} · {batOpt.batteryLabel}
                            {sweepEvList.length > 0 && (
                              <span style={{ fontWeight: 400, color: "#155724", marginLeft: "6px" }}>· {sweepEvList.length} EV{sweepEvList.length > 1 ? "s" : ""} co-designed</span>
                            )}
                            {!result.optimum && result._wwOnlyOptimum && (
                              <span style={{ fontWeight: 400, color: "#856404", marginLeft: "6px" }}>(⚠ WW-only — no config passes full-year coverage)</span>
                            )}
                          </div>
                          {batHasUnsv ? (
                            <div style={{ background: "#fff3cd", border: "1px solid #ffc107", borderRadius: "4px", padding: "6px 10px", marginBottom: "6px", fontSize: "11px", color: "#856404", lineHeight: 1.6 }}>
                              <strong>⚠ {annUnsKwh.toLocaleString()} kWh unserved across {annUnsHours} hours/yr</strong> — red bars show days with unserved load
                            </div>
                          ) : (
                            <div style={{ background: "#d4edda", border: "1px solid #2d7d46", borderRadius: "4px", padding: "4px 10px", marginBottom: "6px", fontSize: "11px", color: "#155724" }}>
                              ✓ Zero unserved load in full-year simulation
                            </div>
                          )}
                          <div style={{ fontSize: "10px", color: "#666", marginBottom: "3px" }}>
                            {(() => {
                              const ev = batTr?.evTraces?.filter(Boolean) || [];
                              const EV_COLORS_LEG = ["#b07010","#107050","#186090"];
                              return (
                                <>
                                  {ev.map((_, ei) => (
                                    <span key={ei}>
                                      <span style={{ color: EV_COLORS_LEG[ei % EV_COLORS_LEG.length] }}>■</span>
                                      {" "}{batTr?.evLabels?.[ei] || `EV ${ei+1}`} &nbsp;
                                    </span>
                                  ))}
                                  <span style={{ color: "#1a3a90" }}>■</span> battery
                                  {batHasUnsv && <> &nbsp;<span style={{ color: "rgba(192,20,20,0.9)" }}>■</span> unserved hrs/day</>}
                                  {" "}· stacked kWh · click to navigate.
                                </>
                              );
                            })()}
                          </div>
                          <canvas ref={annBatOverviewRef}
                            style={{ width: "100%", height: "72px", display: "block", cursor: "pointer", border: "1px solid #ddd", borderRadius: "3px" }}
                            onClick={handleBatOverviewClick} />
                          <div style={{ position: "relative", height: "14px", marginBottom: "2px" }}>
                            {[["Jan",0],["Feb",31],["Mar",59],["Apr",90],["May",120],["Jun",151],
                              ["Jul",181],["Aug",212],["Sep",243],["Oct",273],["Nov",304],["Dec",334]].map(([m,d]) => (
                              <span key={m} style={{ position: "absolute", left: `${(d/365)*100}%`, fontSize: "9px", color: "#666", transform: "translateX(2px)" }}>{m}</span>
                            ))}
                          </div>
                          <div ref={annBatDetailContRef} style={{ touchAction: "none", marginTop: "4px" }}>
                            <div style={{ height: "160px" }}>
                              <canvas ref={annBatP1Ref} style={{ width: "100%", height: "100%" }} />
                            </div>
                            <div style={{ height: "120px", marginTop: "3px" }}>
                              <canvas ref={annBatP2Ref} style={{ width: "100%", height: "100%" }} />
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Generator chart card */}
                      {annGenTrace && genOpt && (
                        <div style={S.card}>
                          <div style={{ fontSize: "12px", fontWeight: 700, color: "#1a4a7a", marginBottom: "6px" }}>
                            📅 Generator Annual — {genOpt.pvKw} kW {genOpt.mountLabel} · {genOpt.batteryLabel} · {genOpt.genKw} kW gen
                          </div>
                          <div style={{ fontSize: "10px", color: "#666", marginBottom: "3px" }}>
                            <span style={{ color: "#1a60c0" }}>■</span> battery SOC avg/day &nbsp;
                            <span style={{ color: "rgba(210,80,10,0.9)" }}>■</span> generator hrs/day. Click to navigate.
                          </div>
                          <canvas ref={annOverviewRef}
                            style={{ width: "100%", height: "72px", display: "block", cursor: "pointer", border: "1px solid #ddd", borderRadius: "3px" }}
                            onClick={handleGenOverviewClick} />
                          <div style={{ position: "relative", height: "14px", marginBottom: "2px" }}>
                            {[["Jan",0],["Feb",31],["Mar",59],["Apr",90],["May",120],["Jun",151],
                              ["Jul",181],["Aug",212],["Sep",243],["Oct",273],["Nov",304],["Dec",334]].map(([m,d]) => (
                              <span key={m} style={{ position: "absolute", left: `${(d/365)*100}%`, fontSize: "9px", color: "#666", transform: "translateX(2px)" }}>{m}</span>
                            ))}
                          </div>
                          <div ref={annDetailContRef} style={{ touchAction: "none", marginTop: "4px" }}>
                            <div style={{ height: "160px" }}>
                              <canvas ref={annP1Ref} style={{ width: "100%", height: "100%" }} />
                            </div>
                            <div style={{ height: "120px", marginTop: "3px" }}>
                              <canvas ref={annP2Ref} style={{ width: "100%", height: "100%" }} />
                            </div>
                          </div>
                        </div>
                      )}
                    </>
                  );
                })()}

                {/* Detail-toggle tile */}
                <div style={S.card}>
                  {/* Worst year line stays always visible */}
                  <div style={{ fontSize: "12px", color: "#555", marginBottom: "8px" }}>
                    Worst year: <strong>{result.worstYear}</strong>
                    {ww && (
                      <span> &nbsp;·&nbsp; Window:{" "}
                        {ww.start_month !== undefined
                          ? `${fmtDate(ww.start_month, ww.start_day || 1)} – ${fmtDate(ww.end_month, ww.end_day || 10)} ${result.worstYear}`
                          : `DOY ${ww.start_doy || "?"}`}
                      </span>
                    )}
                  </div>

                  {/* Button 1: Title 24 */}
                  {result._codePvKw !== undefined && (
                    <div style={{ marginBottom: "6px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <button style={{ ...S.btnSmall, fontSize: "11px" }} onClick={() => setShowT24Detail(v => !v)}>
                          {showT24Detail ? "▼" : "▶"} Title 24 §150.1-C code criteria
                        </button>
                        <span style={{ fontSize: "11px", color: "#888" }}>PV minimum, 3-day critical load test, generator run limits</span>
                      </div>
                      {showT24Detail && (
                        <div style={{ background: "#e8f0f8", border: "1px solid #b8cce0", borderRadius: "6px", padding: "8px 12px", marginTop: "4px" }}>
                          <strong>Title 24 §150.1-C — three criteria applied as hard filters:</strong>
                          <div style={{ marginTop: "5px", lineHeight: 1.8, paddingLeft: "6px", borderLeft: "3px solid #b8cce0" }}>
                            <div>
                              <strong>① PV minimum:</strong> ≥ <strong>{result._codePvKw} kWdc</strong>
                              &nbsp;(CFA × A / 1000 + NDU × B, Table 150.1-C)
                            </div>
                            <div>
                              <strong>② 3-day critical load test (Criterion 1):</strong>
                              &nbsp;Battery + generator (≤ {result._genHrLimit} hr) must sustain {result._criticalLoadKwhPerDay} kWh/day critical panel for 3 days with no solar.
                              <br/>&nbsp;&nbsp;
                              Battery-only min: <strong>{result._codeMinBatKwh} kWh</strong>
                              &nbsp;·&nbsp;
                              With {result._minGenKw} kW generator: min battery <strong>{result._codeMinBatKwhWithGen} kWh</strong>
                              &nbsp;(generator covers the difference)
                            </div>
                            <div>
                              <strong>③ Generator run limits:</strong>
                              &nbsp;Normal year ≤ <strong>{result._genHrLimit} hrs/yr</strong> (noise ordinance)
                              &nbsp;·&nbsp; Worst-window emergency ≤ <strong>{result._emergencyGenHrLimit} hrs</strong>
                            </div>
                          </div>
                          {result._codeBatShortfall > 0 && (
                            <div style={{ marginTop: "6px", background: "#fff3cd", border: "1px solid #ffc107", borderRadius: "4px", padding: "6px 10px", color: "#856404" }}>
                              <strong>⚠ Battery-only path shortfall:</strong> Code minimum ({result._codeMinBatKwh} kWh) exceeds
                              largest selected battery ({result._maxSelectedBatKwh} kWh) by <strong>{result._codeBatShortfall} kWh</strong>.
                              Battery-only results will show "No passing configuration."
                              The battery+generator path uses a lower minimum ({result._codeMinBatKwhWithGen} kWh) and may still find solutions.
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Button 2: NSRDB cell */}
                  <div style={{ marginBottom: "6px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <button style={{ ...S.btnSmall, fontSize: "11px" }} onClick={() => setShowNsrdbCell(v => !v)}>
                        {showNsrdbCell ? "▼" : "▶"} NSRDB cell match
                      </button>
                      <span style={{ fontSize: "11px", color: "#888" }}>Nearest weather cell, coordinates, and stress-window details</span>
                    </div>
                    {showNsrdbCell && (
                      <div style={{ ...S.card, marginTop: "4px" }}>
                        <div style={S.cardTitle}>NSRDB Cell Match</div>
                        <div>Cell: <strong>{result.cellKey}</strong></div>
                        <div>Coordinates: {result.cellLat.toFixed(4)}, {result.cellLon.toFixed(4)} &nbsp;|&nbsp; Distance from site: {result.cellDistKm} km</div>
                        <div>Worst year: <strong>{result.worstYear}</strong></div>
                        {ww && (
                          <div>
                            Worst window:{" "}
                            {ww.start_month !== undefined
                              ? `${fmtDate(ww.start_month, ww.start_day || 1)} – ${fmtDate(ww.end_month, ww.end_day || 10)} ${result.worstYear}`
                              : `DOY ${ww.start_doy || result.spinupStartDoy + result._cell?.spinup_days || "?"}`}
                          </div>
                        )}
                        <div style={{ marginTop: "4px" }}>
                          Spinup start DOY: {result.spinupStartDoy} &nbsp;|&nbsp; Window length: {result.nHours} hrs
                        </div>
                        <div style={{ marginTop: "4px" }}>
                          Battery-only: {result.nPassing} of {result.nTotal} configs pass (no generator).
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Button 3: Passing configurations */}
                  {result.allPassing.length > 0 && (
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <button style={{ ...S.btnSmall, fontSize: "11px" }} onClick={() => setShowAllConfigs(v => !v)}>
                          {showAllConfigs ? "▼" : "▶"} Passing configurations ({result.nPassing} of {result.nTotal})
                        </button>
                        <span style={{ fontSize: "11px", color: "#888" }}>All battery-only PV+battery combinations ranked by NPV cost</span>
                      </div>
                      {showAllConfigs && (
                        <div style={{ overflowX: "auto", marginTop: "8px" }}>
                          <table style={S.table}>
                            <thead>
                              <tr>
                                {[
                                  ["mountLabel",  "Mount"],
                                  ["pvKw",        "PV kW"],
                                  ["batteryLabel","Battery"],
                                  ["systemCost",  "Install $"],
                                  ["totalCost",   "Total $"],
                                  ["wwPct",       "WW%"],
                                ].map(([col, hdr]) => (
                                  <th key={col} style={S.th} onClick={() => handleSort(col)}>
                                    {hdr}{sortCol === col ? (sortAsc ? " ▲" : " ▼") : ""}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {sortedPassing.slice(0, 10).map((row, i) => {
                                const isOpt = result.optimum &&
                                  row.mountLabel === result.optimum.mountLabel &&
                                  row.pvKw === result.optimum.pvKw &&
                                  row.batteryLabel === result.optimum.batteryLabel;
                                return (
                                  <tr key={i}>
                                    <td style={S.td(i, isOpt)}>{row.mountLabel}</td>
                                    <td style={S.td(i, isOpt)}>{row.pvKw}</td>
                                    <td style={S.td(i, isOpt)}>{row.batteryLabel}</td>
                                    <td style={S.td(i, isOpt)}>{fmtCurrency(row.systemCost)}</td>
                                    <td style={{ ...S.td(i, isOpt), fontWeight: isOpt ? 800 : 400 }}>{fmtCurrency(row.totalCost)}</td>
                                    <td style={S.td(i, isOpt)}>{row.wwPct}%</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Phase 2: EV impact — only for EVs added AFTER the last sweep.
                    EVs that were part of the sweep are already in the Phase 1 design;
                    showing "impact" for them would compare the system to itself. */}
                {evList.length > sweepEvList.length && (
                  <div style={{ ...S.card, background: "#f0f4ff", border: "1px solid #b8cce0", overflowX: "auto" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: "13px", color: "#1a4a7a", marginBottom: "3px" }}>
                          Post-design EV Addition — Retrofit Impact
                        </div>
                        <div style={{ fontSize: "10px", color: "#555", marginBottom: "3px" }}>
                          {evList.length - sweepEvList.length} EV{evList.length - sweepEvList.length > 1 ? "s" : ""} added after sweep — shows required system changes
                        </div>
                        {chosenPath ? (
                          <div style={{ fontSize: "11px", color: "#555" }}>
                            Based on <strong>{chosenPath === "battery_gen" ? "Battery + Generator" : "Battery-Only"}</strong> system from Phase 1
                          </div>
                        ) : (
                          <div style={{ fontSize: "11px", color: "#856404" }}>
                            ↑ Select a path in Phase 1 before analyzing EV impact
                          </div>
                        )}
                      </div>
                      <button style={{ ...S.btnPrimary, fontSize: "12px", padding: "6px 16px",
                          opacity: (evImpactRunning || !chosenPath) ? 0.5 : 1,
                          cursor: !chosenPath ? "not-allowed" : "pointer" }}
                        disabled={evImpactRunning || !chosenPath} onClick={handleAnalyzeEv}>
                        {evImpactRunning ? "Analyzing…" : "Analyze EV Impact"}
                      </button>
                    </div>

                    {evImpact && (() => {
                      const imp        = evImpact;
                      const noEvOpt    = imp.noEvOpt;
                      const evOpt      = imp.evOpt;
                      const noChange   = evOpt && imp.deltaPvKw === 0 && imp.deltaBatKwh === 0;
                      const noSolution = !evOpt;
                      return (
                        <div style={{ marginTop: "14px", borderTop: "1px solid #c5d3e0", paddingTop: "10px" }}>

                          {/* Fleet roster */}
                          <div style={{ fontWeight: 700, fontSize: "12px", color: "#1a4a7a", marginBottom: "4px" }}>
                            Combined {imp.fleetSummary.length}-EV fleet
                            <span style={{ fontWeight: 400, color: "#555", marginLeft: "8px" }}>
                              — compared against <strong>{imp.pathLabel}</strong> baseline
                            </span>
                          </div>
                          <div style={{ fontSize: "11px", color: "#555", marginBottom: "8px", lineHeight: 1.7 }}>
                            {imp.fleetSummary.map((e, ii) => (
                              <div key={ii}>
                                <strong>EV {ii + 1} — Topo {e.topology}:</strong> {e.label} · {e.topologyDesc}
                                &nbsp;· {e.annualMiles.toLocaleString()} mi/yr · {e.annualKwhEv.toLocaleString()} kWh/yr
                              </div>
                            ))}
                            <div style={{ marginTop: "3px" }}>
                              {imp.nPassing} of {imp.nTotal} PV+battery combinations pass with full fleet
                            </div>
                          </div>

                          {noSolution ? (() => {
                            const nTot  = imp.nTotal || 0;
                            const nWw   = imp.nWwPass ?? 0;
                            const nEnr  = imp.nWwPassEnRoute ?? 0;
                            const nFull = imp.nPassing ?? 0;
                            // Identify the binding constraint
                            let reason = "";
                            if (nTot === 0) {
                              reason = "No PV/battery combinations were evaluated — check that PV sizes and battery options are enabled.";
                            } else if (nWw === 0) {
                              reason = `All ${nTot} configurations fail the worst-10-day load coverage test (best coverage: ${imp.bestWwPct}%). ` +
                                "Add more PV, larger batteries, or enable a generator. " +
                                (imp.hasCommuter ? "Commuter EVs charging overnight drain the battery — consider enabling DCFC (dcfcPlannedPerYear > 0) so EVs charge externally on low-solar days." : "");
                            } else if (nEnr < nWw) {
                              reason = `${nWw} configurations pass worst-window coverage but ${nWw - nEnr} fail the en-route DCFC limit ` +
                                `(best annual en-route: ${imp.diagBestEnroute ?? "?"} vs limit ${imp.effectiveEnrouteLimit ?? imp.fleetEnrouteLimit}). ` +
                                "Increase the 'En-route DCFC/yr (fleet max)' setting.";
                            } else if (nFull < nEnr) {
                              const bd = imp.diagEmergencyBreakdown;
                              const scale = bd?.annualScale ?? 5.21;
                              let bdDetail = "";
                              if (bd) {
                                const rtRaw  = bd.roadTripInfeasible;
                                const cmRaw  = bd.commuteReturn;
                                const hbRaw  = bd.homeBased;
                                const parts = [];
                                if (rtRaw > 0)  parts.push(`road-trip infeasible: ${rtRaw} raw (${Math.round(rtRaw*scale)}/yr)`);
                                if (cmRaw > 0)  parts.push(`commute-return chargeToday: ${cmRaw} raw (${Math.round(cmRaw*scale)}/yr)`);
                                if (hbRaw > 0)  parts.push(`home-based EV: ${hbRaw} raw (${Math.round(hbRaw*scale)}/yr)`);
                                if (parts.length) bdDetail = " — breakdown: " + parts.join(", ") + ` (annualScale ×${scale})`;
                              }
                              reason = `${nEnr} configurations pass en-route DCFC but ${nEnr - nFull} fail the emergency DCFC limit ` +
                                `(best annual emergency: ${imp.diagBestEmergency ?? "?"} vs limit ${imp.effectiveEmergencyLimit ?? imp.maxEmergencyDcfc}${bdDetail}). ` +
                                "Increase the 'Emergency DCFC/yr' setting, or see breakdown above to address root cause.";
                            } else {
                              reason = `${nTot} total configurations evaluated; none passed all filters.`;
                            }
                            return (
                              <div style={{ background: "#f8d7da", border: "1px solid #f5c6cb", borderRadius: "4px", padding: "8px 10px", fontSize: "11px", color: "#721c24" }}>
                                <div><strong>⚠ No passing configuration found</strong> ({nTot} evaluated, {nWw} pass worst-window, {nEnr} pass en-route limit, {nFull} pass all)</div>
                                <div style={{ marginTop: "4px" }}>{reason}</div>
                              </div>
                            );
                          })() : (
                            <>
                              <table style={{ ...S.table, fontSize: "12px", minWidth: "500px" }}>
                                <thead>
                                  <tr>
                                    <th style={S.th}>Scenario</th>
                                    <th style={S.th}>Mount</th>
                                    <th style={S.th}>PV kW</th>
                                    <th style={S.th}>Battery</th>
                                    <th style={S.th}>Hardware $</th>
                                    {imp.hasEnrouteEv
                                      ? <><th style={S.th}>En-route/yr †</th><th style={S.th}>Emergency/yr ‡</th></>
                                      : <th style={S.th}>Emergency DCFC/yr ‡</th>
                                    }
                                    <th style={S.th}>DCFC $/yr</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {noEvOpt && (
                                    <tr>
                                      <td style={S.td(0, false)}>No-EV base</td>
                                      <td style={S.td(0, false)}>{noEvOpt.mountLabel}</td>
                                      <td style={S.td(0, false)}>{noEvOpt.pvKw} kW</td>
                                      <td style={S.td(0, false)}>{noEvOpt.batteryLabel}</td>
                                      <td style={S.td(0, false)}>{fmtCurrency(noEvOpt.systemCost)}</td>
                                      {imp.hasEnrouteEv ? <><td style={S.td(0, false)}>—</td><td style={S.td(0, false)}>—</td></> : <td style={S.td(0, false)}>0</td>}
                                      <td style={S.td(0, false)}>—</td>
                                    </tr>
                                  )}
                                  <tr>
                                    <td style={S.td(1, false)}>With fleet ({imp.fleetSummary.length} EVs)</td>
                                    <td style={S.td(1, false)}>{evOpt.mountLabel}</td>
                                    <td style={S.td(1, false)}>{evOpt.pvKw} kW</td>
                                    <td style={S.td(1, false)}>{evOpt.batteryLabel}</td>
                                    <td style={S.td(1, false)}>{fmtCurrency(evOpt.systemCost)}</td>
                                    {imp.hasEnrouteEv ? (
                                      <>
                                        <td style={{ ...S.td(1, false),
                                          fontWeight: imp.nonWwAnnualEnrouteDcfc > (imp.effectiveEnrouteLimit || imp.fleetEnrouteLimit) ? 700 : 400,
                                          color: imp.nonWwAnnualEnrouteDcfc > (imp.effectiveEnrouteLimit || imp.fleetEnrouteLimit) ? "#721c24" : "#555" }}>
                                          {imp.nonWwAnnualEnrouteDcfc}
                                          <span style={{ color: "#888", fontSize: "10px" }}> / {imp.effectiveEnrouteLimit ?? imp.fleetEnrouteLimit} limit</span>
                                        </td>
                                        <td style={{ ...S.td(1, false),
                                          fontWeight: imp.nonWwAnnualEmergencyDcfc > 0 ? 700 : 400,
                                          color: imp.nonWwAnnualEmergencyDcfc > imp.effectiveEmergencyLimit ? "#721c24" : "#155724" }}>
                                          {imp.nonWwAnnualEmergencyDcfc}
                                          <span style={{ color: "#888", fontSize: "10px" }}> / {imp.effectiveEmergencyLimit} limit</span>
                                        </td>
                                      </>
                                    ) : (
                                      <td style={{ ...S.td(1, false),
                                        fontWeight: imp.nonWwAnnualEmergencyDcfc > 0 ? 700 : 400,
                                        color: imp.nonWwAnnualEmergencyDcfc > imp.effectiveEmergencyLimit ? "#721c24" : "#155724" }}>
                                        {imp.nonWwAnnualEmergencyDcfc}
                                        <span style={{ color: "#888", fontSize: "10px" }}> / {imp.effectiveEmergencyLimit} limit</span>
                                      </td>
                                    )}
                                    <td style={S.td(1, false)}>{fmtCurrency(imp.annualDcfcCost)}/yr</td>
                                  </tr>
                                  {noEvOpt && (
                                    <tr style={{ background: noChange ? "#d4edda" : "#fff3cd" }}>
                                      <td style={{ padding: "5px 8px", fontWeight: 700, fontSize: "11px", color: noChange ? "#155724" : "#856404" }}>
                                        {noChange ? "✓ No change" : "△ Delta"}
                                      </td>
                                      <td style={{ padding: "5px 8px", fontSize: "11px" }}>—</td>
                                      <td style={{ padding: "5px 8px", fontWeight: 700, fontSize: "11px", color: imp.deltaPvKw > 0 ? "#856404" : "#155724" }}>
                                        {imp.deltaPvKw > 0 ? `+${imp.deltaPvKw} kW` : imp.deltaPvKw === 0 ? "—" : `${imp.deltaPvKw} kW`}
                                      </td>
                                      <td style={{ padding: "5px 8px", fontWeight: 700, fontSize: "11px", color: imp.deltaBatKwh > 0 ? "#856404" : "#155724" }}>
                                        {imp.deltaBatKwh > 0 ? `+${imp.deltaBatKwh} kWh` : imp.deltaBatKwh === 0 ? "—" : `${imp.deltaBatKwh} kWh`}
                                      </td>
                                      <td style={{ padding: "5px 8px", fontWeight: 700, fontSize: "11px", color: imp.deltaHwCost > 0 ? "#856404" : "#155724" }}>
                                        {imp.deltaHwCost > 0 ? `+${fmtCurrency(imp.deltaHwCost)}` : imp.deltaHwCost === 0 ? "—" : fmtCurrency(imp.deltaHwCost)}
                                        <span style={{ fontWeight: 400, color: "#888" }}> (incl. {imp.fleetSummary.length}× EVSE)</span>
                                      </td>
                                      {imp.hasEnrouteEv ? <><td style={{ padding: "5px 8px" }}>—</td><td style={{ padding: "5px 8px" }}>—</td></> : <td style={{ padding: "5px 8px" }}>—</td>}
                                      <td style={{ padding: "5px 8px" }}>—</td>
                                    </tr>
                                  )}
                                </tbody>
                              </table>

                              {imp.hasEnrouteEv && imp.annualEnrouteDcfcTrips > 0 && (
                                <div style={{ fontSize: "11px", color: "#555", marginTop: "5px" }}>
                                  † En-route stops: driver accepts planned fast-charge stops on workdays (counted against per-EV limit set above).
                                  Costs still enter the optimizer so larger PV+battery that charges the EV at home is preferred.
                                </div>
                              )}
                              <div style={{ fontSize: "11px", color: "#555", marginTop: "5px" }}>
                                ‡ Non-worst-window annual estimate — these values are what the filter checks against the configured limits.
                              </div>
                              {imp.annualWorkChargeCost > 0 && (
                                <div style={{ fontSize: "11px", color: "#555", marginTop: "4px" }}>
                                  Workplace L2 charging cost: {fmtCurrency(imp.annualWorkChargeCost)}/yr (paid L2 drivers).
                                </div>
                              )}
                              {!noChange && (
                                <div style={{ fontSize: "11px", color: "#555", marginTop: "6px", fontStyle: "italic" }}>
                                  {imp.deltaPvKw > 0 && imp.deltaBatKwh === 0 && `↑ Fleet adds daytime solar demand — optimizer selects +${imp.deltaPvKw} kW more PV.`}
                                  {imp.deltaPvKw === 0 && imp.deltaBatKwh > 0 && `↑ Fleet overnight charging — optimizer selects +${imp.deltaBatKwh} kWh more storage.`}
                                  {imp.deltaPvKw > 0 && imp.deltaBatKwh > 0 && `↑ Fleet requires both more solar (+${imp.deltaPvKw} kW) and more storage (+${imp.deltaBatKwh} kWh).`}
                                  {noChange && " ✓ Fleet adds no system requirement beyond the no-EV base."}
                                </div>
                              )}
                            </>
                          )}
                          {evOpt && (
                            <button
                              style={{ marginTop: "10px", padding: "4px 14px", fontSize: "11px", borderRadius: "5px", border: "1px solid #1a4a7a", cursor: "pointer", background: "#fff", color: "#1a4a7a" }}
                              onClick={() => {
                                const ts = new Date().toLocaleString();
                                const lines = [
                                  "CCE Solar Tools — EV Impact Analysis Report",
                                  `Generated: ${ts}`,
                                  `Site: ${siteName || "(unnamed)"}`,
                                  `Baseline path: ${imp.pathLabel}`,
                                  "",
                                  "═══ Optimization Constraints ═══",
                                  `  Mount:          ${imp.baselineMountLabel || "any"} (locked — existing array)`,
                                  `  Minimum PV:     ${imp.baselineMinPvKw} kW (existing system)`,
                                  `  Battery brand:  ${imp.baselineBatFamily || "any"} (same as baseline)`,
                                  `  Minimum battery:${imp.baselineMinBatKwh} kWh (existing system)`,
                                  "",
                                  "═══ EV Fleet ═══",
                                  ...imp.fleetSummary.map((e, i) =>
                                    `  EV ${i+1}: ${e.label} — Topo ${e.topology} — ${e.topologyDesc}\n` +
                                    `        ${e.annualMiles.toLocaleString()} mi/yr · ${e.annualKwhEv.toLocaleString()} kWh/yr`
                                  ),
                                  "",
                                  "═══ No-EV Baseline ═══",
                                  noEvOpt ? [
                                    `  Mount:   ${noEvOpt.mountLabel}`,
                                    `  PV:      ${noEvOpt.pvKw} kW`,
                                    `  Battery: ${noEvOpt.batteryLabel} (${noEvOpt.batteryKwh} kWh)`,
                                    `  Hardware: ${fmtCurrency(noEvOpt.systemCost)}`,
                                    `  Total NPV (${npvYears} yr): ${fmtCurrency(noEvOpt.totalCost)}`,
                                  ].join("\n") : "  (not available)",
                                  "",
                                  "═══ With EV Fleet ═══",
                                  `  Mount:   ${evOpt.mountLabel}`,
                                  `  PV:      ${evOpt.pvKw} kW`,
                                  `  Battery: ${evOpt.batteryLabel} (${evOpt.batteryKwh} kWh)`,
                                  `  Hardware: ${fmtCurrency(evOpt.systemCost)}`,
                                  `  Total NPV (${npvYears} yr): ${fmtCurrency(evOpt.totalCost)}`,
                                  "",
                                  "═══ Incremental Impact ═══",
                                  `  ΔPV:            ${imp.deltaPvKw >= 0 ? "+" : ""}${imp.deltaPvKw} kW`,
                                  `  ΔBattery:       ${imp.deltaBatKwh >= 0 ? "+" : ""}${imp.deltaBatKwh} kWh`,
                                  `  ΔHardware cost: ${imp.deltaHwCost >= 0 ? "+" : ""}${fmtCurrency(imp.deltaHwCost)}`,
                                  `  ΔTotal NPV:     ${imp.deltaTotalCost >= 0 ? "+" : ""}${fmtCurrency(imp.deltaTotalCost)}`,
                                  "",
                                  "═══ Annual DCFC Exposure ═══",
                                  imp.hasEnrouteEv
                                    ? `  En-route DCFC:  ${imp.nonWwAnnualEnrouteDcfc} trips/yr · ${fmtCurrency(imp.annualEnrouteDcfcCost)}/yr`
                                    : "",
                                  `  Emergency DCFC: ${imp.nonWwAnnualEmergencyDcfc} trips/yr · ${fmtCurrency(imp.annualEmergencyDcfcCost)}/yr`,
                                  `  Total DCFC cost: ${fmtCurrency(imp.annualDcfcCost)}/yr`,
                                  imp.annualWorkChargeCost > 0 ? `  Work L2 charge: ${fmtCurrency(imp.annualWorkChargeCost)}/yr` : "",
                                  `  Configurations evaluated: ${imp.nPassing} passing of ${imp.nTotal} total`,
                                ].filter(l => l !== "");
                                downloadTextReport(`ev_impact_report_${(siteName||"site").replace(/\s+/g,"_")}.txt`, lines.join("\n"));
                              }}>
                              📄 Report
                            </button>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                )}


              </>
            )}
          </div>
        </div>

      </div>

      {/* ── Help / Manual modal ─────────────────────────────────── */}
      {showHelp && (
        <div
          onClick={() => setShowHelp(false)}
          style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", zIndex:9999,
                   display:"flex", alignItems:"center", justifyContent:"center" }}>
          <div
            onClick={e => e.stopPropagation()}
            style={{ background:"#fff", borderRadius:"8px", width:"min(860px,95vw)",
                     maxHeight:"90vh", display:"flex", flexDirection:"column",
                     boxShadow:"0 8px 32px rgba(0,0,0,0.35)" }}>
            {/* Modal header */}
            <div style={{ padding:"12px 20px", borderBottom:"2px solid #ddd", background:"#1a4a7a",
                          borderRadius:"8px 8px 0 0", display:"flex", justifyContent:"space-between",
                          alignItems:"center" }}>
              <span style={{ color:"#fff", fontWeight:700, fontSize:"15px" }}>
                MOD-06 Island Dispatch Sizer — User Manual
              </span>
              <button onClick={() => setShowHelp(false)}
                      style={{ background:"rgba(255,255,255,0.2)", border:"none", color:"#fff",
                               borderRadius:"50%", width:"26px", height:"26px", fontSize:"16px",
                               cursor:"pointer", lineHeight:1 }}>✕</button>
            </div>
            {/* Scrollable content */}
            <div style={{ padding:"20px 24px", overflowY:"auto", lineHeight:1.7, fontSize:"13px", color:"#222" }}>

              {/* --- Overview --- */}
              <h2 style={Hd2}>What this tool does</h2>
              <p>The Island Dispatch Sizer sizes a PV + battery (+ optional generator) system for a fully <em>off-grid</em> home. It sweeps combinations of PV array size and battery bank and finds the lowest-cost configuration that survives the <strong>worst consecutive 10-day low-solar window</strong> in 26 years of NSRDB weather data for your site — while also covering the full calendar year with zero load-shedding.</p>
              <p style={{marginTop:6}}>Two results are always shown side-by-side: a <strong>battery-only</strong> path and a <strong>battery&nbsp;+&nbsp;generator</strong> path. The annual dispatch chart lets you visually inspect the selected design across a full simulated year.</p>

              {/* --- Inputs --- */}
              <h2 style={Hd2}>Input fields</h2>
              <table style={TBL}>
                <tbody>
                  <Tr l="Site name / Address" v="Free-text label and geocode lookup. Enter a street address and press ⌖ Geocode — lat/lon are filled automatically. Or enter lat/lon directly." />
                  <Tr l="Annual load (kWh/yr)" v="Household electricity consumption. 16,000 kWh/yr is a typical all-electric single-family home. Alternatively upload a Green Button hourly CSV for a real load profile." />
                  <Tr l="Daytime shift %" v="Shifts a fraction of evening load to midday (e.g. pre-cooling, pool pump). Zero for no shift." />
                  <Tr l="PV sizes (kW)" v="Comma-separated list of DC array capacities to sweep. The optimizer tests every combination with every battery." />
                  <Tr l="Mount types" v="One or more mounting configurations. Each has a cost ($/kW AC), DC:AC ratio, tilt, azimuth, and loss %. PVWatts is called once per mount type per size." />
                  <Tr l="Battery options" v="Select which battery products to include. Each has an editable installed cost ($/system). The optimizer picks the cheapest option that passes all criteria." />
                  <Tr l="EV fleet" v="Up to 3 vehicles. EVs can act as additional storage (V2G/V2H) or as a large load. Each EV has its own trip schedule, charge topology, and efficiency." />
                  <Tr l="Climate zone / Floor area" v="Used for Title 24 §150.1-C code compliance check (minimum battery size). Clear these between sites." />
                  <Tr l="Generator sizes (kW)" v="Comma-separated list of generator capacities. The generator path sweeps all combinations. Leave as '10' for a standard 10 kW propane unit." />
                </tbody>
              </table>

              {/* --- Criteria --- */}
              <h2 style={Hd2}>Pass/fail criteria</h2>
              <p>Every (PV kW × battery × generator kW) combination is tested against two criteria:</p>
              <ol style={{paddingLeft:20, marginTop:4}}>
                <li><strong>Criterion 1 — 3-day no-solar test:</strong> stationary battery alone (no PV, no EVs) must power critical loads for 72 continuous hours. This is the Title 24 §150.1-C code compliance test. Enter your climate zone, conditioned floor area, and critical-load kWh/day in the Building Code section — the tool calculates the minimum battery size automatically.</li>
                <li><strong>Criterion 2 — Full-year annual simulation:</strong> a complete 8,760-hour simulation from Jan 1 must show zero unserved load hours. The simulation includes the worst 10-day weather window internally, so surviving the year guarantees the worst window is covered. Systems that pass the worst window in isolation may still shed load on extended low-solar stretches elsewhere in the year — this test catches those cases.</li>
              </ol>
              <p style={{marginTop:6}}>If no battery-only configuration passes both criteria, the tool shows the closest miss with a ⚠ warning and promotes the battery+generator path as the recommended design.</p>

              {/* --- Annual chart --- */}
              <h2 style={Hd2}>Annual Dispatch Charts</h2>
              <p>After a sweep completes, two synchronized charts appear — <em>Battery-only Annual</em> and <em>Generator Annual</em> — each with an <strong>overview strip</strong> and <strong>two detail panels</strong>.</p>

              <h3 style={Hd3}>Overview strip (top band)</h3>
              <p>365 daily columns. <strong>Click anywhere</strong> on the strip to jump the detail view to that date. The strip encodes:</p>
              <table style={TBL}>
                <tbody>
                  <Tr l="Blue bars" v="Daily average battery state of charge (SOC), stacked below EV bars." />
                  <Tr l="Amber / green / teal bars" v="Daily average SOC for EV 1 / EV 2 / EV 3 (stacked above battery). Color matches EV curve in the P2 detail panel." />
                  <Tr l="Orange bars (generator chart only)" v="Generator run-hours per day. Tall bars in winter = frequent generator use." />
                  <Tr l="Yellow bars at top" v="Daily curtailed solar kWh (normalized). Appears in summer when battery + EVs are full." />
                  <Tr l="Red bars at top" v="Days with unserved load (hours/day). Should be absent in a passing design." />
                </tbody>
              </table>

              <h3 style={Hd3}>Detail panel P1 — Power (kW)</h3>
              <table style={TBL}>
                <tbody>
                  <Tr l={<><span style={{color:"#2a6496"}}>■</span> Blue-green fill</>} v="Solar generation (kW AC)." />
                  <Tr l={<><span style={{color:"#666600"}}>■</span> Olive overlay</>} v="Curtailed solar — energy that could not be absorbed because battery + EVs were full. Sits on top of the blue-green solar fill." />
                  <Tr l={<><span style={{color:"#8b2020"}}>■</span> Dark red line</>} v="Total load demand (kW). When solar > load, surplus charges the battery/EVs." />
                  <Tr l={<><span style={{color:"#c05010"}}>■</span> Orange line/fill (gen chart)</>} v="Generator output (kW). Appears in winter when the battery is running low." />
                  <Tr l={<><span style={{color:"rgba(192,20,20,0.9)"}}>■</span> Red fill</>} v="Unserved load (kW) — energy the system could not supply. Should be zero in a passing design." />
                  <Tr l={<><span style={{color:"#0b7a6e"}}>| teal dashed</span></>} v="En-route / planned DCFC event — the EV stopped at a public fast-charger on schedule." />
                  <Tr l={<><span style={{color:"#c01414"}}>| red solid</span></>} v="Emergency DCFC event — the EV returned home below transport minimum and had to stop for an unplanned charge. Red lines start at 50% of chart height." />
                </tbody>
              </table>

              <h3 style={Hd3}>Detail panel P2 — Stored energy (kWh)</h3>
              <p>Stacked area chart. From bottom to top:</p>
              <table style={TBL}>
                <tbody>
                  <Tr l={<><span style={{color:"#b07010"}}>■</span> Amber area</>} v="EV 1 (least trips/week) state of charge in kWh. EV batteries are ordered by trip frequency — the least-used EV is on the bottom because it is the best storage." />
                  <Tr l={<><span style={{color:"#107050"}}>■</span> Green area</>} v="EV 2." />
                  <Tr l={<><span style={{color:"#186090"}}>■</span> Teal area</>} v="EV 3." />
                  <Tr l={<><span style={{color:"#1a3a90"}}>■</span> Dark blue area</>} v="Stationary battery SOC in kWh. Always on top." />
                  <Tr l="Dashed reference line" v="Minimum SOC (usable floor, typically 10–20% of rated capacity)." />
                </tbody>
              </table>

              <h3 style={Hd3}>EV away-state shading (P2 background)</h3>
              <p>When an EV is away from home, a <em>semi-transparent colored band</em> fills the P2 background behind its stack layer. The color matches the EV's chart color:</p>
              <table style={TBL}>
                <tbody>
                  <Tr l={<><span style={{color:"#b07010"}}>■</span> Amber tint</>} v="EV 1 is away (commuting or road trip)." />
                  <Tr l={<><span style={{color:"#107050"}}>■</span> Green tint</>} v="EV 2 is away." />
                  <Tr l={<><span style={{color:"#186090"}}>■</span> Teal tint</>} v="EV 3 is away. Multiple EVs away simultaneously produce overlapping tints." />
                </tbody>
              </table>
              <p style={{marginTop:4}}>The EV SOC trace is shown even while the EV is away — this lets you see:</p>
              <ul style={{paddingLeft:20, marginTop:2}}>
                <li>The <strong>departure dip</strong> at 7 am (outbound trip energy deducted immediately).</li>
                <li>A <strong>DCFC charge jump</strong> at the event hour (teal dashed line on P1 aligns with SOC rise on P2).</li>
                <li><strong>Destination L2 charging</strong> raising the SOC while the EV is parked at work or a hotel.</li>
                <li>The <strong>return dip</strong> at 6 pm / 8 pm when the inbound trip energy is deducted.</li>
              </ul>

              {/* --- Navigation --- */}
              <h2 style={Hd2}>Navigating the charts</h2>
              <table style={TBL}>
                <tbody>
                  <Tr l="Click overview strip" v="Centers the detail view on the clicked date. The fastest way to jump to a specific season or event." />
                  <Tr l="Scroll wheel (hover P1 or P2)" v="Zooms in (fewer hours visible) or out (more hours visible). Range: 2 days to full year." />
                  <Tr l="← → buttons" v="Pan left or right by half the current window width." />
                  <Tr l="Range slider" v="Drag to move the window to any position in the year." />
                  <Tr l="Arrow keys ← →" v="Step ±1 hour for frame-by-frame inspection. The arrow keys only work when keyboard focus is inside the chart control area — click the range slider (or anywhere between the ← → buttons) first, then use the arrow keys. If nothing happens, click the slider and try again." />
                  <Tr l="Battery-only and Generator charts" v="Both charts are always synchronized — zooming or panning one moves the other. The center-of-window values panel updates both columns simultaneously." />
                </tbody>
              </table>

              {/* --- Values panel --- */}
              <h2 style={Hd2}>Center-of-window values panel</h2>
              <p>The panel below the slider shows the exact values at the <em>center hour</em> of the current zoom window, in two columns — one for each design path.</p>
              <p style={{marginTop:6}}>Each row also shows a <strong>Δ annotation</strong> (change since the previous hour) with a source label:</p>
              <table style={TBL}>
                <tbody>
                  <Tr l="↑ solar" v="Battery or EV gained charge from solar surplus." />
                  <Tr l="↑ gen" v="Battery gained charge from the running generator." />
                  <Tr l="↑ bat→EV" v="Battery discharged to charge the EV (prio-0 emergency top-up — EV was below transport minimum; happens at night with no solar)." />
                  <Tr l="↑ gen→EV" v="Generator output used to charge the EV directly." />
                  <Tr l="↓ load / ↓ load/EV" v="Battery discharged to cover house load (and/or EV charging)." />
                  <Tr l="↓ departed" v="EV SOC dropped because the car left home — outbound trip energy deducted." />
                  <Tr l="↓ return trip" v="EV SOC dropped on arrival — inbound trip energy deducted." />
                  <Tr l="↓ trip + ↑ bat→EV" v="Net positive: EV returned from trip AND received emergency battery top-up in the same hour." />
                  <Tr l="↓ V2H/drive" v="EV battery discharged to power the house (V2G/V2H mode) or consumed by driving." />
                </tbody>
              </table>

              {/* --- Phase 1 results --- */}
              <h2 style={Hd2}>Phase 1 results — comparison cards</h2>
              <p>Two design columns appear after the sweep:</p>
              <ul style={{paddingLeft:20}}>
                <li><strong>Battery-only:</strong> lowest-cost PV + battery that passes both criteria (or the best available if no fully-passing design exists, shown with a ⚠ banner).</li>
                <li><strong>Battery + Generator:</strong> lowest-cost configuration including a standby generator. Always shown — it is the recommended path when no battery-only design passes full-year coverage.</li>
              </ul>
              <p style={{marginTop:6}}>The cards show criteria pass/fail (✓ / ⚠), NPV cost breakdown, and annual operating costs (en-route and emergency DCFC trip counts, generator fuel).</p>

              {/* --- EV configuration --- */}
              <h2 style={Hd2}>EV configuration fields</h2>
              <table style={TBL}>
                <tbody>
                  <Tr l="Battery kWh" v="Usable capacity of the vehicle battery pack (e.g. 88 kWh for a Ford F-150 Lightning, 75 kWh for a Tesla Model 3 Long Range)." />
                  <Tr l="Trips/wk" v="How often the EV leaves home for a round trip. Decimals are allowed: 0 = always home (WFH); 0.5 = biweekly; 5 = weekday commute (Mon–Fri); 5.5 = weekday plus every other weekend; 7 = daily. The EV departs at 7 am and returns at 6 pm on each trip day." />
                  <Tr l="Trip mi (one-way)" v="Single-direction distance in miles. The round trip consumes 2 × this value. Used to calculate how much energy is consumed by driving and how much battery is needed before departure." />
                  <Tr l="Efficiency mi/kWh" v="Vehicle energy consumption in miles per kWh (default 3.5 mi/kWh ≈ 286 Wh/mi). Used to convert trip miles to energy. Typical values: Tesla Model 3 ≈ 4.0, F-150 Lightning ≈ 2.3, RAV4 Prime ≈ 3.0." />
                  <Tr l="V2H bidirectional" v="Check this box if the vehicle supports bidirectional charging (V2G/V2H). A bidirectional EV can discharge into the house when the stationary battery is low, acting as a large backup battery. Examples: Ford F-150 Lightning, Chevy Silverado EV. The dispatch model always charges the EV first and only asks it to export when the stationary battery is insufficient." />
                </tbody>
              </table>

              <h3 style={Hd3}>Destination charging options</h3>
              <p>Determines what charging (if any) the EV receives while away from home:</p>
              <table style={TBL}>
                <tbody>
                  <Tr l="None (home only)" v="No charging at the destination. The EV parks and returns on whatever battery it has left after the outbound trip. Typical for short errands or situations where no charger is available. The car may need a DCFC stop en route on long days." />
                  <Tr l="Free L2 at destination" v="An employer, hotel, or other host provides free Level 2 AC charging (≈ 7 kW). The EV charges to the destination L2 target (default 95 %) during the stay. No cost to the owner. Represents Topology C — the host grid funds the charge, reducing off-grid storage requirements." />
                  <Tr l="Paid L2 at destination" v="Same as free L2 but the owner pays for the electricity. Enter the $/kWh rate; the annual cost accumulates and appears in the operating-cost summary. Typical for paid workplace charging programs or hotel charging fees." />
                </tbody>
              </table>

              <h3 style={Hd3}>DCFC stop counts</h3>
              <p>Two types of fast-charging stops are tracked separately:</p>
              <table style={TBL}>
                <tbody>
                  <Tr l="Planned DCFC/yr (per EV)" v="En-route fast-charge stops the driver voluntarily makes — for example, on long drives or road trips where a top-up is planned. These are scheduled in the model (teal dashed lines on the P1 chart). Set to 0 if the driver charges exclusively at home and at the destination." />
                  <Tr l="En-route DCFC fleet max" v="A design is rejected if the entire fleet requires more en-route stops per year than this limit. It represents the maximum planned inconvenience the household will accept (cost concern). Default 26 ≈ biweekly for the fleet." />
                  <Tr l="Emergency DCFC fleet max" v="Unplanned stops made solely to avoid stranding — the EV returned home below the transport-minimum threshold and must top up before the next trip. These are failures of the system design (red lines on P1). A design is rejected if the fleet exceeds this limit. Default 5 per year." />
                </tbody>
              </table>

              <h3 style={Hd3}>Charge targets</h3>
              <table style={TBL}>
                <tbody>
                  <Tr l="DCFC target %" v="State of charge the model charges to at a DC fast charger (default 80 %). Industry practice stops at 80 % to protect the battery and reduce session time." />
                  <Tr l="Dest L2 target %" v="State of charge the model assumes the destination charger reaches (default 95 %). An overnight L2 session at a hotel or employer has enough time to fully top up." />
                </tbody>
              </table>

              <h2 style={Hd2}>EV topologies</h2>
              <table style={TBL}>
                <tbody>
                  <Tr l="Topology A — WFH" v="Trips/wk = 0. EV is home all day during solar hours, acting as a large second battery. Solar surplus charges the EV; if V2H is enabled it can power the house overnight. Best off-grid economics." />
                  <Tr l="Topology B — Commuter, no workplace charging" v="Trips/wk = 5, Dest charging = None. EV is absent during solar hours and returns with a depleted battery. The system cannot charge the EV from solar during the day, creating chronic curtailment in summer and chronic DCFC events in winter. Usually impractical for off-grid." />
                  <Tr l="Topology C — Commuter, free workplace L2" v="Trips/wk = 5, Dest charging = Free L2. The employer grid charges the EV to 95 % daily at no cost to the owner. The EV returns home nearly full — effectively a large battery that the employer pays to charge. This significantly reduces on-site storage requirements." />
                  <Tr l="V2G / V2H" v="Any topology + V2H checkbox checked. A bidirectional EV exports to the house when the stationary battery falls short. The optimizer can choose a smaller stationary battery when V2H is available." />
                </tbody>
              </table>

              {/* --- Tips --- */}
              <h2 style={Hd2}>Tips</h2>
              <ul style={{paddingLeft:20}}>
                <li>If the battery-only path shows ⚠ full-year failures, zoom the annual chart to the flagged period (red bars on overview) to see exactly when and why load is unserved.</li>
                <li>Emergency DCFC events (red lines on P1) are the strongest signal that the EV fleet sizing is insufficient or that trip schedules are too aggressive for the available solar.</li>
                <li>Curtailment in summer (olive overlay on P1, yellow on overview) means excess solar — the system is over-built for summer, sized for winter. This is expected for off-grid.</li>
                <li>Use <strong>Save inputs</strong> to preserve your site configuration. <strong>Reset defaults</strong> clears site-specific data (address, floor area, climate zone, EVs) while keeping product prices.</li>
                <li>The PVWatts API key is stored separately in your browser and is not cleared by Reset defaults.</li>
              </ul>

            </div>{/* end scroll */}
          </div>{/* end modal box */}
        </div>
      )}

    </div>
  );
}

// Mount
const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);
