const { useState, useCallback } = React;

const VERSION = "1.9.2";

// ─── DATA SOURCES (for citation in output files) ──────────────────────────────
const DATA_SOURCES = {
  load_totals:   "NREL ResStock 2024.2 (NREL/TP-5500-88109) - California CZ7/CZ10/CZ14 multifamily and SFR archetypes",
  load_shapes:   "NREL End-Use Load Profiles for the U.S. Building Stock (NREL/TP-5500-80889) - 15-min interval end-use shapes, CA multifamily CZ7",
  occupancy:     "EIA Residential Energy Consumption Survey (RECS) 2020 - occupancy scaling factors",
  climate_zones: "CEC Building Climate Zones by ZIP Code (Title 24 Part 6 Reference Joint Appendix JA2, 2020)",
  seasonal:      "CEC California Energy Consumption Dashboard QFER data - San Diego County residential monthly factors",
  appliances:    "Pecan Street Dataport residential 15-min interval data - appliance event calibration",
  rates:         "SDG&E Total Rates Tables effective January 1, 2026 (CPUC-approved tariff schedules)",
  format:        "NAESB REQ.21 Energy Services Provider Interface (ESPI) - Green Button Emulator",
};

// ─── CEC ZIP CODE → CLIMATE ZONE LOOKUP ──────────────────────────────────────
// Source: CEC BuildingClimateZonesByZIPCode_ada.xlsx (energy.ca.gov/media/3560)
// Published under Title 24 Part 6 Reference Joint Appendix JA2
// Since 2013 Standards: each ZIP is entirely within one climate zone — no ambiguity.
// Coverage: San Diego County (SDG&E) + Orange County (SCE/SDG&E)
// San Diego: CZ7 (coastal), CZ10 (inland valleys), CZ14 (mountains/desert fringe)
// Orange County: CZ6 (coastal OC), CZ8 (inland OC)

const ZIP_TO_CZ = {
  // ── CZ6: Southern California Coastal (Orange County coastal fringe) ──────────
  // Newport Beach, Costa Mesa (coast), Laguna Beach, Dana Point, San Clemente, Seal Beach
  '90720':6,'90721':6,'90740':6,
  '92624':6,'92626':6,'92627':6,
  '92629':6,
  '92647':6,'92648':6,'92649':6,
  '92651':6,'92652':6,'92653':6,'92654':6,
  '92657':6,'92658':6,'92659':6,'92660':6,'92661':6,'92662':6,'92663':6,
  '92672':6,'92673':6,'92674':6,
  '92677':6,
  // ── CZ8: Inland Southern California (Orange County inland) ───────────────────
  // Anaheim, Brea, Buena Park, Cypress, Fullerton, Garden Grove, Irvine,
  // Lake Forest, Mission Viejo, Orange, Placentia, Santa Ana, Tustin, Yorba Linda
  '90620':8,'90621':8,'90622':8,'90623':8,'90624':8,
  '90630':8,'90631':8,'90632':8,'90633':8,
  '92602':8,'92603':8,'92604':8,'92606':8,
  '92610':8,'92612':8,'92614':8,'92616':8,'92617':8,'92618':8,'92619':8,'92620':8,
  '92630':8,'92637':8,
  '92655':8,'92656':8,
  '92675':8,'92676':8,'92678':8,'92679':8,
  '92688':8,'92690':8,'92691':8,'92692':8,
  '92694':8,'92697':8,
  '92701':8,'92702':8,'92703':8,'92704':8,'92705':8,'92706':8,'92707':8,'92708':8,
  '92780':8,'92781':8,'92782':8,'92799':8,
  '92801':8,'92802':8,'92803':8,'92804':8,'92805':8,'92806':8,'92807':8,'92808':8,'92809':8,
  '92821':8,'92822':8,'92823':8,
  '92831':8,'92832':8,'92833':8,'92834':8,'92835':8,'92836':8,'92837':8,'92838':8,
  '92840':8,'92841':8,'92842':8,'92843':8,'92844':8,'92845':8,'92846':8,
  '92861':8,'92868':8,'92869':8,
  '92870':8,'92871':8,
  '92885':8,'92886':8,'92887':8,
  // ── CZ7: Coastal (Marine/Mediterranean) ──────────────────────────────────
  '92007':7,'92008':7,'92009':7,'92010':7,'92011':7,'92013':7,'92014':7,
  '92018':7,'92024':7,'92033':7,'92037':7,'92038':7,'92039':7,
  '92049':7,'92051':7,'92052':7,'92054':7,'92055':7,'92056':7,'92057':7,'92058':7,
  '92067':7,'92075':7,'92078':7,'92079':7,
  '92081':7,'92083':7,'92085':7,'92088':7,
  '92091':7,'92092':7,'92093':7,'92096':7,
  '92101':7,'92102':7,'92103':7,'92104':7,'92105':7,'92106':7,'92107':7,'92108':7,
  '92109':7,'92110':7,'92111':7,'92112':7,'92113':7,'92115':7,'92116':7,'92117':7,
  '92118':7,'92121':7,'92122':7,'92123':7,'92126':7,'92129':7,'92130':7,
  '92132':7,'92133':7,'92134':7,'92135':7,'92136':7,'92137':7,'92138':7,
  '92140':7,'92142':7,'92143':7,'92147':7,'92149':7,'92150':7,'92152':7,
  '92155':7,'92161':7,'92162':7,'92163':7,'92164':7,'92165':7,'92166':7,
  '92167':7,'92168':7,'92169':7,'92170':7,'92171':7,'92172':7,'92174':7,
  '92175':7,'92176':7,'92177':7,'92178':7,'92182':7,'92184':7,'92186':7,
  '92187':7,'92191':7,'92192':7,'92193':7,'92194':7,'92195':7,'92196':7,
  '92197':7,'92198':7,'92199':7,
  // ── CZ10: Inland Valleys (Hot dry summer, mild winter) ───────────────────
  '91902':10,'91903':10,'91908':10,'91909':10,'91910':10,'91911':10,'91912':10,
  '91913':10,'91914':10,'91915':10,'91917':10,'91921':10,'91933':10,'91935':10,
  '91941':10,'91942':10,'91943':10,'91944':10,'91945':10,'91946':10,'91950':10,
  '91951':10,'91963':10,'91976':10,'91977':10,'91978':10,'91979':10,
  '92003':10,'92019':10,'92020':10,'92021':10,'92022':10,'92023':10,
  '92025':10,'92026':10,'92027':10,'92028':10,'92029':10,'92030':10,
  '92040':10,'92046':10,'92059':10,'92060':10,'92061':10,'92064':10,'92065':10,
  '92068':10,'92069':10,'92071':10,'92074':10,'92082':10,'92084':10,'92086':10,
  '92114':10,'92119':10,'92120':10,'92124':10,'92127':10,'92128':10,'92131':10,
  '92139':10,'92145':10,'92153':10,'92154':10,'92158':10,'92159':10,'92160':10,
  '92173':10,'92179':10,'92190':10,
  // ── CZ14: Mountains & Desert Fringe (Hot summer, cold winter) ────────────
  '91901':14,'91905':14,'91906':14,'91916':14,'91934':14,'91948':14,
  '91962':14,'91980':14,'91987':14,
  '92004':14,'92036':14,'92066':14,'92070':14,'92086':14,
};

// Extract ZIP code from a US address string and look up climate zone
function inferClimateZone(address) {
  const zipMatch = address.match(/\b(9[0-9]{4})\b/);
  if (!zipMatch) return null;
  const zip = zipMatch[1];
  const czNum = ZIP_TO_CZ[zip];
  if (!czNum) return null;
  return `CZ${czNum}`;
}


// ─── CLIMATE ZONES ────────────────────────────────────────────────────────────
// SDG&E territory: CZ7 (coastal), CZ10 (inland valleys), CZ14 (mountains/desert fringe)
// Orange County: CZ6 (coastal OC), CZ8 (inland OC)
// Seasonal multipliers calibrated to CEC QFER residential data
// Base kWh/sqft/yr at reference occupancy (1.5 ppl), all-electric, from ResStock 2024.2

const CLIMATE_ZONES = {
  CZ6: {
    label: "CZ6 — Southern CA Coastal (Newport Beach, Laguna Beach, San Clemente)",
    description: "Marine coastal. Similar to CZ7 but slightly warmer summers. Low AC load.",
    seasonal: { 1:0.84, 2:0.82, 3:0.85, 4:0.90, 5:0.96, 6:1.04, 7:1.16, 8:1.18, 9:1.10, 10:0.98, 11:0.88, 12:0.84 },
    hvac: { cooling_frac: 0.10, heating_frac: 0.04 },
    cooling_months: { 6:0.3, 7:1.0, 8:1.0, 9:0.7, 10:0.2 },
    heating_months: { 11:0.5, 12:0.9, 1:1.0, 2:0.8, 3:0.3 },
    sdge_baseline_daily_kwh: 11.8,
  },
  CZ7: {
    label: "CZ7 — Coastal (Ocean Beach, La Jolla, Point Loma, Coronado)",
    description: "Mild marine climate. Very low AC load, minimal heating.",
    seasonal: { 1:0.82, 2:0.80, 3:0.83, 4:0.88, 5:0.95, 6:1.02, 7:1.15, 8:1.18, 9:1.10, 10:0.98, 11:0.87, 12:0.82 },
    hvac: { cooling_frac: 0.08, heating_frac: 0.04 },
    cooling_months: { 6:0.3, 7:1.0, 8:1.0, 9:0.7, 10:0.3 },
    heating_months: { 11:0.5, 12:0.9, 1:1.0, 2:0.8, 3:0.4 },
    sdge_baseline_daily_kwh: 11.2, // coastal baseline allowance (kWh/day)
  },
  CZ10: {
    label: "CZ10 — Inland Valleys (El Cajon, Santee, Spring Valley, Lakeside)",
    description: "Hot dry summers, mild winters. Significant AC load.",
    seasonal: { 1:0.72, 2:0.70, 3:0.76, 4:0.85, 5:0.98, 6:1.15, 7:1.42, 8:1.48, 9:1.28, 10:1.02, 11:0.80, 12:0.74 },
    hvac: { cooling_frac: 0.22, heating_frac: 0.06 },
    cooling_months: { 5:0.2, 6:0.6, 7:1.0, 8:1.0, 9:0.8, 10:0.4 },
    heating_months: { 11:0.4, 12:0.8, 1:1.0, 2:0.7, 3:0.3 },
    sdge_baseline_daily_kwh: 14.5,
  },
  CZ14: {
    label: "CZ14 — Mountains & Desert Fringe (Ramona, Alpine, Descanso, Borrego)",
    description: "Hot summers, cold winters. Highest HVAC load in SDG&E territory.",
    seasonal: { 1:0.78, 2:0.72, 3:0.78, 4:0.88, 5:1.02, 6:1.18, 7:1.52, 8:1.55, 9:1.30, 10:1.02, 11:0.82, 12:0.78 },
    hvac: { cooling_frac: 0.28, heating_frac: 0.12 },
    cooling_months: { 5:0.2, 6:0.7, 7:1.0, 8:1.0, 9:0.7, 10:0.3 },
    heating_months: { 11:0.5, 12:1.0, 1:1.0, 2:0.8, 3:0.5 },
    sdge_baseline_daily_kwh: 16.8,
  },
  CZ8: {
    label: "CZ8 — Inland Southern CA (Anaheim, Irvine, Santa Ana, Mission Viejo)",
    description: "Hot dry summers, mild winters. Moderate AC load. Most of inland Orange County.",
    seasonal: { 1:0.74, 2:0.72, 3:0.78, 4:0.88, 5:1.00, 6:1.18, 7:1.44, 8:1.48, 9:1.26, 10:1.00, 11:0.80, 12:0.74 },
    hvac: { cooling_frac: 0.18, heating_frac: 0.05 },
    cooling_months: { 5:0.2, 6:0.6, 7:1.0, 8:1.0, 9:0.7, 10:0.3 },
    heating_months: { 11:0.4, 12:0.8, 1:1.0, 2:0.7, 3:0.3 },
    sdge_baseline_daily_kwh: 13.5,
  },
};

// ─── BUILDING TYPE ARCHETYPES ─────────────────────────────────────────────────
// kWh/sqft/yr end-use fractions calibrated to ResStock 2024.2 + EIA RECS 2020
// Reference: 750 sqft, 1.5 occupants, all-electric, CZ7 → ~341 kWh/month
// Fractions below are for ALL-ELECTRIC baseline; fuel mix adjustments applied separately

const BUILDING_TYPES = {
  multifamily: {
    label: "Multifamily Apartment",
    description: "Units in a shared building. Shared walls reduce HVAC load.",
    // Lower HVAC than SFD due to shared walls; lower plug loads; no pool/garage
    base_kwh_per_sqft: 5.456, // CZ7 reference: 341 kWh/mo at 750 sqft
    envelope_factor: 0.75,    // shared walls = less exposed envelope vs SFD
    end_use_fractions: {
      plug_loads:    0.28,
      water_heating: 0.17,
      lighting:      0.14,
      refrigerator:  0.09,
      hvac_cooling:  0.08,
      washer_dryer:  0.08,
      cooking:       0.06,
      dishwasher:    0.04,
      hvac_heating:  0.04,
      misc_motors:   0.02,
    },
  },
  sfr_detached: {
    label: "Single Family Detached",
    description: "Standalone house. Full envelope exposure. Often larger plug loads.",
    base_kwh_per_sqft: 6.20,  // ~15% higher per sqft than MF due to envelope exposure
    envelope_factor: 1.0,
    end_use_fractions: {
      plug_loads:    0.26,
      hvac_cooling:  0.16,  // much higher — full envelope exposed
      water_heating: 0.15,
      lighting:      0.12,
      hvac_heating:  0.09,  // higher than MF
      washer_dryer:  0.07,
      refrigerator:  0.06,
      cooking:       0.05,
      dishwasher:    0.03,
      misc_motors:   0.01,
    },
  },
  sfr_attached: {
    label: "Townhouse / Attached SFR",
    description: "Shared walls on sides only. Intermediate HVAC load.",
    base_kwh_per_sqft: 5.80,
    envelope_factor: 0.88,
    end_use_fractions: {
      plug_loads:    0.27,
      hvac_cooling:  0.12,
      water_heating: 0.16,
      lighting:      0.13,
      hvac_heating:  0.07,
      washer_dryer:  0.07,
      refrigerator:  0.07,
      cooking:       0.05,
      dishwasher:    0.04,
      misc_motors:   0.02,
    },
  },
  adu: {
    label: "ADU (Accessory Dwelling Unit)",
    description: "Small detached or attached unit. High kWh/sqft due to size.",
    base_kwh_per_sqft: 7.20,  // higher kWh/sqft — refrigerator/WH fixed loads dominate small unit
    envelope_factor: 0.90,
    end_use_fractions: {
      plug_loads:    0.25,
      water_heating: 0.22,  // WH is proportionally larger in small units
      refrigerator:  0.13,  // same absolute load, larger fraction in small unit
      lighting:      0.12,
      hvac_cooling:  0.09,
      washer_dryer:  0.06,
      cooking:       0.06,
      hvac_heating:  0.04,
      dishwasher:    0.02,
      misc_motors:   0.01,
    },
  },
};

// ─── FUEL MIX ADJUSTMENTS ─────────────────────────────────────────────────────
// When gas is used for an end use, that load is removed from electricity
// and the fraction is redistributed to remaining electric end uses
// Reduction factors: how much the electricity fraction drops when gas replaces electric

const FUEL_CONFIGS = {
  all_electric: {
    label: "All-Electric (new construction / Title 24 2025)",
    water_heating_elec: true,
    cooking_elec: true,
    heating_elec: true,
    elec_fraction_multipliers: { water_heating: 1.0, cooking: 1.0, hvac_heating: 1.0 },
  },
  gas_water_heat: {
    label: "Gas water heater, electric cooking",
    water_heating_elec: false,
    cooking_elec: true,
    heating_elec: true,
    elec_fraction_multipliers: { water_heating: 0.0, cooking: 1.0, hvac_heating: 1.0 },
  },
  gas_cooking: {
    label: "Electric water heater, gas cooking",
    water_heating_elec: true,
    cooking_elec: false,
    heating_elec: true,
    elec_fraction_multipliers: { water_heating: 1.0, cooking: 0.0, hvac_heating: 1.0 },
  },
  gas_wh_cooking: {
    label: "Gas water heater + gas cooking (typical existing)",
    water_heating_elec: false,
    cooking_elec: false,
    heating_elec: true,
    elec_fraction_multipliers: { water_heating: 0.0, cooking: 0.0, hvac_heating: 1.0 },
  },
  full_gas: {
    label: "Gas water heater + gas cooking + gas heating (older stock)",
    water_heating_elec: false,
    cooking_elec: false,
    heating_elec: false,
    elec_fraction_multipliers: { water_heating: 0.0, cooking: 0.0, hvac_heating: 0.0 },
  },
};

// ─── DEFAULT MULTIFAMILY UNIT TEMPLATES ──────────────────────────────────────
// Example 6-unit building: 2×2BR ADA (568 sqft), 2×1BR (578 sqft), 2×1BR end (588 sqft)
// Edit labels, sqft, bedrooms, occupants, and fuel config per unit as needed.
const makeUnit = (id, label, sqft, bedrooms, occupants, fuelConfig) => ({
  id, label, sqft, bedrooms, occupants, fuelConfig,
});

const DEFAULT_UNITS = [
  makeUnit("U1", "Unit 1 (2BR ADA)", 568, 2, 2.4, "all_electric"),
  makeUnit("U2", "Unit 2 (1BR)",     578, 1, 1.5, "all_electric"),
  makeUnit("U3", "Unit 3 (1BR end)", 588, 1, 1.5, "all_electric"),
  makeUnit("U4", "Unit 4 (2BR ADA)", 568, 2, 2.4, "all_electric"),
  makeUnit("U5", "Unit 5 (1BR)",     578, 1, 1.5, "all_electric"),
  makeUnit("U6", "Unit 6 (1BR end)", 588, 1, 1.5, "all_electric"),
];

function updateUnit(units, id, field, value) {
  return units.map(u => u.id === id ? { ...u, [field]: value } : u);
}

// ─── 24-HOUR LOAD SHAPE PROFILES ──────────────────────────────────────────────
// Normalized (sum=1.0/day) hourly profiles per end-use, weekday vs weekend
// Source: NREL End-Use Load Profiles CZ7 multifamily archetypes

function normalize(arr) { const s = arr.reduce((a,b)=>a+b,0); return arr.map(x=>x/s); }

const PROFILES = {
  hvac_cooling: {
    weekday: normalize([0.01,0.01,0.01,0.01,0.01,0.01,0.02,0.03,0.04,0.06,0.07,0.08,0.09,0.09,0.09,0.08,0.07,0.07,0.06,0.05,0.04,0.03,0.02,0.01]),
    weekend: normalize([0.01,0.01,0.01,0.01,0.01,0.01,0.02,0.04,0.06,0.07,0.08,0.09,0.09,0.09,0.08,0.07,0.06,0.06,0.05,0.04,0.03,0.02,0.02,0.01]),
  },
  hvac_heating: {
    weekday: normalize([0.04,0.03,0.03,0.03,0.03,0.04,0.07,0.09,0.07,0.04,0.03,0.03,0.03,0.03,0.04,0.05,0.07,0.09,0.08,0.07,0.06,0.05,0.04,0.04]),
    weekend: normalize([0.04,0.03,0.03,0.03,0.03,0.03,0.04,0.07,0.09,0.09,0.07,0.05,0.04,0.04,0.04,0.05,0.06,0.08,0.08,0.07,0.06,0.05,0.04,0.03]),
  },
  water_heating: {
    weekday: normalize([0.01,0.01,0.01,0.01,0.01,0.02,0.07,0.12,0.10,0.06,0.04,0.03,0.03,0.03,0.03,0.03,0.04,0.07,0.09,0.08,0.06,0.04,0.02,0.01]),
    weekend: normalize([0.01,0.01,0.01,0.01,0.01,0.01,0.02,0.05,0.10,0.12,0.10,0.07,0.05,0.04,0.04,0.04,0.05,0.07,0.08,0.07,0.05,0.03,0.02,0.01]),
  },
  refrigerator: {
    weekday: normalize([0.038,0.037,0.037,0.037,0.038,0.039,0.040,0.042,0.043,0.044,0.043,0.043,0.044,0.043,0.042,0.042,0.043,0.045,0.046,0.045,0.044,0.043,0.041,0.039]),
    weekend: normalize([0.038,0.037,0.037,0.037,0.038,0.038,0.039,0.041,0.044,0.045,0.044,0.044,0.045,0.045,0.043,0.042,0.043,0.045,0.046,0.045,0.043,0.042,0.040,0.038]),
  },
  dishwasher: {
    weekday: normalize([0.01,0.01,0.01,0.01,0.01,0.01,0.01,0.02,0.03,0.03,0.03,0.03,0.04,0.04,0.03,0.03,0.04,0.08,0.14,0.15,0.12,0.08,0.04,0.02]),
    weekend: normalize([0.01,0.01,0.01,0.01,0.01,0.01,0.01,0.02,0.04,0.05,0.06,0.06,0.07,0.07,0.06,0.05,0.06,0.09,0.11,0.10,0.08,0.06,0.04,0.02]),
  },
  washer_dryer: {
    weekday: normalize([0.01,0.01,0.01,0.01,0.01,0.01,0.02,0.05,0.09,0.10,0.09,0.08,0.07,0.06,0.06,0.06,0.07,0.08,0.07,0.06,0.04,0.03,0.02,0.01]),
    weekend: normalize([0.01,0.01,0.01,0.01,0.01,0.01,0.01,0.03,0.07,0.10,0.11,0.11,0.10,0.09,0.08,0.07,0.07,0.07,0.06,0.05,0.04,0.03,0.02,0.01]),
  },
  cooking: {
    weekday: normalize([0.01,0.01,0.01,0.01,0.01,0.02,0.05,0.09,0.07,0.04,0.03,0.03,0.05,0.04,0.03,0.03,0.04,0.10,0.13,0.11,0.08,0.05,0.03,0.01]),
    weekend: normalize([0.01,0.01,0.01,0.01,0.01,0.01,0.02,0.04,0.08,0.10,0.09,0.08,0.07,0.06,0.05,0.05,0.05,0.09,0.11,0.09,0.07,0.05,0.03,0.01]),
  },
  lighting: {
    weekday: normalize([0.01,0.01,0.01,0.01,0.01,0.02,0.04,0.05,0.04,0.03,0.02,0.02,0.02,0.02,0.02,0.03,0.05,0.08,0.10,0.11,0.11,0.09,0.06,0.03]),
    weekend: normalize([0.01,0.01,0.01,0.01,0.01,0.01,0.02,0.03,0.04,0.05,0.05,0.04,0.04,0.04,0.04,0.04,0.05,0.08,0.10,0.11,0.11,0.09,0.06,0.03]),
  },
  plug_loads: {
    weekday: normalize([0.02,0.02,0.02,0.02,0.02,0.02,0.03,0.04,0.05,0.05,0.05,0.04,0.04,0.04,0.05,0.05,0.06,0.07,0.08,0.08,0.08,0.07,0.05,0.03]),
    weekend: normalize([0.02,0.02,0.02,0.02,0.02,0.02,0.02,0.03,0.04,0.05,0.06,0.06,0.06,0.06,0.06,0.06,0.06,0.07,0.08,0.08,0.07,0.06,0.05,0.03]),
  },
  misc_motors: {
    weekday: normalize([0.03,0.03,0.03,0.03,0.03,0.04,0.05,0.05,0.05,0.05,0.04,0.04,0.04,0.04,0.04,0.04,0.05,0.05,0.05,0.05,0.04,0.04,0.04,0.03]),
    weekend: normalize([0.03,0.03,0.03,0.03,0.03,0.03,0.04,0.05,0.05,0.05,0.05,0.05,0.05,0.05,0.04,0.04,0.05,0.05,0.05,0.04,0.04,0.04,0.04,0.03]),
  },
};

// SFR gets slightly different HVAC load shape (afternoon peak more pronounced)
const SFR_HVAC_COOLING = {
  weekday: normalize([0.00,0.00,0.00,0.00,0.00,0.00,0.01,0.02,0.04,0.06,0.08,0.10,0.11,0.11,0.11,0.10,0.09,0.08,0.07,0.06,0.05,0.04,0.02,0.01]),
  weekend: normalize([0.00,0.00,0.00,0.00,0.00,0.00,0.01,0.03,0.05,0.07,0.09,0.11,0.11,0.11,0.10,0.09,0.08,0.07,0.06,0.05,0.04,0.03,0.02,0.01]),
};

// ─── POOL PUMP LOAD PROFILE ───────────────────────────────────────────────────
// Source: CEC Pool Pump Energy Use study + SDG&E interval data benchmarks
// Typical residential pool pump: 1.2 kW variable speed, 6–8 hrs/day
// Runs mid-morning through afternoon to maximize solar offset and avoid peak
// Annual kWh calibrated to ~1,800 kWh/yr (variable speed) per CEC 2022 data
// Seasonal factor: summer filtering demand higher; winter ~50% reduction
// Pool pump is a fixed load — does not scale with occupancy or sqft
const POOL_ANNUAL_KWH = 1800; // kWh/yr, variable-speed pump
const POOL_SEASONAL = { 1:0.60, 2:0.65, 3:0.80, 4:0.90, 5:1.05, 6:1.20, 7:1.25, 8:1.25, 9:1.10, 10:0.95, 11:0.70, 12:0.55 };
const POOL_PROFILE = {
  // Runs 8am–4pm; slight weekend shift later (more afternoon use)
  weekday: normalize([0,0,0,0,0,0,0,0.05,0.12,0.14,0.15,0.14,0.13,0.12,0.10,0.05,0,0,0,0,0,0,0,0]),
  weekend: normalize([0,0,0,0,0,0,0,0,0.05,0.10,0.14,0.15,0.15,0.14,0.12,0.10,0.05,0,0,0,0,0,0,0]),
};

// ─── SPA / HOT TUB LOAD PROFILE ──────────────────────────────────────────────
// Typical residential spa: 5.5 kW heater, thermostat-controlled
// Idle standby ~200W continuous; heating cycles ~1–2 hrs evening + weekly full heat
// Annual kWh: ~2,400 kWh/yr (more in winter — heating against ambient)
// Seasonal factor: inverse of pool — higher load in cool months
const SPA_ANNUAL_KWH = 2400; // kWh/yr
const SPA_SEASONAL = { 1:1.35, 2:1.25, 3:1.10, 4:0.95, 5:0.85, 6:0.80, 7:0.75, 8:0.75, 9:0.85, 10:1.00, 11:1.20, 12:1.35 };
const SPA_PROFILE = {
  // Standby all day; evening heating spike 6–10pm (typical pre-use heating)
  // Plus morning spike 6–8am (overnight recovery)
  weekday: normalize([0.02,0.02,0.02,0.02,0.02,0.02,0.05,0.07,0.04,0.03,0.03,0.03,0.03,0.03,0.03,0.04,0.06,0.09,0.12,0.13,0.10,0.07,0.04,0.03]),
  weekend: normalize([0.02,0.02,0.02,0.02,0.02,0.02,0.04,0.06,0.06,0.05,0.04,0.04,0.04,0.04,0.05,0.07,0.09,0.11,0.12,0.10,0.08,0.06,0.04,0.03]),
};

// ─── EV CHARGING LOAD PROFILE ─────────────────────────────────────────────────
// L2 charger assumed: 7.2 kW max, but average session draw ~6.0 kW accounting for
// ramp-up, thermal management, and battery state taper near full charge.
// Source: NREL EV infrastructure + charging behavior studies; Pecan Street EV data.
//
// Two charging modes:
//   "solar"    — charge during peak solar window (10am–3pm). Maximizes self-consumption
//                of on-site PV. Best for NEM 3.0 / solar owners.
//   "midnight" — charge after midnight (midnight–6am). Minimizes TOU cost on EV-TOU-5
//                (~12¢/kWh super off-peak). Best for non-solar / EV rate customers.
//
// Annual kWh = num_evs × miles_per_year / efficiency_mi_per_kwh
// Load shape: charging is concentrated in the selected window; duration determined by
// daily kWh need divided by charger draw rate.
//
// Seasonal variation: minimal for EVs (slight winter increase from heating energy,
// slight summer increase from AC pre-conditioning). Use flat seasonal factor.

const EV_CHARGER_KW = 6.0;          // average L2 draw during active session (kW)
const EV_SEASONAL = { 1:1.05, 2:1.04, 3:1.01, 4:0.99, 5:0.98, 6:0.99, 7:1.00, 8:1.00, 9:0.99, 10:1.00, 11:1.02, 12:1.04 };

// Hourly shape (normalized, sum=1/day) for each charging mode
// "solar": 10am–3pm window, centered at noon
// "midnight": midnight–6am window, spread evenly
const EV_PROFILES = {
  solar: normalize([
    0,0,0,0,0,0,0,0,0,0.05,0.15,0.20,0.22,0.20,0.13,0.05,0,0,0,0,0,0,0,0
  ]),
  midnight: normalize([
    0.18,0.18,0.18,0.18,0.14,0.14,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0
  ]),
};
const DAYS_IN_MONTH = [31,28,31,30,31,30,31,31,30,31,30,31];
const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// ─── SEEDED PSEUDO-RANDOM (reproducible) ──────────────────────────────────────
function mulberry32(seed) {
  return function() {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function lognormal(rng, mu, sigma) {
  // Box-Muller
  const u1 = rng(), u2 = rng();
  const z = Math.sqrt(-2*Math.log(u1)) * Math.cos(2*Math.PI*u2);
  return Math.exp(mu + sigma * z);
}

// ─── CORE LOAD GENERATOR ──────────────────────────────────────────────────────
function generateIntervals(sqft, occupants, bedrooms, climateZoneKey, buildingTypeKey, fuelConfigKey, year, hasPool, hasSpa, efficiencyPct, evCount, evMilesPerYear, evEfficiency, evChargeMode) {
  const cz = CLIMATE_ZONES[climateZoneKey];
  const bt = BUILDING_TYPES[buildingTypeKey];
  const fc = FUEL_CONFIGS[fuelConfigKey];
  const isSFR = buildingTypeKey === "sfr_detached" || buildingTypeKey === "sfr_attached";

  // Adjust end-use fractions for fuel mix
  const fracs = { ...bt.end_use_fractions };
  let removedFrac = 0;
  for (const [eu, mult] of Object.entries(fc.elec_fraction_multipliers)) {
    if (fracs[eu] !== undefined) {
      removedFrac += fracs[eu] * (1 - mult);
      fracs[eu] *= mult;
    }
  }
  // Redistribute removed fraction to plug_loads and lighting
  fracs.plug_loads += removedFrac * 0.6;
  fracs.lighting   += removedFrac * 0.4;

  // Title 24 efficiency premium — applied to HVAC and water heating only.
  // These are the end-uses governed by envelope, mechanical, and water heating standards.
  // Plug loads, cooking, lighting, and appliance events are not affected.
  const effMult = 1.0 - Math.max(0, Math.min(0.50, (efficiencyPct || 0) / 100));
  ["hvac_cooling", "hvac_heating", "water_heating"].forEach(eu => {
    if (fracs[eu] !== undefined) fracs[eu] *= effMult;
  });

  // Scale base kWh/sqft to this climate zone
  const czScalers = { CZ6: 1.05, CZ7: 1.0, CZ8: 1.30, CZ10: 1.35, CZ14: 1.55 };
  const czScale = czScalers[climateZoneKey] || 1.0;

  // Annual kWh per end-use
  const annualKwh = {};
  const occScale = Math.sqrt(occupants / 1.5);
  const totalBase = bt.base_kwh_per_sqft * czScale * sqft;
  for (const [eu, frac] of Object.entries(fracs)) {
    annualKwh[eu] = totalBase * frac;
    // HVAC doesn't scale with occupancy
    if (!eu.startsWith("hvac")) annualKwh[eu] *= occScale;
  }

  const rng = mulberry32(sqft * 1000 + occupants * 100 + year);

  // ── Normal draw ─────────────────────────────────────────────────────────────
  const normal = () => {
    const u1 = Math.max(1e-10, rng()), u2 = rng();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };

  // ── Poisson draw ─────────────────────────────────────────────────────────────
  const poisson = (lambda) => {
    let n = 0, p = 1.0;
    const L = Math.exp(-lambda);
    do { p *= rng(); if (p > L) n++; } while (p > L);
    return n;
  };

  // ── Physics-based load model (v1.6.0) ────────────────────────────────────────
  // Calibrated to real SDG&E 15-min Green Button data (Jan 2 2026, CZ14):
  //   Real data: CV=0.208, Lag-1 AC=0.585, Lag-4 AC=0.243, jumps>50%: 4.2%
  //   AR(1) model produced continuous drift — real data shows FLAT runs + discrete steps
  //
  // Architecture: interval[t] = baseload + shape-driven load + appliance events + jitter
  //   Baseload: AR(1) φ=0.995 (nearly constant — fridge, standby, router)
  //   Shape: hourly profile drives time-of-day pattern (cooking peaks, evening, etc.)
  //   Appliances: discrete Poisson-scheduled on/off events (dryer, oven, dishwasher…)
  //     Creates realistic sharp steps visible in real meter data
  //   Jitter: tiny residual noise (meter digitization, minor devices)

  const APPLIANCES = [
    // [name, power_fraction_of_base, duration_intervals, daily_rate]
    ["dryer",      2.2, 6,  0.4],
    ["washer",     0.6, 4,  0.4],
    ["dishwasher", 0.4, 8,  0.5],
    ["oven",       1.5, 4,  0.5],
    ["microwave",  1.2, 1,  1.2],
  ];

  const BASELOAD_FRAC = 0.35;
  const BL_PHI   = 0.995;
  const BL_SIG   = 0.025;
  const BL_INNOV = Math.sqrt(1 - BL_PHI * BL_PHI);

  const intervals = [];

  for (let m = 1; m <= 12; m++) {
    const days = DAYS_IN_MONTH[m-1];
    const seasonal = cz.seasonal[m];
    const coolingActive = cz.cooling_months[m] || 0;
    const heatingActive = cz.heating_months[m] || 0;

    for (let d = 0; d < days; d++) {
      const dayOfYear = DAYS_IN_MONTH.slice(0,m-1).reduce((a,b)=>a+b,0) + d;
      const isWeekend = ((dayOfYear + 3) % 7) >= 5;
      const dayType = isWeekend ? "weekend" : "weekday";

      // Build 96-slot shape for this day (Wh per 15-min slot)
      const dayShape96 = new Array(96).fill(0);
      let dayTotal = 0;
      for (const [eu, annKwh] of Object.entries(annualKwh)) {
        let dailyKwh = annKwh * seasonal / 365;
        if (eu === "hvac_cooling") dailyKwh *= coolingActive;
        else if (eu === "hvac_heating") dailyKwh *= heatingActive;
        const profileSet = (isSFR && eu === "hvac_cooling") ? SFR_HVAC_COOLING : PROFILES[eu];
        if (!profileSet) continue;
        for (let h = 0; h < 24; h++) {
          const hWh = dailyKwh * 1000 * profileSet[dayType][h];
          for (let q = 0; q < 4; q++) dayShape96[h*4+q] += hWh / 4;
        }
        dayTotal += dailyKwh * 1000;
      }

      // Day-level factor: between-day variation
      const dayFactor = Math.exp(0.12 * normal());
      const meanInterval = (dayTotal * dayFactor) / 96;
      const baseLevel = meanInterval * BASELOAD_FRAC;

      // Build cumulative shape for event scheduling
      const shapeSum = dayShape96.reduce((a,b)=>a+b,0) || 1;
      let cs = 0;
      const shapeCumsum = dayShape96.map(v => { cs += v/shapeSum; return cs; });

      // Schedule appliance events via Poisson process
      const activeLoads = {};
      for (const [, pwrFrac, dur, dailyRate] of APPLIANCES) {
        const nEvents = poisson(dailyRate);
        for (let ev = 0; ev < nEvents; ev++) {
          const r = rng();
          let start = 95;
          for (let i = 0; i < 96; i++) { if (shapeCumsum[i] >= r) { start = i; break; } }
          const appWh = pwrFrac * baseLevel;
          for (let dd = 0; dd < dur && start+dd < 96; dd++) {
            const t = start+dd;
            activeLoads[t] = (activeLoads[t] || 0) + appWh;
          }
        }
      }

      // Generate 96 interval values
      let blState = 0.0;
      for (let t = 0; t < 96; t++) {
        blState = BL_PHI * blState + BL_INNOV * BL_SIG * normal();
        const bl = Math.max(1, baseLevel * Math.exp(blState));
        const shapeDriven = dayShape96[t] * dayFactor * (1 - BASELOAD_FRAC);
        const appLoad = activeLoads[t] || 0;
        const jitter = baseLevel * 0.03 * Math.abs(normal());
        intervals.push(Math.max(0, bl + shapeDriven + appLoad + jitter));
      }
    }
  }

  // ── Pool pump: add after main loop (fixed load, independent of building model) ─
  if (hasPool) {
    let iIdx = 0;
    for (let m = 1; m <= 12; m++) {
      const days = DAYS_IN_MONTH[m-1];
      const dailyKwh = (POOL_ANNUAL_KWH * POOL_SEASONAL[m]) / 365;
      for (let d = 0; d < days; d++) {
        const dayOfYear = DAYS_IN_MONTH.slice(0,m-1).reduce((a,b)=>a+b,0) + d;
        const dayType = ((dayOfYear + 3) % 7) >= 5 ? "weekend" : "weekday";
        for (let h = 0; h < 24; h++) {
          const hWh = dailyKwh * 1000 * POOL_PROFILE[dayType][h];
          for (let q = 0; q < 4; q++) {
            intervals[iIdx] = (intervals[iIdx] || 0) + hWh / 4;
            iIdx++;
          }
        }
      }
    }
  }

  // ── Spa / hot tub ─────────────────────────────────────────────────────────────
  if (hasSpa) {
    let iIdx = 0;
    for (let m = 1; m <= 12; m++) {
      const days = DAYS_IN_MONTH[m-1];
      const dailyKwh = (SPA_ANNUAL_KWH * SPA_SEASONAL[m]) / 365;
      for (let d = 0; d < days; d++) {
        const dayOfYear = DAYS_IN_MONTH.slice(0,m-1).reduce((a,b)=>a+b,0) + d;
        const dayType = ((dayOfYear + 3) % 7) >= 5 ? "weekend" : "weekday";
        for (let h = 0; h < 24; h++) {
          const hWh = dailyKwh * 1000 * SPA_PROFILE[dayType][h];
          for (let q = 0; q < 4; q++) {
            intervals[iIdx] = (intervals[iIdx] || 0) + hWh / 4;
            iIdx++;
          }
        }
      }
    }
  }

  // ── EV Charging ───────────────────────────────────────────────────────────────
  // Annual kWh = EVs × miles/yr ÷ mi/kWh. Injected as a shaped daily load.
  if (evCount && evCount > 0 && evMilesPerYear > 0 && evEfficiency > 0) {
    const evAnnualKwh = evCount * evMilesPerYear / evEfficiency;
    const profile = EV_PROFILES[evChargeMode] || EV_PROFILES.midnight;
    let iIdx = 0;
    for (let m = 1; m <= 12; m++) {
      const days = DAYS_IN_MONTH[m-1];
      const dailyKwh = (evAnnualKwh * EV_SEASONAL[m]) / 365;
      for (let d = 0; d < days; d++) {
        for (let h = 0; h < 24; h++) {
          const hWh = dailyKwh * 1000 * profile[h];
          for (let q = 0; q < 4; q++) {
            intervals[iIdx] = (intervals[iIdx] || 0) + hWh / 4;
            iIdx++;
          }
        }
      }
    }
  }

  return intervals;
}

// ─── SUMMARY STATS ────────────────────────────────────────────────────────────
function computeSummary(intervals, year) {
  const totalWh = intervals.reduce((a, b) => a + b, 0);
  const totalKwh = totalWh / 1000;
  const monthlyKwh = [];
  const monthlyPeakKw = [];
  let idx = 0;
  for (let m = 0; m < 12; m++) {
    const n = DAYS_IN_MONTH[m] * 96;
    const slice = intervals.slice(idx, idx + n);
    const mWh = slice.reduce((a, b) => a + b, 0);
    monthlyKwh.push(mWh / 1000);
    // Peak kW = max 15-min interval * 4 (intervals are Wh per 15 min → kW = Wh/1000 * 4)
    const peakWh15 = Math.max(...slice);
    monthlyPeakKw.push((peakWh15 / 1000) * 4);
    idx += n;
  }
  return { totalKwh, monthlyKwh, monthlyPeakKw, peakWh: Math.max(...intervals) };
}

// ─── ESPI XML BUILDER ─────────────────────────────────────────────────────────
function buildESPIXml(address, sqft, occupants, year, intervals, utilityName, buildingTypeLabel, fuelConfigLabel, climateZoneKey) {
  // Simple UUID v4 using crypto if available, else deterministic
  const makeUuid = (seed) => {
    const h = (n) => n.toString(16).padStart(2,'0');
    const b = Array.from({length:16}, (_,i) => (Math.abs(Math.sin(seed*31+i)*256)|0) % 256);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    return `${h(b[0])}${h(b[1])}${h(b[2])}${h(b[3])}-${h(b[4])}${h(b[5])}-${h(b[6])}${h(b[7])}-${h(b[8])}${h(b[9])}-${h(b[10])}${h(b[11])}${h(b[12])}${h(b[13])}${h(b[14])}${h(b[15])}`;
  };
  const addrHash = address.split('').reduce((a,c)=>a+c.charCodeAt(0),0);
  const safeAddr = address.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const safeUtil = utilityName.replace(/&/g,'&amp;');
  const nowIso = new Date().toISOString().replace(/\.\d{3}Z$/,'Z');
  const BASE = "https://sandbox.greenbuttonalliance.org:8443/DataCustodian/espi/1_1/resource";
  const toEpoch = (y,m,d) => Math.floor(new Date(Date.UTC(y,m,d) + 8*3600*1000).getTime()/1000);

  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom"',
    '      xmlns:espi="http://naesb.org/espi"',
    '      xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"',
    '      xsi:schemaLocation="http://naesb.org/espi espiDerived.xsd">',
    `  <id>urn:uuid:${makeUuid(addrHash+year)}</id>`,
    `  <title>Pre-Construction Load Profile — ${safeAddr}</title>`,
    `  <updated>${nowIso}</updated>`,
    `  <!--`,
    `    WIPOMO GREEN BUTTON EMULATOR v${VERSION}`,
    `    Pre-construction synthetic load profile — not metered data`,
    ``,
    `    Service address : ${safeAddr}`,
    `    Floor area      : ${sqft} sq ft`,
    `    Building type   : ${buildingTypeLabel}`,
    `    Fuel config     : ${fuelConfigLabel}`,
    `    Climate zone    : ${climateZoneKey} (CEC Title 24 Part 6)`,
    `    Rate schedule   : ${utilityName}`,
    `    Occupants       : ${occupants}`,
    `    Simulation year : ${year}`,
    `    Generated       : ${nowIso}`,
    ``,
    `    DATA SOURCES`,
    `    Annual kWh totals  : ${DATA_SOURCES.load_totals}`,
    `    24-hr load shapes  : ${DATA_SOURCES.load_shapes}`,
    `    Occupancy scaling  : ${DATA_SOURCES.occupancy}`,
    `    Climate zone       : ${DATA_SOURCES.climate_zones}`,
    `    Seasonal factors   : ${DATA_SOURCES.seasonal}`,
    `    Appliance events   : ${DATA_SOURCES.appliances}`,
    `    Rate schedules     : ${DATA_SOURCES.rates}`,
    `    File format        : ${DATA_SOURCES.format}`,
    ``,
    `    ESPI dataQualifier=14 (estimated/modeled) per NAESB REQ.21 Table 5`,
    `    qualityOfReading=14 applied to all interval readings and usage summaries`,
    `  -->`,
    '  <!-- ApplicationInformation -->',
    '  <entry>',
    `    <id>urn:uuid:${makeUuid(addrHash+1)}</id>`,
    `    <link rel="self" href="${BASE}/ApplicationInformation/1"/>`,
    '    <title>Wipomo Green Button Emulator</title>',
    '    <content>',
    '      <espi:ApplicationInformation>',
    `        <espi:dataCustodianId>${safeUtil}</espi:dataCustodianId>`,
    '        <espi:dataCustodianApplicationStatus>1</espi:dataCustodianApplicationStatus>',
    `        <espi:dataCustodianResourceEndpoint>${BASE}</espi:dataCustodianResourceEndpoint>`,
    `        <espi:thirdPartyApplicationName>Wipomo Building Load Simulator v${VERSION}</espi:thirdPartyApplicationName>`,
    `        <espi:thirdPartyApplicationDescription>Pre-construction load profile. Annual kWh: NREL ResStock 2024.2. Load shapes: NREL EULP (NREL/TP-5500-80889). Appliance calibration: Pecan Street Dataport. Climate: CEC JA2 ZIP lookup. ESPI dataQualifier=14.</espi:thirdPartyApplicationDescription>`,
    `        <espi:scope>FB=4_5_15;IntervalDuration=900;BlockDuration=monthly;HistoryLength=13</espi:scope>`,
    '      </espi:ApplicationInformation>',
    '    </content>',
    `    <published>${nowIso}</published><updated>${nowIso}</updated>`,
    '  </entry>',
    '',
    '  <!-- LocalTimeParameters: Pacific -->',
    '  <entry>',
    `    <id>urn:uuid:${makeUuid(addrHash+2)}</id>`,
    `    <link rel="self" href="${BASE}/LocalTimeParameters/1"/>`,
    '    <title>Pacific Time</title>',
    '    <content>',
    '      <espi:LocalTimeParameters>',
    '        <espi:dstOffset>3600</espi:dstOffset>',
    '        <espi:tzOffset>-28800</espi:tzOffset>',
    '      </espi:LocalTimeParameters>',
    '    </content>',
    `    <published>${nowIso}</published><updated>${nowIso}</updated>`,
    '  </entry>',
    '',
    '  <!-- UsagePoint -->',
    '  <entry>',
    `    <id>urn:uuid:${makeUuid(addrHash+3)}</id>`,
    `    <link rel="self"    href="${BASE}/Subscription/1/UsagePoint/1"/>`,
    `    <link rel="up"      href="${BASE}/Subscription/1/UsagePoint"/>`,
    `    <link rel="related" href="${BASE}/Subscription/1/UsagePoint/1/MeterReading"/>`,
    `    <title>${safeAddr}</title>`,
    '    <content>',
    '      <espi:UsagePoint>',
    '        <espi:ServiceCategory><espi:kind>1</espi:kind></espi:ServiceCategory>',
    '      </espi:UsagePoint>',
    '    </content>',
    `    <published>${nowIso}</published><updated>${nowIso}</updated>`,
    '  </entry>',
    '',
    '  <!-- ReadingType: 15-min Wh deltaData -->',
    '  <entry>',
    `    <id>urn:uuid:${makeUuid(addrHash+4)}</id>`,
    `    <link rel="self" href="${BASE}/ReadingType/1"/>`,
    '    <title>15-min Electricity Consumption</title>',
    '    <content>',
    '      <espi:ReadingType>',
    '        <espi:accumulationBehaviour>4</espi:accumulationBehaviour>',
    '        <espi:commodity>1</espi:commodity>',
    '        <espi:dataQualifier>14</espi:dataQualifier>',
    '        <espi:flowDirection>1</espi:flowDirection>',
    '        <espi:intervalLength>900</espi:intervalLength>',
    '        <espi:kind>12</espi:kind>',
    '        <espi:powerOfTenMultiplier>0</espi:powerOfTenMultiplier>',
    '        <espi:uom>72</espi:uom>',
    '      </espi:ReadingType>',
    '    </content>',
    `    <published>${nowIso}</published><updated>${nowIso}</updated>`,
    '  </entry>',
    '',
    '  <!-- MeterReading -->',
    '  <entry>',
    `    <id>urn:uuid:${makeUuid(addrHash+5)}</id>`,
    `    <link rel="self"    href="${BASE}/Subscription/1/UsagePoint/1/MeterReading/1"/>`,
    `    <link rel="up"      href="${BASE}/Subscription/1/UsagePoint/1/MeterReading"/>`,
    `    <link rel="related" href="${BASE}/Subscription/1/UsagePoint/1/MeterReading/1/IntervalBlock"/>`,
    '    <title>Electricity Meter</title>',
    '    <content><espi:MeterReading/></content>',
    `    <published>${nowIso}</published><updated>${nowIso}</updated>`,
    '  </entry>',
    '',
  ];

  // IntervalBlocks — one per month
  let iIdx = 0;
  for (let m = 0; m < 12; m++) {
    const days = DAYS_IN_MONTH[m];
    const n = days * 96;
    const blockStart = toEpoch(year, m, 1);
    const blockDur = days * 86400;
    let monthWh = 0;

    lines.push(`  <!-- IntervalBlock Month ${m+1}: ${MONTH_NAMES[m]} -->`);
    lines.push('  <entry>');
    lines.push(`    <id>urn:uuid:${makeUuid(addrHash+100+m)}</id>`);
    lines.push(`    <link rel="self" href="${BASE}/Subscription/1/UsagePoint/1/MeterReading/1/IntervalBlock/${m+1}"/>`);
    lines.push(`    <title>${MONTH_NAMES[m]} ${year}</title>`);
    lines.push('    <content>');
    lines.push('      <espi:IntervalBlock>');
    lines.push('        <espi:interval>');
    lines.push(`          <espi:duration>${blockDur}</espi:duration>`);
    lines.push(`          <espi:start>${blockStart}</espi:start>`);
    lines.push('        </espi:interval>');

    let epoch = blockStart;
    for (let i = 0; i < n && iIdx < intervals.length; i++, iIdx++) {
      const v = Math.round(intervals[iIdx]);
      monthWh += v;
      lines.push('        <espi:IntervalReading>');
      lines.push('          <espi:timePeriod>');
      lines.push(`            <espi:duration>900</espi:duration>`);
      lines.push(`            <espi:start>${epoch}</espi:start>`);
      lines.push('          </espi:timePeriod>');
      lines.push(`          <espi:value>${v}</espi:value>`);
      lines.push('        </espi:IntervalReading>');
      epoch += 900;
    }

    lines.push('      </espi:IntervalBlock>');
    lines.push('    </content>');
    lines.push(`    <published>${nowIso}</published><updated>${nowIso}</updated>`);
    lines.push('  </entry>');
    lines.push('');

    // UsageSummary
    const kwh = monthWh / 1000;
    const billEspi = Math.round((kwh <= 341 ? kwh*38.4 : 341*38.4+(kwh-341)*48.3)*1000);
    lines.push(`  <!-- ElectricPowerUsageSummary Month ${m+1} -->`);
    lines.push('  <entry>');
    lines.push(`    <id>urn:uuid:${makeUuid(addrHash+200+m)}</id>`);
    lines.push(`    <link rel="self" href="${BASE}/Subscription/1/UsagePoint/1/ElectricPowerUsageSummary/${m+1}"/>`);
    lines.push(`    <title>Usage Summary ${MONTH_NAMES[m]} ${year}</title>`);
    lines.push('    <content>');
    lines.push('      <espi:ElectricPowerUsageSummary>');
    lines.push('        <espi:billingPeriod>');
    lines.push(`          <espi:duration>${blockDur}</espi:duration>`);
    lines.push(`          <espi:start>${blockStart}</espi:start>`);
    lines.push('        </espi:billingPeriod>');
    lines.push(`        <espi:billLastPeriod>${billEspi}</espi:billLastPeriod>`);
    lines.push('        <espi:currency>840</espi:currency>');
    lines.push('        <espi:overallConsumptionLastPeriod>');
    lines.push('          <espi:powerOfTenMultiplier>0</espi:powerOfTenMultiplier>');
    lines.push('          <espi:uom>72</espi:uom>');
    lines.push(`          <espi:value>${monthWh}</espi:value>`);
    lines.push('        </espi:overallConsumptionLastPeriod>');
    lines.push('        <espi:qualityOfReading>14</espi:qualityOfReading>');
    lines.push('      </espi:ElectricPowerUsageSummary>');
    lines.push('    </content>');
    lines.push(`    <published>${nowIso}</published><updated>${nowIso}</updated>`);
    lines.push('  </entry>');
    lines.push('');
  }

  lines.push('</feed>');
  return lines.join('\n');
}

// ─── CSV BUILDER (SDG&E Green Button CSV format) ──────────────────────────────
// Matches the column format accepted by Energy Toolbase, Aurora Solar,
// Helioscope, and other solar proposal tools that accept SDG&E interval data.
// Format: DATE, START TIME, END TIME, USAGE (kWh), NOTES
// One row per 15-min interval. Header block matches SDG&E My Energy Center output.

function buildCSV(params, intervals) {
  const {
    address, year, buildingTypeLabel, fuelConfigLabel, climateZoneKey,
    isMF, units, sqft, occupants, bedrooms,
    hasPool, hasSpa, efficiencyPct,
    evCount, evMiles, evEfficiency, evChargeMode,
  } = params;

  const rows = [];
  rows.push("\uFEFF"); // UTF-8 BOM for Excel
  rows.push("Electric - Energy Usage Details");
  rows.push("");
  rows.push(`Account Number:,PRE-CONSTRUCTION-MODEL`);
  rows.push(`Service Address:,"${address}"`);
  rows.push(`Generated by:,Wipomo Green Button Emulator v${VERSION}`);
  rows.push(`Generated at:,${new Date().toISOString()}`);
  rows.push("");
  rows.push("INPUT PARAMETERS");
  rows.push(`Building type:,"${buildingTypeLabel}"`);
  rows.push(`Climate zone:,"${climateZoneKey} (CEC Title 24 Part 6)"`);
  rows.push(`Simulation year:,${year}`);
  if (isMF) {
    rows.push(`Units:,${units.length}`);
    units.forEach((u, i) => {
      rows.push(`Unit ${i+1}:,"${u.label} | ${u.sqft} sqft | ${u.bedrooms}BR | ${u.occupants} occ | ${FUEL_CONFIGS[u.fuelConfig].label}"`);
    });
  } else {
    rows.push(`Floor area:,"${sqft} sq ft"`);
    rows.push(`Bedrooms:,${bedrooms}`);
    rows.push(`Occupants:,${occupants}`);
    rows.push(`Fuel configuration:,"${fuelConfigLabel}"`);
  }
  rows.push(`Title 24 efficiency premium:,"${parseFloat(efficiencyPct) > 0 ? efficiencyPct + '% (HVAC + water heating only)' : 'None (0%)'}"`);
  rows.push(`Pool:,${hasPool ? 'Yes (~1,800 kWh/yr variable-speed pump)' : 'No'}`);
  rows.push(`Spa / hot tub:,${hasSpa ? 'Yes (~2,400 kWh/yr thermostat-controlled)' : 'No'}`);
  if (parseInt(evCount) > 0) {
    rows.push(`EV charging:,"${evCount} EV${evCount>1?'s':''} | ${evMiles} mi/yr | ${evEfficiency} mi/kWh | ${evChargeMode === 'solar' ? 'solar window 10am–3pm' : 'overnight 12am–6am'} | L2 assumed"`);
    rows.push(`EV annual kWh:,${((parseInt(evCount)||0)*(parseFloat(evMiles)||0)/(parseFloat(evEfficiency)||3.5)).toFixed(0)}`);
  } else {
    rows.push(`EV charging:,None`);
  }
  rows.push("");
  rows.push("DATA SOURCES");
  rows.push(`Annual kWh:,"${DATA_SOURCES.load_totals}"`);
  rows.push(`Load shapes:,"${DATA_SOURCES.load_shapes}"`);
  rows.push(`Appliance calibration:,"${DATA_SOURCES.appliances}"`);
  rows.push(`Climate zone lookup:,"${DATA_SOURCES.climate_zones}"`);
  rows.push(`Seasonal factors:,"${DATA_SOURCES.seasonal}"`);
  rows.push(`Note:,"Pre-construction modeled load profile — not metered data. ESPI dataQualifier=14 (modeled)."`);
  rows.push("");
  rows.push("DATE,START TIME,END TIME,USAGE (kWh),NOTES");

  let iIdx = 0;
  for (let m = 0; m < 12; m++) {
    const days = DAYS_IN_MONTH[m];
    const month = m + 1;
    const mm = String(month).padStart(2, "0");
    for (let d = 0; d < days; d++) {
      const day = d + 1;
      const dd = String(day).padStart(2, "0");
      const dateStr = `${year}-${mm}-${dd}`;
      for (let h = 0; h < 24; h++) {
        const hh = String(h).padStart(2, "0");
        for (let q = 0; q < 4; q++) {
          if (iIdx >= intervals.length) break;
          const wh = intervals[iIdx++];
          const kwh = (wh / 1000).toFixed(3);
          const startMin = q * 15;
          const endMin = startMin + 15;
          const endH = endMin === 60 ? String(h + 1).padStart(2, "0") : hh;
          const startMM = String(startMin).padStart(2, "0");
          const endMM = String(endMin === 60 ? 0 : endMin).padStart(2, "0");
          rows.push(`${dateStr},${hh}:${startMM},${endH}:${endMM},${kwh},Modeled`);
        }
      }
    }
  }
  return rows.join("\n");
}

// ─── SUMMARY CSV BUILDER ──────────────────────────────────────────────────────
// Produced alongside every XML/CSV download. Contains all input parameters
// and all summary statistics in a compact tabular format for record-keeping.

function buildSummaryCSV(params, summary) {
  const {
    address, year, buildingTypeLabel, fuelConfigLabel, climateZoneKey,
    isMF, units, sqft, occupants, bedrooms,
    hasPool, hasSpa, efficiencyPct,
    evCount, evMiles, evEfficiency, evChargeMode,
  } = params;

  const rows = [];
  rows.push("\uFEFF");
  rows.push(`Wipomo Green Button Emulator v${VERSION} — Model Summary`);
  rows.push(`Generated:,${new Date().toISOString()}`);
  rows.push("");

  rows.push("INPUTS");
  rows.push("Parameter,Value");
  rows.push(`Service address,"${address}"`);
  rows.push(`Simulation year,${year}`);
  rows.push(`Building type,"${buildingTypeLabel}"`);
  rows.push(`Climate zone,"${climateZoneKey}"`);
  if (isMF) {
    rows.push(`Number of units,${units.length}`);
    rows.push(`Total floor area (sqft),${units.reduce((a,u)=>a+(parseFloat(u.sqft)||0),0).toFixed(0)}`);
    rows.push(`Fuel configurations,"${[...new Set(units.map(u=>FUEL_CONFIGS[u.fuelConfig].label))].join(' | ')}"`);
  } else {
    rows.push(`Floor area (sqft),${sqft}`);
    rows.push(`Bedrooms,${bedrooms}`);
    rows.push(`Occupants,${occupants}`);
    rows.push(`Fuel configuration,"${fuelConfigLabel}"`);
  }
  rows.push(`Title 24 efficiency premium (%),${efficiencyPct || 0}`);
  rows.push(`Pool,${hasPool ? 'Yes' : 'No'}`);
  rows.push(`Spa / hot tub,${hasSpa ? 'Yes' : 'No'}`);
  rows.push(`EV count,${evCount || 0}`);
  rows.push(`EV miles per year,${evMiles || 0}`);
  rows.push(`EV efficiency (mi/kWh),${evEfficiency || 0}`);
  rows.push(`EV charge mode,${evChargeMode || 'midnight'}`);
  rows.push(`EV annual kWh,${parseInt(evCount) > 0 ? ((parseInt(evCount)||0)*(parseFloat(evMiles)||0)/(parseFloat(evEfficiency)||3.5)).toFixed(0) : 0}`);
  rows.push("");

  if (isMF) {
    rows.push("UNIT DETAIL");
    rows.push("Unit,Label,Sqft,Bedrooms,Occupants,Fuel Config");
    units.forEach((u, i) => {
      rows.push(`U${i+1},"${u.label}",${u.sqft},${u.bedrooms},${u.occupants},"${FUEL_CONFIGS[u.fuelConfig].label}"`);
    });
    rows.push("");
  }

  rows.push("ANNUAL SUMMARY");
  rows.push("Metric,Value,Unit");
  rows.push(`Annual total,${summary.totalKwh.toFixed(1)},kWh`);
  rows.push(`Monthly average,${(summary.totalKwh/12).toFixed(1)},kWh`);
  rows.push(`Daily average,${(summary.totalKwh/365).toFixed(2)},kWh`);
  rows.push(`Annual peak demand,${Math.max(...summary.monthlyPeakKw).toFixed(2)},kW`);
  rows.push(`Minimum monthly peak,${Math.min(...summary.monthlyPeakKw).toFixed(2)},kW`);
  rows.push("");

  rows.push("MONTHLY kWh");
  rows.push(MONTH_NAMES.join(","));
  rows.push(summary.monthlyKwh.map(v => v.toFixed(1)).join(","));
  rows.push("");

  rows.push("MONTHLY PEAK kW");
  rows.push(MONTH_NAMES.join(","));
  rows.push(summary.monthlyPeakKw.map(v => v.toFixed(2)).join(","));
  rows.push("");

  rows.push("DATA SOURCES");
  rows.push(`Annual kWh,"${DATA_SOURCES.load_totals}"`);
  rows.push(`Load shapes,"${DATA_SOURCES.load_shapes}"`);
  rows.push(`Appliance calibration,"${DATA_SOURCES.appliances}"`);
  rows.push(`Climate zone,"${DATA_SOURCES.climate_zones}"`);
  rows.push(`Seasonal factors,"${DATA_SOURCES.seasonal}"`);

  return rows.join("\n");
}

// ─── DOWNLOAD HELPERS ─────────────────────────────────────────────────────────
function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ─── DESIGN TOKENS ────────────────────────────────────────────────────────────
const C = {
  bg:      "#0a0f1a",
  surface: "#111827",
  card:    "#1a2234",
  border:  "#1e3a5f",
  accent:  "#00c2ff",
  accent2: "#0066cc",
  text:    "#e8f4ff",
  muted:   "#9bbdd8",
  faint:   "#6b8db5",
  green:   "#00e5a0",
  orange:  "#ff8c42",
  red:     "#ff4757",
};

const inputStyle = {
  background: C.surface,
  border: `1px solid ${C.border}`,
  borderRadius: 6,
  color: C.text,
  padding: "8px 12px",
  fontSize: 13,
  width: "100%",
  boxSizing: "border-box",
  outline: "none",
  fontFamily: "'DM Mono', monospace",
};

const selectStyle = { ...inputStyle, cursor: "pointer" };
const labelStyle = { fontSize: 11, color: C.muted, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 5, display: "block" };

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
function App() {
  const [address,       setAddress]       = useState("");
  const [sqft,          setSqft]          = useState(568);
  const [bedrooms,      setBedrooms]      = useState(2);
  const [occupants,     setOccupants]     = useState(2.4);
  const [climateZone,   setClimateZone]   = useState("CZ7");
  const [buildingType,  setBuildingType]  = useState("multifamily");
  const [fuelConfig,    setFuelConfig]    = useState("all_electric");
  const [year,          setYear]          = useState(2025);
  const [hasPool,       setHasPool]       = useState(false);
  const [hasSpa,        setHasSpa]        = useState(false);
  const [efficiencyPct, setEfficiencyPct] = useState(0);
  // EV charging
  const [evCount,       setEvCount]       = useState(0);
  const [evMiles,       setEvMiles]       = useState(12000);
  const [evEfficiency,  setEvEfficiency]  = useState(3.5);  // mi/kWh — ~280 Wh/mi, typical L2 BEV
  const [evChargeMode,  setEvChargeMode]  = useState("midnight");
  const [status,        setStatus]        = useState("idle");
  const [summary,       setSummary]       = useState(null);
  const [xmlContent,    setXmlContent]    = useState(null);
  const [csvContent,    setCsvContent]    = useState(null);
  const [summaryContent,setSummaryContent]= useState(null);
  const [progress,      setProgress]      = useState(0);
  // Multifamily per-unit configuration
  const [units,         setUnits]         = useState(DEFAULT_UNITS);
  const [unitCount,     setUnitCount]     = useState(6);

  const isMF = buildingType === "multifamily";

  const handleAddressChange = (val) => {
    setAddress(val);
    const inferred = inferClimateZone(val);
    if (inferred && CLIMATE_ZONES[inferred]) setClimateZone(inferred);
  };

  const handleBedroomsChange = (val) => {
    const br = parseInt(val) || 1;
    setBedrooms(br);
    setOccupants(parseFloat((Math.max(1.0, br * 1.2)).toFixed(1)));
  };

  const handleUnitCountChange = (n) => {
    const newN = Math.max(1, Math.min(24, parseInt(n) || 1));
    setUnitCount(newN);
    setUnits(prev => {
      if (newN === prev.length) return prev;
      if (newN < prev.length) return prev.slice(0, newN);
      const next = [...prev];
      for (let i = prev.length; i < newN; i++) {
        next.push(makeUnit(`U${i+1}`, `Unit ${i+1}`, 750, 2, 2.4, "all_electric"));
      }
      return next;
    });
  };

  const generate = useCallback(() => {
    if (!address.trim()) return;
    setStatus("running");
    setProgress(0);
    setSummary(null);
    setXmlContent(null);
    setCsvContent(null);
    setSummaryContent(null);

    // Capture current values for the closure
    const _buildingType  = buildingType;
    const _sqft          = parseFloat(sqft);
    const _occupants     = parseFloat(occupants);
    const _bedrooms      = parseInt(bedrooms);
    const _climateZone   = climateZone;
    const _fuelConfig    = fuelConfig;
    const _year          = parseInt(year);
    const _isMF          = buildingType === "multifamily";
    const _units         = units;
    const _hasPool       = hasPool;
    const _hasSpa        = hasSpa;
    const _efficiencyPct = parseFloat(efficiencyPct) || 0;
    const _evCount       = parseInt(evCount) || 0;
    const _evMiles       = parseFloat(evMiles) || 0;
    const _evEfficiency  = parseFloat(evEfficiency) || 3.5;
    const _evChargeMode  = evChargeMode;

    setTimeout(() => {
      try {
        setProgress(15);
        let intervals;

        if (_isMF) {
          // Generate per-unit intervals and sum into one building meter
          // Pool and spa added once at building level, not per-unit
          const totalIntervals = DAYS_IN_MONTH.reduce((a, b) => a + b, 0) * 96;
          const agg = new Float64Array(totalIntervals).fill(0);
          _units.forEach((u, i) => {
            if (parseFloat(u.sqft) < 50) return;
            const uIntervals = generateIntervals(
              parseFloat(u.sqft) || 750,
              parseFloat(u.occupants) || 1.5,
              parseInt(u.bedrooms) || 1,
              _climateZone, _buildingType, u.fuelConfig, _year,
              false, false, _efficiencyPct  // pool/spa at building level below
            );
            for (let t = 0; t < uIntervals.length; t++) agg[t] += uIntervals[t];
            setProgress(15 + Math.round(35 * (i + 1) / _units.length));
          });
          intervals = Array.from(agg);
          // Add pool/spa at building level after unit aggregation
          if (_hasPool || _hasSpa) {
            // Pool and spa injected directly at building level
            const dummy = new Array(totalIntervals).fill(0); // unused, kept for reference clarity
            let iIdx = 0;
            if (_hasPool) {
              for (let m = 1; m <= 12; m++) {
                const days = DAYS_IN_MONTH[m-1];
                const dailyKwh = (POOL_ANNUAL_KWH * POOL_SEASONAL[m]) / 365;
                for (let d = 0; d < days; d++) {
                  const doy = DAYS_IN_MONTH.slice(0,m-1).reduce((a,b)=>a+b,0) + d;
                  const dt = ((doy + 3) % 7) >= 5 ? "weekend" : "weekday";
                  for (let h = 0; h < 24; h++) {
                    const hWh = dailyKwh * 1000 * POOL_PROFILE[dt][h];
                    for (let q = 0; q < 4; q++) { intervals[iIdx] += hWh / 4; iIdx++; }
                  }
                }
              }
            }
            iIdx = 0;
            if (_hasSpa) {
              for (let m = 1; m <= 12; m++) {
                const days = DAYS_IN_MONTH[m-1];
                const dailyKwh = (SPA_ANNUAL_KWH * SPA_SEASONAL[m]) / 365;
                for (let d = 0; d < days; d++) {
                  const doy = DAYS_IN_MONTH.slice(0,m-1).reduce((a,b)=>a+b,0) + d;
                  const dt = ((doy + 3) % 7) >= 5 ? "weekend" : "weekday";
                  for (let h = 0; h < 24; h++) {
                    const hWh = dailyKwh * 1000 * SPA_PROFILE[dt][h];
                    for (let q = 0; q < 4; q++) { intervals[iIdx] += hWh / 4; iIdx++; }
                  }
                }
              }
            }
          }
          // EV charging at building level
          if (_evCount > 0 && _evMiles > 0 && _evEfficiency > 0) {
            const evAnnualKwh = _evCount * _evMiles / _evEfficiency;
            const profile = EV_PROFILES[_evChargeMode] || EV_PROFILES.midnight;
            let iIdx = 0;
            for (let m = 1; m <= 12; m++) {
              const days = DAYS_IN_MONTH[m-1];
              const dailyKwh = (evAnnualKwh * EV_SEASONAL[m]) / 365;
              for (let d = 0; d < days; d++) {
                for (let h = 0; h < 24; h++) {
                  const hWh = dailyKwh * 1000 * profile[h];
                  for (let q = 0; q < 4; q++) { intervals[iIdx] += hWh / 4; iIdx++; }
                }
              }
            }
          }
        } else {
          if (!_sqft || _sqft < 50) { setStatus("error"); return; }
          intervals = generateIntervals(_sqft, _occupants, _bedrooms, _climateZone, _buildingType, _fuelConfig, _year, _hasPool, _hasSpa, _efficiencyPct, _evCount, _evMiles, _evEfficiency, _evChargeMode);
        }

        setProgress(60);
        const sum = computeSummary(intervals, _year);
        setSummary(sum);
        setProgress(70);

        const btLabel = BUILDING_TYPES[_buildingType].label;
        const fcLabel = _isMF
          ? `Mixed (${[...new Set(_units.map(u => FUEL_CONFIGS[u.fuelConfig].label))].join(", ")})`
          : FUEL_CONFIGS[_fuelConfig].label;
        const unitDesc = _isMF
          ? `${_units.length} units: ${_units.map(u => `${u.label} ${u.sqft}sqft`).join(" | ")}`
          : `${_sqft} sq ft | Occupants: ${_occupants}`;

        // Build params object — single source of truth for both CSV builders
        const exportParams = {
          address,
          year: _year,
          buildingTypeLabel: btLabel,
          fuelConfigLabel: fcLabel,
          climateZoneKey: _climateZone,
          isMF: _isMF,
          units: _units,
          sqft: _sqft,
          occupants: _occupants,
          bedrooms: _bedrooms,
          hasPool: _hasPool,
          hasSpa: _hasSpa,
          efficiencyPct: _efficiencyPct,
          evCount: _evCount,
          evMiles: _evMiles,
          evEfficiency: _evEfficiency,
          evChargeMode: _evChargeMode,
        };

        const csv = buildCSV(exportParams, intervals);
        setCsvContent(csv);
        setProgress(85);
        const xml = buildESPIXml(address, _isMF ? unitDesc : _sqft, _isMF ? `${_units.length} units` : _occupants, _year, intervals, "Utility", btLabel, fcLabel, _climateZone);
        setXmlContent(xml);
        const summaryCSV = buildSummaryCSV(exportParams, sum);
        setSummaryContent(summaryCSV);
        setProgress(100);
        setStatus("done");
      } catch(e) {
        console.error(e);
        setStatus("error");
      }
    }, 50);
  }, [address, sqft, bedrooms, occupants, climateZone, buildingType, fuelConfig, year, hasPool, hasSpa, efficiencyPct, evCount, evMiles, evEfficiency, evChargeMode, units]);

  const safeName = address.replace(/[^a-zA-Z0-9]/g,'_').slice(0,40);

  const handleDownloadXml = () => {
    if (!xmlContent) return;
    downloadFile(xmlContent, `greenbutton_${safeName}_${year}.xml`, 'application/xml');
    if (summaryContent) downloadFile(summaryContent, `greenbutton_${safeName}_${year}_summary.csv`, 'text/csv');
  };

  const handleDownloadCsv = () => {
    if (!csvContent) return;
    downloadFile(csvContent, `greenbutton_${safeName}_${year}.csv`, 'text/csv');
    if (summaryContent) downloadFile(summaryContent, `greenbutton_${safeName}_${year}_summary.csv`, 'text/csv');
  };

  const cz = CLIMATE_ZONES[climateZone];
  const bt = BUILDING_TYPES[buildingType];

  return (
    <div style={{ background: C.bg, minHeight: "100vh", color: C.text, fontFamily: "'DM Sans', 'DM Mono', sans-serif", padding: "24px 20px" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;600;700&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet"/>

      {/* Header */}
      <div style={{ maxWidth: 860, margin: "0 auto 28px" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 6 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
            <div style={{ fontSize: 11, fontFamily: "'DM Mono', monospace", color: C.accent, letterSpacing: "0.14em", fontWeight: 500 }}>WIPOMO</div>
            <div style={{ width: 1, height: 12, background: C.faint }}/>
            <div style={{ fontSize: 11, fontFamily: "'DM Mono', monospace", color: C.muted, letterSpacing: "0.10em" }}>GREEN BUTTON EMULATOR</div>
            <div style={{ width: 1, height: 12, background: C.faint }}/>
            <div style={{ fontSize: 11, fontFamily: "'DM Mono', monospace", color: C.faint, letterSpacing: "0.08em" }}>v{VERSION}</div>
          </div>
          <a
            href="https://tools.cc-energy.org"
            style={{ fontSize: 11, color: C.faint, textDecoration: "none", fontFamily: "'DM Mono', monospace", letterSpacing: "0.06em" }}
          >
            ← All Tools
          </a>
        </div>
        <h1 style={{ fontSize: 26, fontWeight: 700, color: C.text, margin: "0 0 6px", letterSpacing: "-0.02em" }}>
          Green Button Emulator
        </h1>
        <p style={{ fontSize: 13, color: C.muted, margin: 0, lineHeight: 1.6 }}>
          Generates compliant NAESB ESPI / Green Button XML and CSV files — 35,040 × 15-min interval readings for a full year,
          calibrated to NREL ResStock archetypes for SDG&E territory climate zones.
        </p>
      </div>

      <div style={{ maxWidth: 860, margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>

        {/* LEFT COLUMN — Inputs */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

          {/* Building Info */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 18 }}>
            <div style={{ fontSize: 12, color: C.accent, fontFamily: "'DM Mono', monospace", letterSpacing: "0.1em", marginBottom: 14 }}>01 — BUILDING</div>

            <div style={{ marginBottom: 12 }}>
              <label style={labelStyle}>Service Address</label>
              <input style={inputStyle} value={address} onChange={e=>handleAddressChange(e.target.value)} placeholder="123 Main St, San Diego, CA 92101"/>
              {inferClimateZone(address) && (
                <div style={{ fontSize: 10, color: C.green, marginTop: 4, fontFamily: "'DM Mono', monospace" }}>
                  ✓ ZIP detected → {inferClimateZone(address)} auto-selected
                </div>
              )}
              {address.match(/\b9[0-9]{4}\b/) && !inferClimateZone(address) && (
                <div style={{ fontSize: 10, color: C.orange, marginTop: 4 }}>
                  ZIP not in SDG&E / Orange County lookup — select climate zone manually
                </div>
              )}
            </div>

            {/* Single-unit fields (non-MF) */}
            {!isMF && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 12 }}>
                <div>
                  <label style={labelStyle}>Sq Ft</label>
                  <input style={inputStyle} type="number" value={sqft} onChange={e=>setSqft(e.target.value)} min={50} max={20000}/>
                </div>
                <div>
                  <label style={labelStyle}>Bedrooms</label>
                  <input style={inputStyle} type="number" value={bedrooms} min={0} onChange={e=>handleBedroomsChange(e.target.value)} placeholder="e.g. 3"/>
                </div>
                <div>
                  <label style={labelStyle}>Occupants</label>
                  <input style={inputStyle} type="number" value={occupants} step={0.1} min={0.5} onChange={e=>setOccupants(e.target.value)}/>
                </div>
              </div>
            )}

            <div style={{ marginBottom: 12 }}>
              <label style={labelStyle}>Building Type</label>
              <select style={selectStyle} value={buildingType} onChange={e=>setBuildingType(e.target.value)}>
                {Object.entries(BUILDING_TYPES).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}
              </select>
              <div style={{ fontSize: 11, color: C.faint, marginTop: 4 }}>{bt.description}</div>
            </div>

            <div>
              <label style={labelStyle}>Simulation Year</label>
              <select style={selectStyle} value={year} onChange={e=>setYear(e.target.value)}>
                {[2024,2025,2026].map(y=><option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          </div>

          {/* Multifamily Unit Configuration */}
          {isMF && (
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 18 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                <div style={{ fontSize: 12, color: C.accent, fontFamily: "'DM Mono', monospace", letterSpacing: "0.1em" }}>01b — UNIT CONFIGURATION</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <label style={{ ...labelStyle, margin: 0, whiteSpace: "nowrap" }}>Units</label>
                  <input
                    style={{ ...inputStyle, width: 52, padding: "5px 8px", fontSize: 12 }}
                    type="number" value={unitCount} min={1} max={24}
                    onChange={e=>handleUnitCountChange(e.target.value)}
                  />
                </div>
              </div>
              <div style={{ fontSize: 11, color: C.faint, marginBottom: 12 }}>
                Each unit generates an independent load profile. The exported file represents the combined building meter.
              </div>

              {/* Unit table */}
              <div style={{ overflowX: "auto" }}>
                {/* Header */}
                <div style={{ display: "grid", gridTemplateColumns: "90px 60px 60px 60px 1fr", gap: 6, marginBottom: 6 }}>
                  {["Unit","Sq Ft","BR","Occ","Fuel"].map(h=>(
                    <div key={h} style={{ fontSize: 9, color: C.muted, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase" }}>{h}</div>
                  ))}
                </div>
                {units.map((u) => (
                  <div key={u.id} style={{ display: "grid", gridTemplateColumns: "90px 60px 60px 60px 1fr", gap: 6, marginBottom: 6, alignItems: "center" }}>
                    <input
                      style={{ ...inputStyle, padding: "5px 7px", fontSize: 11 }}
                      value={u.label}
                      onChange={e=>setUnits(prev=>updateUnit(prev, u.id, "label", e.target.value))}
                    />
                    <input
                      style={{ ...inputStyle, padding: "5px 7px", fontSize: 11 }}
                      type="number" value={u.sqft} min={50} max={5000}
                      onChange={e=>setUnits(prev=>updateUnit(prev, u.id, "sqft", e.target.value))}
                    />
                    <input
                      style={{ ...inputStyle, padding: "5px 7px", fontSize: 11 }}
                      type="number" value={u.bedrooms} min={0}
                      onChange={e=>setUnits(prev=>updateUnit(prev, u.id, "bedrooms", parseInt(e.target.value)))}
                    />
                    <input
                      style={{ ...inputStyle, padding: "5px 7px", fontSize: 11 }}
                      type="number" value={u.occupants} step={0.1} min={0.5} max={10}
                      onChange={e=>setUnits(prev=>updateUnit(prev, u.id, "occupants", e.target.value))}
                    />
                    <select
                      style={{ ...selectStyle, padding: "5px 4px", fontSize: 10 }}
                      value={u.fuelConfig}
                      onChange={e=>setUnits(prev=>updateUnit(prev, u.id, "fuelConfig", e.target.value))}
                    >
                      {Object.entries(FUEL_CONFIGS).map(([k,v])=>(
                        <option key={k} value={k}>{v.label.split(" (")[0]}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 10, color: C.faint, marginTop: 8 }}>
                Total: {units.reduce((a,u)=>a+(parseFloat(u.sqft)||0),0).toLocaleString()} sq ft across {units.length} units
              </div>
            </div>
          )}

          {/* Location & Fuel */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 18 }}>
            <div style={{ fontSize: 12, color: C.accent, fontFamily: "'DM Mono', monospace", letterSpacing: "0.1em", marginBottom: 14 }}>02 — LOCATION & FUEL</div>

            <div style={{ marginBottom: 12 }}>
              <label style={labelStyle}>Climate Zone</label>
              <select style={selectStyle} value={climateZone} onChange={e=>setClimateZone(e.target.value)}>
                {Object.entries(CLIMATE_ZONES).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}
              </select>
              <div style={{ fontSize: 11, color: C.faint, marginTop: 4 }}>{cz.description}</div>
            </div>

            <div>
              <label style={labelStyle}>Fuel Configuration</label>
              {isMF ? (
                <div style={{ fontSize: 11, color: C.faint, padding: "7px 0" }}>
                  Set per unit in the Unit Configuration panel above.
                </div>
              ) : (
                <>
                  <select style={selectStyle} value={fuelConfig} onChange={e=>setFuelConfig(e.target.value)}>
                    {Object.entries(FUEL_CONFIGS).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}
                  </select>
                  <div style={{ fontSize: 11, color: C.faint, marginTop: 4 }}>
                    Affects water heating, cooking, and space heating electricity load fractions.
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Efficiency & Amenities */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 18 }}>
            <div style={{ fontSize: 12, color: C.accent, fontFamily: "'DM Mono', monospace", letterSpacing: "0.1em", marginBottom: 14 }}>03 — EFFICIENCY & AMENITIES</div>

            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>Title 24 Efficiency Premium (%)</label>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <input
                  style={{ ...inputStyle, width: 80 }}
                  type="number" value={efficiencyPct} min={0} max={50} step={1}
                  onChange={e=>setEfficiencyPct(e.target.value)}
                />
                <div style={{ fontSize: 11, color: C.faint, flex: 1 }}>
                  % reduction applied to HVAC and water heating loads only. Default 0.
                </div>
              </div>
              {parseFloat(efficiencyPct) > 0 && (
                <div style={{ fontSize: 10, color: C.green, marginTop: 5, fontFamily: "'DM Mono', monospace" }}>
                  ✓ {efficiencyPct}% reduction on HVAC + water heating (Title 24 envelope/mechanical)
                </div>
              )}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {/* Pool toggle */}
              <div
                onClick={() => setHasPool(p => !p)}
                style={{
                  background: hasPool ? `${C.accent}18` : C.surface,
                  border: `1px solid ${hasPool ? C.accent : C.border}`,
                  borderRadius: 8, padding: "10px 14px", cursor: "pointer",
                  display: "flex", alignItems: "center", gap: 10, userSelect: "none",
                }}
              >
                <div style={{
                  width: 16, height: 16, borderRadius: 3, flexShrink: 0,
                  background: hasPool ? C.accent : "transparent",
                  border: `2px solid ${hasPool ? C.accent : C.muted}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  {hasPool && <span style={{ color: "#000", fontSize: 10, fontWeight: 700 }}>✓</span>}
                </div>
                <div>
                  <div style={{ fontSize: 12, color: C.text, fontWeight: 600 }}>Pool</div>
                  <div style={{ fontSize: 10, color: C.faint }}>~1,800 kWh/yr variable-speed pump</div>
                </div>
              </div>

              {/* Spa toggle */}
              <div
                onClick={() => setHasSpa(p => !p)}
                style={{
                  background: hasSpa ? `${C.accent}18` : C.surface,
                  border: `1px solid ${hasSpa ? C.accent : C.border}`,
                  borderRadius: 8, padding: "10px 14px", cursor: "pointer",
                  display: "flex", alignItems: "center", gap: 10, userSelect: "none",
                }}
              >
                <div style={{
                  width: 16, height: 16, borderRadius: 3, flexShrink: 0,
                  background: hasSpa ? C.accent : "transparent",
                  border: `2px solid ${hasSpa ? C.accent : C.muted}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  {hasSpa && <span style={{ color: "#000", fontSize: 10, fontWeight: 700 }}>✓</span>}
                </div>
                <div>
                  <div style={{ fontSize: 12, color: C.text, fontWeight: 600 }}>Spa / Hot Tub</div>
                  <div style={{ fontSize: 10, color: C.faint }}>~2,400 kWh/yr thermostat-controlled</div>
                </div>
              </div>
            </div>

            {/* EV Charging */}
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.border}30` }}>
              <div style={{ fontSize: 10, color: C.muted, fontWeight: 600, letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 10 }}>EV Charging (L2 · 7.2 kW)</div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 10 }}>
                <div>
                  <label style={labelStyle}>EVs</label>
                  <input style={inputStyle} type="number" value={evCount} min={0} max={20} step={1}
                    onChange={e=>setEvCount(e.target.value)}/>
                </div>
                <div>
                  <label style={labelStyle}>Mi / Year</label>
                  <input style={inputStyle} type="number" value={evMiles} min={1000} max={50000} step={500}
                    onChange={e=>setEvMiles(e.target.value)}/>
                </div>
                <div>
                  <label style={labelStyle}>Mi / kWh</label>
                  <input style={inputStyle} type="number" value={evEfficiency} min={1} max={8} step={0.1}
                    onChange={e=>setEvEfficiency(e.target.value)}/>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {[
                  { key: "solar",    label: "Peak Solar",     sub: "10am–3pm · maximize self-consumption" },
                  { key: "midnight", label: "After Midnight",  sub: "12am–6am · minimize TOU cost" },
                ].map(m => (
                  <div key={m.key}
                    onClick={() => setEvChargeMode(m.key)}
                    style={{
                      background: evChargeMode === m.key ? `${C.green}18` : C.surface,
                      border: `1px solid ${evChargeMode === m.key ? C.green : C.border}`,
                      borderRadius: 8, padding: "9px 12px", cursor: "pointer", userSelect: "none",
                    }}
                  >
                    <div style={{ fontSize: 12, color: evChargeMode === m.key ? C.green : C.text, fontWeight: 600, marginBottom: 2 }}>
                      {evChargeMode === m.key ? "● " : "○ "}{m.label}
                    </div>
                    <div style={{ fontSize: 10, color: C.faint }}>{m.sub}</div>
                  </div>
                ))}
              </div>

              {parseInt(evCount) > 0 && (
                <div style={{ fontSize: 10, color: C.green, marginTop: 8, fontFamily: "'DM Mono', monospace" }}>
                  ✓ {evCount} EV{evCount>1?"s":""} · ~{((parseInt(evCount)||0) * (parseFloat(evMiles)||0) / (parseFloat(evEfficiency)||3.5)).toFixed(0)} kWh/yr · {evChargeMode === "solar" ? "solar window 10am–3pm" : "overnight 12am–6am"}
                </div>
              )}
            </div>
          </div>
          <button
            onClick={generate}
            disabled={status === "running"}
            style={{
              background: status === "running" ? C.faint : `linear-gradient(135deg, ${C.accent2}, ${C.accent})`,
              border: "none", borderRadius: 8, color: "#fff",
              padding: "13px 20px", fontSize: 13, fontWeight: 700,
              fontFamily: "'DM Sans', sans-serif", letterSpacing: "0.04em",
              cursor: status === "running" ? "not-allowed" : "pointer",
              transition: "opacity 0.2s",
              textTransform: "uppercase",
            }}
          >
            {status === "running" ? `Generating… ${progress}%` : "Generate Files"}
          </button>

          {/* Progress bar */}
          {status === "running" && (
            <div style={{ height: 3, background: C.surface, borderRadius: 2, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${progress}%`, background: C.accent, transition: "width 0.3s", borderRadius: 2 }}/>
            </div>
          )}

          {status === "error" && (
            <div style={{ background: "#2a0a0a", border: `1px solid ${C.red}`, borderRadius: 8, padding: 12, fontSize: 12, color: C.red }}>
              Generation failed. Check console for details.
            </div>
          )}
        </div>

        {/* RIGHT COLUMN — Results */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

          {/* Summary stats */}
          {summary && (
            <>
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 18 }}>
                <div style={{ fontSize: 12, color: C.accent, fontFamily: "'DM Mono', monospace", letterSpacing: "0.1em", marginBottom: 14 }}>03 — SUMMARY</div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
                  {[
                    { label: "Annual Total", val: `${summary.totalKwh.toFixed(0)} kWh`, color: C.accent },
                    { label: "Monthly Avg",  val: `${(summary.totalKwh/12).toFixed(0)} kWh`, color: C.text },
                    { label: "Annual Peak",  val: `${((Math.max(...summary.monthlyPeakKw)).toFixed(1))} kW`, color: C.orange },
                    { label: "Avg Daily",    val: `${(summary.totalKwh/365).toFixed(1)} kWh`, color: C.muted },
                  ].map(s=>(
                    <div key={s.label} style={{ background: C.surface, borderRadius: 7, padding: "12px 14px", border: `1px solid ${C.border}` }}>
                      <div style={{ fontSize: 10, color: C.muted, letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 5, fontWeight: 600 }}>{s.label}</div>
                      <div style={{ fontSize: 22, fontWeight: 700, color: s.color, fontFamily: "'DM Mono', monospace" }}>{s.val}</div>
                    </div>
                  ))}
                </div>

                {/* Monthly kWh bar chart */}
                <div style={{ fontSize: 10, color: C.muted, letterSpacing: "0.07em", textTransform: "uppercase", fontWeight: 600, marginBottom: 8 }}>Monthly kWh</div>
                <div style={{ display: "flex", gap: 3, alignItems: "flex-end", height: 60 }}>
                  {summary.monthlyKwh.map((kwh, i) => {
                    const maxKwh = Math.max(...summary.monthlyKwh);
                    const h = Math.max(4, (kwh / maxKwh) * 56);
                    return (
                      <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                        <div style={{ width: "100%", height: h, background: `linear-gradient(180deg, ${C.accent}, ${C.accent2})`, borderRadius: "2px 2px 0 0", opacity: 0.85 }}/>
                        <div style={{ fontSize: 8, color: C.faint, fontFamily: "'DM Mono', monospace" }}>{MONTH_NAMES[i].slice(0,1)}</div>
                      </div>
                    );
                  })}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
                  <div style={{ fontSize: 10, color: C.faint }}>Min: {Math.min(...summary.monthlyKwh).toFixed(0)} kWh</div>
                  <div style={{ fontSize: 10, color: C.faint }}>Max: {Math.max(...summary.monthlyKwh).toFixed(0)} kWh</div>
                </div>

                {/* Monthly peak kW bar chart */}
                <div style={{ fontSize: 10, color: C.muted, letterSpacing: "0.07em", textTransform: "uppercase", fontWeight: 600, marginBottom: 8, marginTop: 16 }}>Monthly Peak kW</div>
                <div style={{ display: "flex", gap: 3, alignItems: "flex-end", height: 60 }}>
                  {summary.monthlyPeakKw.map((kw, i) => {
                    const maxKw = Math.max(...summary.monthlyPeakKw);
                    const h = Math.max(4, (kw / maxKw) * 56);
                    return (
                      <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                        <div style={{ width: "100%", height: h, background: `linear-gradient(180deg, ${C.orange}, #cc5500)`, borderRadius: "2px 2px 0 0", opacity: 0.85 }}/>
                        <div style={{ fontSize: 8, color: C.faint, fontFamily: "'DM Mono', monospace" }}>{MONTH_NAMES[i].slice(0,1)}</div>
                      </div>
                    );
                  })}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
                  <div style={{ fontSize: 10, color: C.faint }}>Min: {Math.min(...summary.monthlyPeakKw).toFixed(1)} kW</div>
                  <div style={{ fontSize: 10, color: C.faint }}>Max: {Math.max(...summary.monthlyPeakKw).toFixed(1)} kW</div>
                </div>
              </div>

              {/* Model parameters */}
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 18 }}>
                <div style={{ fontSize: 12, color: C.accent, fontFamily: "'DM Mono', monospace", letterSpacing: "0.1em", marginBottom: 12 }}>04 — MODEL PARAMETERS</div>
                {[
                  ["Address", address],
                  ["Building type", bt.label],
                  isMF ? ["Units", `${units.length} (${units.reduce((a,u)=>a+(parseFloat(u.sqft)||0),0).toLocaleString()} sq ft total)`] : ["Floor area", `${sqft} sq ft`],
                  isMF ? null : ["Occupants", occupants],
                  ["Climate zone", climateZone],
                  isMF ? ["Fuel configs", [...new Set(units.map(u=>FUEL_CONFIGS[u.fuelConfig].label.split(" (")[0]))].join(", ")] : ["Fuel config", FUEL_CONFIGS[fuelConfig].label],
                  parseFloat(efficiencyPct) > 0 ? ["Efficiency premium", `${efficiencyPct}% (HVAC + water heating)`] : null,
                  hasPool ? ["Pool", "~1,800 kWh/yr"] : null,
                  hasSpa  ? ["Spa/hot tub", "~2,400 kWh/yr"] : null,
                  parseInt(evCount) > 0 ? ["EV charging", `${evCount} EV${evCount>1?"s":""} · ${evMiles} mi/yr · ${evEfficiency} mi/kWh · ${evChargeMode === "solar" ? "solar window" : "overnight"}`] : null,
                  ["Intervals", "35,040 × 15-min"],
                  ["Format", "NAESB ESPI / Green Button"],
                ].filter(Boolean).map(([k,v])=>(
                  <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: `1px solid ${C.border}20`, fontSize: 12 }}>
                    <span style={{ color: C.muted }}>{k}</span>
                    <span style={{ color: C.text, fontFamily: "'DM Mono', monospace", fontSize: 11, textAlign: "right", maxWidth: "55%", wordBreak: "break-all" }}>{v}</span>
                  </div>
                ))}
              </div>

              {/* Download buttons */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <button
                  onClick={handleDownloadXml}
                  style={{
                    background: `linear-gradient(135deg, #004d2e, ${C.green})`,
                    border: "none", borderRadius: 8, color: "#001a0f",
                    padding: "13px 12px", fontSize: 12, fontWeight: 700,
                    fontFamily: "'DM Sans', sans-serif", letterSpacing: "0.04em",
                    cursor: "pointer", textTransform: "uppercase",
                  }}
                >
                  ↓ XML (ESPI)
                </button>
                <button
                  onClick={handleDownloadCsv}
                  style={{
                    background: `linear-gradient(135deg, #003a5c, ${C.accent})`,
                    border: "none", borderRadius: 8, color: "#001220",
                    padding: "13px 12px", fontSize: 12, fontWeight: 700,
                    fontFamily: "'DM Sans', sans-serif", letterSpacing: "0.04em",
                    cursor: "pointer", textTransform: "uppercase",
                  }}
                >
                  ↓ CSV (Excel)
                </button>
              </div>
              <div style={{ display: "flex", gap: 16, fontSize: 10, color: C.faint }}>
                <span>XML — NAESB ESPI, importable into Green Button tools</span>
                <span>CSV — SDG&E format, opens in Excel / Energy Toolbase</span>
              </div>
              <div style={{ fontSize: 10, color: C.faint, marginTop: 4 }}>
                Both buttons also download a <span style={{ color: C.accent }}>_summary.csv</span> with all inputs and monthly statistics.
              </div>

              <div style={{ fontSize: 10, color: C.faint, lineHeight: 1.6, padding: "4px 2px" }}>
                Pre-construction modeled load profile — not metered data. Annual kWh: NREL ResStock 2024.2.
                Load shapes: NREL EULP. Appliance calibration: Pecan Street Dataport.
                Climate zone: CEC Title 24 JA2. Coverage: SDG&E territory (CZ7/CZ10/CZ14) + Orange County (CZ6/CZ8).
                {hasPool && " Pool: ~1,800 kWh/yr (CEC VSP benchmark)."}
                {hasSpa && " Spa: ~2,400 kWh/yr (thermostat-controlled)."}
                {parseFloat(efficiencyPct) > 0 && ` Efficiency: ${efficiencyPct}% reduction on HVAC+WH.`}
                {parseInt(evCount) > 0 && ` EV: ${evCount} vehicle${evCount>1?"s":""} @ ${evMiles} mi/yr, ${evEfficiency} mi/kWh, ${evChargeMode} charging.`}
                {isMF && ` ${units.length} units aggregated into single building meter.`}
                ESPI dataQualifier=14 (modeled) per NAESB REQ.21.
              </div>
            </>
          )}

          {/* Idle state placeholder */}
          {status === "idle" && (
            <div style={{ background: C.card, border: `1px dashed ${C.border}`, borderRadius: 10, padding: 32, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, flex: 1, minHeight: 300 }}>
              <div style={{ fontSize: 36, opacity: 0.3 }}>⚡</div>
              <div style={{ fontSize: 13, color: C.faint, textAlign: "center", lineHeight: 1.6 }}>
                Configure the inputs and click Generate to produce a full-year Green Button XML file.
              </div>
              <div style={{ fontSize: 11, color: C.faint, fontFamily: "'DM Mono', monospace" }}>35,040 × 15-min intervals</div>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div style={{ maxWidth: 860, margin: "20px auto 0", fontSize: 10, color: C.faint, display: "flex", justifyContent: "space-between", paddingTop: 12, borderTop: `1px solid ${C.border}20` }}>
        <span>Wipomo / Green Energy EPC</span>
        <span style={{ fontFamily: "'DM Mono', monospace" }}>Green Button Emulator v{VERSION}</span>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
