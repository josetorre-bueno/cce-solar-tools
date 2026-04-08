// MOD-04 rate_engine — UI module
// Version: v1.6.1
// Part of: Wipomo / CCE Solar Tools
//
// Stage 2 browser UI for MOD-04 rate_engine.
// Requires: rate_engine_v1.4.0.js loaded before this file (provides window.MOD04)
//
// Accepted file formats:
//   Load (Green Button):
//     • SDG&E CSV / MOD-02b synthetic CSV  — DATE, START TIME, END TIME, USAGE (kWh), NOTES
//     • UtilityAPI CSV                     — interval_start, interval_kwh columns
//   PV production (optional):
//     • PVWatts v8 CSV / MOD-09 export     — Month, Day, Hour, AC System Output (W)

const { useState, useCallback, useRef, useMemo } = React;
const { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
        ResponsiveContainer } = Recharts;

// ─── COLORS ───────────────────────────────────────────────────────────────────
const C = {
  bg:      '#0d1117',
  surface: '#161b22',
  card:    '#1c2128',
  border:  '#30363d',
  text:    '#e6edf3',
  muted:   '#8b949e',
  faint:   '#484f58',
  blue:    '#58a6ff',
  green:   '#3fb950',
  orange:  '#d29922',
  red:     '#f85149',
  purple:  '#bc8cff',
  accent:  '#58a6ff',
};

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const VERSION = "1.6.1";

// ─── FILE PARSERS ─────────────────────────────────────────────────────────────
// Normalise different Green Button CSV variants into [[Date, kWh], ...].
// Extraction to MOD-02a (green_button.parser) is planned for Stage 4.

function parseGreenButtonCsv(text) {
  const sample = text.slice(0, 3000);
  if (/interval_start/i.test(sample))              return parseUtilityApiCsv(text);
  if (/Meter Number.*Date.*Start Time/i.test(sample)) return parseSdgeMyEnergyCsv(text);
  return parseSdgeMod02bCsv(text);
}

// SDG&E My Energy Center — actual utility download
// Header: Meter Number, Date, Start Time, Duration, Consumption, Generation, Net
// Date format: M/D/YYYY   Time format: H:MM AM/PM (12-hour)
// Uses the "Net" column (Consumption − Generation) — what the utility bills on.
function parseSdgeMyEnergyCsv(text) {
  const lines = text.split('\n');
  // Find the data header row
  let headerIdx = -1;
  for (let i = 0; i < Math.min(lines.length, 30); i++) {
    if (/Meter Number.*Date.*Start Time.*Consumption/i.test(lines[i])) {
      headerIdx = i; break;
    }
  }
  if (headerIdx < 0) throw new Error(
    'SDG&E My Energy CSV: cannot find data header row.\n' +
    'Expected a row like "Meter Number,Date,Start Time,Duration,Consumption,Generation,Net".'
  );

  const header = lines[headerIdx].split(',').map(h => h.replace(/"/g,'').trim().toLowerCase());
  const dateIdx = header.findIndex(h => h === 'date');
  const timeIdx = header.findIndex(h => h === 'start time');
  // Use Net column if present (net of generation); fall back to Consumption
  let kwhIdx = header.findIndex(h => h === 'net');
  if (kwhIdx < 0) kwhIdx = header.findIndex(h => h === 'consumption');
  if (dateIdx < 0 || timeIdx < 0 || kwhIdx < 0) throw new Error(
    'SDG&E My Energy CSV: missing expected columns.\n' +
    `Found: ${header.join(', ')}`
  );

  const intervals = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    // Handle quoted fields (values may be wrapped in double quotes)
    const cols = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
    if (cols.length <= kwhIdx) continue;
    const dateStr = cols[dateIdx];   // e.g. "4/1/2025"
    const timeStr = cols[timeIdx];   // e.g. "12:00 AM"
    const kwh     = parseFloat(cols[kwhIdx]);
    if (!dateStr || !timeStr || isNaN(kwh)) continue;
    // Parse M/D/YYYY
    const dateParts = dateStr.split('/');
    if (dateParts.length !== 3) continue;
    const mm = dateParts[0].padStart(2, '0');
    const dd = dateParts[1].padStart(2, '0');
    const yyyy = dateParts[2];
    // Parse H:MM AM/PM → 24-hour HH:MM
    const timeParts = timeStr.match(/^(\d+):(\d+)\s*(AM|PM)$/i);
    if (!timeParts) continue;
    let hr  = parseInt(timeParts[1]);
    const mn  = timeParts[2];
    const ampm = timeParts[3].toUpperCase();
    if (ampm === 'AM' && hr === 12) hr = 0;
    if (ampm === 'PM' && hr !== 12) hr += 12;
    const isoStr = `${yyyy}-${mm}-${dd}T${String(hr).padStart(2,'0')}:${mn}:00`;
    const ts = new Date(isoStr);
    if (!isNaN(ts.getTime())) intervals.push([ts, kwh]);
  }
  if (intervals.length < 96) throw new Error(
    `SDG&E My Energy CSV: only ${intervals.length} valid rows found. Check file format.`
  );
  return intervals.sort((a, b) => a[0] - b[0]);
}

// MOD-02b synthetic CSV  (SDG&E format output by Green Button Emulator)
// Data columns: DATE, START TIME, END TIME, USAGE (kWh), NOTES
// Date format: YYYY-MM-DD   Time format: HH:MM (24-hour)
function parseSdgeMod02bCsv(text) {
  const lines = text.split('\n');
  let headerIdx = -1;
  for (let i = 0; i < Math.min(lines.length, 50); i++) {
    if (/DATE.*START TIME.*USAGE/i.test(lines[i])) { headerIdx = i; break; }
  }
  if (headerIdx < 0) throw new Error(
    'Green Button CSV: unrecognised format.\n\n' +
    'Accepted formats:\n' +
    '  • SDG&E My Energy Center download (columns: Meter Number, Date, Start Time, …)\n' +
    '  • MOD-02b Green Button Emulator CSV (columns: DATE, START TIME, END TIME, USAGE)\n' +
    '  • UtilityAPI CSV (columns: interval_start, interval_kwh)\n\n' +
    'First lines of your file:\n' + lines.slice(0, 5).join('\n')
  );
  const intervals = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim().replace(/^\uFEFF/, '');
    if (!line) continue;
    const cols = line.split(',');
    if (cols.length < 4) continue;
    const dateStr  = cols[0].trim().replace(/"/g, '');
    const startStr = cols[1].trim().replace(/"/g, '');
    const kwh      = parseFloat(cols[3]);
    if (!dateStr || !startStr || isNaN(kwh)) continue;
    const isoStr   = `${dateStr}T${startStr.length === 5 ? startStr + ':00' : startStr}`;
    const ts       = new Date(isoStr);
    if (!isNaN(ts.getTime())) intervals.push([ts, kwh]);
  }
  if (intervals.length < 96) throw new Error(
    `MOD-02b CSV: only ${intervals.length} valid rows found. File may be truncated.`
  );
  return intervals.sort((a, b) => a[0] - b[0]);
}

// UtilityAPI interval CSV
// Required columns: interval_start, interval_kwh
function parseUtilityApiCsv(text) {
  const lines = text.trim().split('\n');
  const header = lines[0].split(',').map(h => h.replace(/"/g, '').trim().toLowerCase());
  const sIdx = header.findIndex(h => /interval_start/i.test(h));
  const kIdx = header.findIndex(h => /interval_kwh/i.test(h));
  if (sIdx < 0 || kIdx < 0) throw new Error(
    'UtilityAPI CSV: missing required columns.\n' +
    `Found: ${header.join(', ')}\n` +
    'Expected columns named "interval_start" and "interval_kwh".'
  );
  const intervals = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (!cols[sIdx]) continue;
    const ts  = new Date(cols[sIdx].replace(/"/g, '').trim().replace(' ', 'T'));
    const kwh = parseFloat(cols[kIdx]);
    if (!isNaN(ts.getTime()) && !isNaN(kwh)) intervals.push([ts, kwh]);
  }
  return intervals.sort((a, b) => a[0] - b[0]);
}

// PVWatts v8 CSV — from NREL web calculator or MOD-09 Tracker Analyzer export
// Data header: Month, Day, Hour, AC System Output (W)   (Hour is 1-based)
// Returns { hourly: kWh[8760], systemKwDc: number | null }
function parsePvwattsCsv(text) {
  const lines = text.trim().split('\n');
  // Try to extract system DC capacity from metadata header
  let systemKwDc = null;
  for (let i = 0; i < Math.min(lines.length, 30); i++) {
    const m = lines[i].match(/System DC capacity[,\t]+"?([0-9.]+)/i) ||
              lines[i].match(/system_capacity[,\t]+"?([0-9.]+)/i) ||
              lines[i].match(/DC Nameplate Capacity.*?([0-9.]+)/i) ||
              lines[i].match(/DC System Size[^,]*[,\t]+"?([0-9.]+)/i);
    if (m) { systemKwDc = parseFloat(m[1]); break; }
  }
  // Find data header row
  let headerIdx = -1;
  for (let i = 0; i < Math.min(lines.length, 35); i++) {
    if (/Month.*Day.*Hour.*AC System Output/i.test(lines[i])) { headerIdx = i; break; }
  }
  if (headerIdx < 0) throw new Error(
    'PVWatts CSV: cannot find data header row.\n' +
    'Expected a row containing "Month,Day,Hour,AC System Output (W)".\n' +
    'This format is produced by the NREL PVWatts web calculator and by the MOD-09 Tracker Analyzer export.'
  );
  const hourly = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;
    const cols = line.split(',').map(c => c.replace(/"/g, '').trim());
    const acW  = parseFloat(cols[cols.length - 1]);   // last column = AC Output (W)
    if (!isNaN(acW)) hourly.push(acW / 1000);          // W → kWh/hr
  }
  if (hourly.length < 8760) throw new Error(
    `PVWatts CSV: expected 8760 hourly rows, found ${hourly.length}.\n` +
    'Verify the file is a full-year hourly download, not a monthly summary.'
  );
  return { hourly: hourly.slice(0, 8760), systemKwDc };
}

// ─── LOAD METADATA HELPER ────────────────────────────────────────────────────
function getLoadMeta(intervals) {
  if (!intervals || intervals.length === 0) return null;
  const first    = intervals[0][0];
  const last     = intervals[intervals.length - 1][0];
  const totalKwh = intervals.reduce((s, [, k]) => s + k, 0);
  // Peak kW: scan all intervals (kWh × 4 = kW for 15-min intervals)
  let peakKwh = 0;
  for (let i = 0; i < intervals.length; i++) {
    if (intervals[i][1] > peakKwh) peakKwh = intervals[i][1];
  }
  const year       = first.getFullYear();
  const yearOffset = Math.max(0, year - 2026);
  return {
    dateRange:  `${first.toLocaleDateString()} – ${last.toLocaleDateString()}`,
    totalKwh:   totalKwh,
    peakKw:     peakKwh * 4,
    count:      intervals.length,
    year,
    yearOffset,
  };
}

// ─── CHART DATA HELPERS ───────────────────────────────────────────────────────
function makeBillOnlyChartData(monthly) {
  return monthly.map(m => ({
    month:          m.label,
    'Energy charge': +m.energyCharge.toFixed(2),
    'Customer charge': +m.customerCharge.toFixed(2),
  }));
}

function makeSavingsChartData(baseline, solar) {
  return baseline.monthly.map((bm, i) => ({
    month:    bm.label,
    Baseline: +bm.netBill.toFixed(2),
    Solar:    +solar.monthly[i].netBill.toFixed(2),
    Savings:  +(bm.netBill - solar.monthly[i].netBill).toFixed(2),
  }));
}

// ─── SUB-COMPONENTS ───────────────────────────────────────────────────────────

function Tile({ label, value, sub, color }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
                  padding: '14px 18px', flex: '1 1 150px', minWidth: 140 }}>
      <div style={{ fontSize: 11, color: C.muted, textTransform: 'uppercase',
                    letterSpacing: '0.06em', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: color || C.text }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: C.faint, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function UploadCard({ title, accept, onFile, meta, hint, optional }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  const handleDrop = useCallback(e => {
    e.preventDefault(); setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) onFile(f);
  }, [onFile]);

  return (
    <div style={{ background: C.surface, border: `1px solid ${dragging ? C.blue : C.border}`,
                  borderRadius: 8, padding: 16, flex: '1 1 280px', minWidth: 260 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 4 }}>
        {title}
        {optional && <span style={{ fontSize: 11, color: C.faint, fontWeight: 400,
                                    marginLeft: 8 }}>optional</span>}
      </div>
      {hint && <div style={{ fontSize: 11, color: C.muted, marginBottom: 10 }}>{hint}</div>}
      <div
        style={{ border: `1px dashed ${dragging ? C.blue : C.faint}`, borderRadius: 6,
                 padding: '20px 12px', textAlign: 'center', cursor: 'pointer',
                 transition: 'border-color 0.15s', background: dragging ? '#1a2233' : 'transparent' }}
        onClick={() => inputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        <div style={{ fontSize: 22, marginBottom: 4 }}>📂</div>
        <div style={{ fontSize: 12, color: C.muted }}>Click or drag file here</div>
        <div style={{ fontSize: 11, color: C.faint, marginTop: 2 }}>{accept}</div>
      </div>
      <input ref={inputRef} type="file" accept=".csv,.xml" style={{ display: 'none' }}
             onChange={e => e.target.files[0] && onFile(e.target.files[0])} />

      {meta && (
        <div style={{ marginTop: 12, padding: '10px 12px', background: C.card,
                      borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 12 }}>
          <div style={{ color: C.green, fontWeight: 600, marginBottom: 4, wordBreak: 'break-all', overflowWrap: 'anywhere' }}>✓ {meta.filename}</div>
          {meta.dateRange && (
            <div style={{ color: C.muted }}>{meta.dateRange}</div>
          )}
          {meta.totalKwh != null && (
            <div style={{ color: C.muted }}>
              {(+meta.totalKwh).toLocaleString(undefined, {maximumFractionDigits:0})} kWh total
              {meta.count && ` · ${meta.count.toLocaleString()} intervals`}
            </div>
          )}
          {meta.peakKw != null && (
            <div style={{ color: C.muted }}>Peak demand: {(+meta.peakKw).toFixed(2)} kW</div>
          )}
          {meta.systemKwDc != null && (
            <div style={{ color: C.muted }}>System DC: {meta.systemKwDc} kW</div>
          )}
          {meta.annualKwh != null && (
            <div style={{ color: C.muted }}>
              Annual generation: {(+meta.annualKwh).toLocaleString(undefined,{maximumFractionDigits:0})} kWh
            </div>
          )}
        </div>
      )}
    </div>
  );
}


// ─── EXPORT HELPERS ───────────────────────────────────────────────────────────
function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType || 'text/plain' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function niceMax(val) {
  if (val <= 0) return 100;
  const mag = Math.pow(10, Math.floor(Math.log10(val)));
  for (const m of [1, 1.5, 2, 2.5, 5, 10]) { if (mag * m >= val * 1.0) return mag * m; }
  return mag * 10;
}

function buildSummaryCSV(results) {
  const isBill = results.mode === 'bill';
  const dateStr = new Date().toISOString().slice(0, 10);
  const rows = [
    '# MOD-04 rate_engine -- ' + (isBill ? 'Bill Analysis' : 'Savings Analysis') + ' Summary',
    '# Tool version,v' + VERSION,
    '# Generated,' + dateStr,
    '# Rate schedule,' + (results.rateKey  || ''),
    '# Customer type,' + (results.customerType || ''),
  ];
  if (!isBill) rows.push('# NEM type,' + (results.nemType || ''));
  if (results.loadFilename) rows.push('# Load file,' + results.loadFilename);
  if (results.pvFilename)   rows.push('# PV file,'   + results.pvFilename);
  rows.push('');

  if (isBill) {
    const { bill } = results;
    const hasDemand = bill.breakdown.demandCharge > 0;
    rows.push('--- KEY RESULTS ---');
    rows.push('Annual Bill ($),' + Math.round(bill.totalBill));
    rows.push('Annual Usage (kWh),' + Math.round(bill.annualImportKwh));
    rows.push('Effective Energy Rate ($/kWh),' + bill.effectiveRate.toFixed(4));
    rows.push('Effective Net Rate ($/kWh),'    + bill.effectiveNetRate.toFixed(4));
    rows.push('Annual Customer Charges ($),' + Math.round(bill.breakdown.customerCharge));
    if (hasDemand) {
      rows.push('Annual Demand Charges ($),' + Math.round(bill.breakdown.demandCharge));
      rows.push('Annual Peak Demand (kW),' +
        Math.max(...bill.monthly.map(m => m.maxDemandKw)).toFixed(1));
    }
    rows.push('');
    rows.push('--- MONTHLY DETAIL ---');
    rows.push(hasDemand
      ? 'Month,Import kWh,Peak kWh,Off-Peak kWh,SOP kWh,Peak kW,Demand $,Energy $,Customer $,Total $'
      : 'Month,Import kWh,Peak kWh,Off-Peak kWh,SOP kWh,Energy $,Customer $,Total $');
    let tI=0,tPk=0,tOff=0,tSOP=0,tD=0,tE=0,tC=0,tT=0;
    bill.monthly.forEach(m => {
      tI+=m.importKwh; tPk+=m.peakImportKwh; tOff+=m.offpeakImportKwh;
      tSOP+=m.sopImportKwh; tD+=m.demandCharge; tE+=m.energyCharge;
      tC+=m.customerCharge; tT+=m.netBill;
      const r = [m.label, m.importKwh.toFixed(0), m.peakImportKwh.toFixed(0),
                 m.offpeakImportKwh.toFixed(0), m.sopImportKwh.toFixed(0)];
      if (hasDemand) { r.push(m.maxDemandKw.toFixed(1)); r.push(m.demandCharge.toFixed(2)); }
      r.push(m.energyCharge.toFixed(2)); r.push(m.customerCharge.toFixed(2));
      r.push(m.netBill.toFixed(2));
      rows.push(r.join(','));
    });
    const tr = ['Total', tI.toFixed(0), tPk.toFixed(0), tOff.toFixed(0), tSOP.toFixed(0)];
    if (hasDemand) { tr.push('—'); tr.push(tD.toFixed(2)); }
    tr.push(tE.toFixed(2)); tr.push(tC.toFixed(2)); tr.push(tT.toFixed(2));
    rows.push(tr.join(','));

  } else {
    const { baseline, solar, annualSavings, annualGenKwh, selfConsumption } = results;
    rows.push('--- KEY RESULTS ---');
    rows.push('Baseline Bill ($/yr),' + Math.round(baseline.totalBill));
    rows.push('Solar Bill ($/yr),'    + Math.round(solar.totalBill));
    rows.push('Annual Savings ($/yr),' + Math.round(annualSavings));
    rows.push('Annual Generation (kWh),' + Math.round(annualGenKwh));
    rows.push('Self-Consumption (%),' + (selfConsumption * 100).toFixed(1));
    rows.push('Export Credit ($/yr),' + Math.round(solar.breakdown.exportCredit));
    if (baseline.breakdown.demandCharge > 0)
      rows.push('Demand Savings ($/yr),' + Math.round(
        baseline.breakdown.demandCharge - solar.breakdown.demandCharge));
    rows.push('');
    rows.push('--- MONTHLY DETAIL ---');
    rows.push('Month,Import kWh,Export kWh,Export Credit $,Baseline $,Solar $,Savings $');
    let tI=0,tX=0,tCr=0,tB=0,tS=0,tSv=0;
    baseline.monthly.forEach((bm, i) => {
      const sm = solar.monthly[i];
      const sv = bm.netBill - sm.netBill;
      tI+=sm.importKwh; tX+=sm.exportKwh; tCr+=sm.exportCredit;
      tB+=bm.netBill; tS+=sm.netBill; tSv+=sv;
      rows.push([bm.label, sm.importKwh.toFixed(0), sm.exportKwh.toFixed(0),
                 sm.exportCredit.toFixed(2), bm.netBill.toFixed(2),
                 sm.netBill.toFixed(2), sv.toFixed(2)].join(','));
    });
    rows.push(['Total', tI.toFixed(0), tX.toFixed(0), tCr.toFixed(2),
               tB.toFixed(2), tS.toFixed(2), tSv.toFixed(2)].join(','));
  }
  return rows.join('\n');
}

function drawPng(results) {
  const isBill = results.mode === 'bill';
  const rateKey = results.rateKey || '';
  const dateStr = new Date().toLocaleDateString('en-US',{year:'numeric',month:'short',day:'numeric'});

  // ── Build KPI tile data ──────────────────────────────────────────────────────
  let tiles = [];
  if (isBill) {
    const { bill } = results;
    const hasDemand = bill.breakdown.demandCharge > 0;
    const annualPeakKw = hasDemand ? Math.max(...bill.monthly.map(m => m.maxDemandKw)) : null;
    tiles = [
      { label: 'Annual Bill',      value: '$' + Math.round(bill.totalBill).toLocaleString(),            color: '#d29922' },
      { label: 'Annual Usage',     value: Math.round(bill.annualImportKwh).toLocaleString() + ' kWh',   color: null },
      { label: 'Energy Rate',      value: '$' + bill.effectiveRate.toFixed(4) + '/kWh',                  color: null, sub: 'energy ÷ import kWh' },
      { label: 'Effective Net',    value: '$' + bill.effectiveNetRate.toFixed(4) + '/kWh',               color: null, sub: 'total bill ÷ import kWh' },
      { label: 'Customer Charges', value: '$' + Math.round(bill.breakdown.customerCharge).toLocaleString(), color: null, sub: '12 mo × fixed charge' },
    ];
    if (hasDemand) {
      tiles.push({ label: 'Demand Charges',    value: '$' + Math.round(bill.breakdown.demandCharge).toLocaleString() + '/yr', color: '#f85149', sub: 'monthly peak kW' });
      if (annualPeakKw != null) tiles.push({ label: 'Annual Peak Demand', value: annualPeakKw.toFixed(1) + ' kW', color: null, sub: 'max 15-min demand' });
    }
  } else {
    const { baseline, solar, annualSavings, annualGenKwh, selfConsumption } = results;
    const hasDemand = baseline.breakdown.demandCharge > 0;
    const nemLabel = results.nemType === 'nem3' ? 'NBT rates' : results.nemType === 'nem2' ? 'retail NEM' : 'none';
    tiles = [
      { label: 'Baseline Bill',     value: '$' + Math.round(baseline.totalBill).toLocaleString() + '/yr',  color: '#d29922' },
      { label: 'Solar Bill',        value: '$' + Math.round(solar.totalBill).toLocaleString() + '/yr',     color: '#58a6ff' },
      { label: 'Annual Savings',    value: '$' + Math.round(annualSavings).toLocaleString() + '/yr',       color: '#3fb950' },
      { label: 'Annual Generation', value: Math.round(annualGenKwh).toLocaleString() + ' kWh',             color: null },
      { label: 'Self-Consumption',  value: (selfConsumption * 100).toFixed(1) + '%',                       color: null, sub: 'gen consumed on-site' },
      { label: 'Export Credit',     value: '$' + Math.round(solar.breakdown.exportCredit).toLocaleString() + '/yr', color: null, sub: nemLabel },
    ];
    if (hasDemand) {
      const demandSavings = baseline.breakdown.demandCharge - solar.breakdown.demandCharge;
      tiles.push({ label: 'Demand Savings', value: '$' + Math.round(demandSavings).toLocaleString() + '/yr', color: '#bc8cff', sub: 'peak kW reduction' });
    }
  }

  // ── Layout constants ─────────────────────────────────────────────────────────
  const W       = 900;
  const MARGIN  = 24;
  const TITLE_H = 58;
  const TILE_H  = 76;
  const TILE_GAP = 8;
  const nTiles  = tiles.length;
  const TILE_W  = Math.floor((W - MARGIN * 2 - TILE_GAP * (nTiles - 1)) / nTiles);
  const TILE_TOP = TITLE_H;
  const CHART_TOP = TILE_TOP + TILE_H + 18;
  const CHART_H_AREA = 280;
  const LEGEND_H = 44;
  const FOOTER_H = 22;
  const H = CHART_TOP + CHART_H_AREA + LEGEND_H + FOOTER_H;

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = '#0d1117'; ctx.fillRect(0, 0, W, H);

  // ── Title ────────────────────────────────────────────────────────────────────
  ctx.fillStyle = '#58a6ff'; ctx.font = 'bold 12px Inter,system-ui,sans-serif';
  ctx.textAlign = 'left'; ctx.fillText('MOD-04 RATE ENGINE', MARGIN, 26);
  ctx.fillStyle = '#8b949e'; ctx.font = '11px Inter,system-ui,sans-serif';
  ctx.fillText(rateKey + (results.isCare ? ' (CARE)' : '') + '  ·  ' +
    (isBill ? 'Bill Analysis' : 'Savings Analysis') + '  ·  ' + dateStr, MARGIN, 44);

  // ── Rounded-rect helper ───────────────────────────────────────────────────────
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y,     x + w, y + r,     r);
    ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h); ctx.arcTo(x,     y + h, x,     y + h - r, r);
    ctx.lineTo(x, y + r); ctx.arcTo(x,     y,     x + r,     y,         r);
    ctx.closePath();
  }

  // ── KPI Tiles ────────────────────────────────────────────────────────────────
  tiles.forEach((tile, i) => {
    const tx = MARGIN + i * (TILE_W + TILE_GAP);
    const ty = TILE_TOP;
    ctx.fillStyle = '#1c2128'; roundRect(tx, ty, TILE_W, TILE_H, 6); ctx.fill();
    ctx.strokeStyle = '#30363d'; ctx.lineWidth = 1; roundRect(tx, ty, TILE_W, TILE_H, 6); ctx.stroke();
    // Label
    ctx.fillStyle = '#8b949e'; ctx.font = '10px Inter,system-ui,sans-serif';
    ctx.textAlign = 'left'; ctx.fillText(tile.label, tx + 10, ty + 16);
    // Value — auto-shrink font to fit tile width
    ctx.fillStyle = tile.color || '#e6edf3';
    let fontSize = 15;
    ctx.font = 'bold ' + fontSize + 'px Inter,system-ui,sans-serif';
    while (ctx.measureText(tile.value).width > TILE_W - 16 && fontSize > 9) {
      fontSize -= 1;
      ctx.font = 'bold ' + fontSize + 'px Inter,system-ui,sans-serif';
    }
    ctx.fillText(tile.value, tx + 10, ty + 38);
    // Sub-label
    if (tile.sub) {
      ctx.fillStyle = '#484f58'; ctx.font = '9px Inter,system-ui,sans-serif';
      ctx.fillText(tile.sub, tx + 10, ty + 56);
    }
  });

  // ── Bar Chart ────────────────────────────────────────────────────────────────
  const cL = 60, cR = W - MARGIN;
  const cT = CHART_TOP, cB = CHART_TOP + CHART_H_AREA;
  const cW = cR - cL, cH = cB - cT;

  if (isBill) {
    const { bill } = results;
    const hasDemand = bill.breakdown.demandCharge > 0;
    const maxVal = niceMax(Math.max(...bill.monthly.map(m => m.netBill)) * 1.15);
    const nTicks = 5;
    for (let t = 0; t <= nTicks; t++) {
      const v = maxVal * t / nTicks;
      const y = cB - (v / maxVal) * cH;
      ctx.strokeStyle = '#21262d'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cL, y); ctx.lineTo(cR, y); ctx.stroke();
      ctx.fillStyle = '#8b949e'; ctx.font = '10px Inter,system-ui,sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText('$' + Math.round(v).toLocaleString(), cL - 5, y + 4);
    }
    const gW = cW / 12;
    bill.monthly.forEach((m, i) => {
      const bW = gW * 0.6;
      const x  = cL + i * gW + (gW - bW) / 2;
      let yBot = cB;
      const drawSeg = (val, color) => {
        if (val <= 0) return;
        const h = Math.max(1, (val / maxVal) * cH);
        ctx.fillStyle = color; ctx.fillRect(x, yBot - h, bW, h); yBot -= h;
      };
      drawSeg(m.energyCharge,   '#58a6ff');
      if (hasDemand) drawSeg(m.demandCharge, '#f85149');
      drawSeg(m.customerCharge, '#484f58');
      ctx.fillStyle = '#8b949e'; ctx.font = '10px Inter,system-ui,sans-serif';
      ctx.textAlign = 'center'; ctx.fillText(MONTHS[i], x + bW / 2, cB + 14);
    });
    // Legend
    let lx = cL;
    const legend = [['Energy','#58a6ff']];
    if (hasDemand) legend.push(['Demand','#f85149']);
    legend.push(['Customer','#484f58']);
    ctx.textAlign = 'left';
    legend.forEach(([lbl, col]) => {
      ctx.fillStyle = col; ctx.fillRect(lx, cB + 24, 12, 10);
      ctx.fillStyle = '#8b949e'; ctx.font = '11px Inter,system-ui,sans-serif';
      ctx.fillText(lbl, lx + 16, cB + 34);
      lx += 80 + (lbl.length > 6 ? 20 : 0);
    });

  } else {
    const { baseline, solar } = results;
    const maxVal = niceMax(Math.max(...baseline.monthly.map(m => m.netBill)) * 1.15);
    const nTicks = 5;
    for (let t = 0; t <= nTicks; t++) {
      const v = maxVal * t / nTicks;
      const y = cB - (v / maxVal) * cH;
      ctx.strokeStyle = '#21262d'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cL, y); ctx.lineTo(cR, y); ctx.stroke();
      ctx.fillStyle = '#8b949e'; ctx.font = '10px Inter,system-ui,sans-serif';
      ctx.textAlign = 'right'; ctx.fillText('$' + Math.round(v).toLocaleString(), cL - 5, y + 4);
    }
    const gW = cW / 12;
    baseline.monthly.forEach((bm, i) => {
      const sm = solar.monthly[i];
      const bW = gW * 0.28;
      const bx = cL + i * gW + gW * 0.08;
      const sx = bx + bW + gW * 0.04;
      const drawBar = (val, color, x2) => {
        const h = Math.max(1, (Math.max(0, val) / maxVal) * cH);
        ctx.fillStyle = color; ctx.fillRect(x2, cB - h, bW, h);
      };
      drawBar(bm.netBill, '#d29922', bx);
      drawBar(sm.netBill, '#58a6ff', sx);
      ctx.fillStyle = '#8b949e'; ctx.font = '10px Inter,system-ui,sans-serif';
      ctx.textAlign = 'center'; ctx.fillText(MONTHS[i], cL + i * gW + gW / 2, cB + 14);
    });
    // Legend
    let lx = cL;
    [['Baseline','#d29922'],['Solar','#58a6ff']].forEach(([lbl, col]) => {
      ctx.fillStyle = col; ctx.fillRect(lx, cB + 24, 12, 10);
      ctx.fillStyle = '#8b949e'; ctx.font = '11px Inter,system-ui,sans-serif';
      ctx.textAlign = 'left'; ctx.fillText(lbl, lx + 16, cB + 34);
      lx += 90;
    });
  }

  // ── Footer ───────────────────────────────────────────────────────────────────
  ctx.fillStyle = '#484f58'; ctx.font = '10px Inter,system-ui,sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('MOD-04 Rate Engine v' + VERSION + '  ·  tools.cc-energy.org', W - MARGIN, H - 8);

  const safeName = rateKey.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30);
  canvas.toBlob(blob => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'rate_engine_' + safeName + '_' + new Date().toISOString().slice(0, 10) + '.png';
    a.click(); URL.revokeObjectURL(url);
  }, 'image/png');
}

// ─── USER MANUAL ──────────────────────────────────────────────────────────────
const RATE_ENGINE_MANUAL = [
  {
    heading: "OVERVIEW",
    body: "The Rate Engine applies utility TOU rate schedules to Green Button interval data to reproduce a customer's electricity bill or compute solar savings. Upload a load file to model the existing bill. Add a PV production file to compare baseline vs solar scenarios month by month.",
  },
  {
    heading: "STEP 1 — LOAD DATA (Green Button)",
    bullets: [
      "SDG&E My Energy Center export — click Download My Data → Interval Data. Includes Consumption, Generation, and Net columns. The Net column is used (billing basis).",
      "SDG&E / MOD-02b synthetic CSV — DATE, START TIME, END TIME, USAGE (kWh), NOTES columns.",
      "UtilityAPI CSV — interval_start and interval_kwh columns.",
      "Drag the file onto the upload zone or click to browse. Date range, total kWh, and peak demand are shown after parsing.",
    ],
  },
  {
    heading: "STEP 2 — RATE SCHEDULE",
    bullets: [
      "SDG&E Residential: TOU-DR1 (standard), EV-TOU-5 (NEM 3.0 / EV owners), DR-SES (legacy NEM 2.0 solar), DR (non-TOU baseline tiers).",
      "SDG&E Commercial: TOU-A (< 20 kW demand), AL-TOU (≥ 20 kW), AL-TOU-2 (≥ 20 kW, demand ratchet). Demand charges are based on monthly 15-min peak kW.",
      "APU TOU-2: Anaheim Public Utilities domestic TOU.",
      "SCE and PG&E rates are approximate — verify current tariffs before presenting to customers.",
    ],
  },
  {
    heading: "STEP 3 — PV PRODUCTION (optional)",
    body: "Upload a PVWatts v8 CSV or a MOD-09 Dual-Axis Tracker Analyzer export (Month, Day, Hour, AC System Output columns). When a PV file is loaded, clicking Calculate switches to Savings Mode — comparing the baseline bill against the solar bill month by month.",
  },
  {
    heading: "CUSTOMER TYPE & NEM",
    bullets: [
      "Residential — standard residential TOU rates.",
      "Residential (CARE) — California Alternate Rates for Energy. Energy rates ~35–45% lower. Base Services Charge $0.197/day (vs $0.793/day standard). CARE discount is applied automatically when this mode is selected.",
      "Commercial — demand-based rates (TOU-A, AL-TOU, AL-TOU-2).",
      "NEM 3.0 (NBT) — export credit at CPUC Net Billing Tariff rates. Default for solar interconnected after April 14, 2023.",
      "NEM 2.0 — export credit at full retail TOU rates. For systems interconnected before April 14, 2023.",
      "No export credit — all generation assumed self-consumed; no export credit applied.",
    ],
  },
  {
    heading: "BILL RESULTS (load file only)",
    bullets: [
      "Annual Bill — total electricity cost for the 12-month period.",
      "Annual Usage — total import kWh from the grid.",
      "Energy Rate — effective $/kWh from energy charges only (excludes demand and customer charges).",
      "Effective Net Rate — total bill ÷ import kWh (includes all charge components).",
      "Customer Charges — fixed daily charges annualized ($0.793/day standard, $0.197/day CARE).",
      "Demand Charges — monthly peak kW charges (commercial rates only).",
      "The monthly table shows a full breakdown by TOU period for each month.",
    ],
  },
  {
    heading: "SAVINGS RESULTS (load + PV files)",
    bullets: [
      "Baseline Bill — annual bill without solar.",
      "Solar Bill — annual bill with solar generation applied (net of export credits).",
      "Annual Savings — the difference between baseline and solar bill.",
      "Annual Generation — total PV AC production kWh for the year.",
      "Self-Consumption — fraction of generation consumed on-site.",
      "Export Credit — credit for excess energy sent to the grid at the selected NEM rate.",
    ],
  },
  {
    heading: "EXPORTING",
    bullets: [
      "Export Summary CSV — saves all key results and the full monthly breakdown table. Includes rate schedule, customer type, file names, and all KPI values.",
      "Save Chart PNG — exports the monthly bar chart with dollar values labeled on each bar. Suitable for proposals and presentations.",
    ],
  },
  {
    heading: "DISCLAIMER",
    body: "Bill calculations include energy charges, customer charges, and demand charges where applicable. Baseline allowance credits, CARE baseline adjustment credits, and non-bypassable charges are not modeled. AL-TOU-2 summer demand charges are approximate (winter values verified from actual SDG&E bill). NEM export rates assume full-year operation at the selected tariff.",
  },
];

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
function App() {
  const [loadIntervals,  setLoadIntervals]  = useState(null);
  const [loadMeta,       setLoadMeta]       = useState(null);
  const [pvHourly,       setPvHourly]       = useState(null);
  const [pvMeta,         setPvMeta]         = useState(null);
  const [rateKey,        setRateKey]        = useState('SDG&E EV-TOU-5');
  const [nemType,        setNemType]        = useState('nem3');
  const [parseError,     setParseError]     = useState(null);
  const [results,        setResults]        = useState(null);
  const [customerType,   setCustomerType]   = useState('residential');
  const [showManual,     setShowManual]     = useState(false);

  const isCare = customerType === 'residential_care';
  const baseCustomerType = isCare ? 'residential' : customerType;

  // Verify MOD04 is available
  if (typeof MOD04 === 'undefined') {
    return (
      <div style={{ padding: 32, color: C.red, fontFamily: 'monospace', fontSize: 13 }}>
        Error: MOD04 not loaded. Verify that rate_engine_v1.3.0.js is included in the HTML
        wrapper before this script.
      </div>
    );
  }

  const rates = useMemo(() => {
    if (customerType === 'commercial') return MOD04.listRates('commercial');
    const all = MOD04.listRates('residential');
    if (customerType === 'residential_care') return all.filter(r => r.careAvailable);
    return all;
  }, [customerType]);

  // Auto-suggest NEM type when rate changes
  const handleRateChange = useCallback(key => {
    setRateKey(key);
    const r = (MOD04.ALL_RATES || MOD04.RESIDENTIAL_RATES)[key];
    if (r?.recommendedNem) setNemType(r.recommendedNem);
    setResults(null);
  }, []);

  // ── Load file handler ────────────────────────────────────────────────────
  const handleLoadFile = useCallback(file => {
    setParseError(null); setResults(null); setLoadIntervals(null); setLoadMeta(null);
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const text      = e.target.result;
        const intervals = parseGreenButtonCsv(text);
        const meta      = getLoadMeta(intervals);
        setLoadIntervals(intervals);
        setLoadMeta({ ...meta, filename: file.name });
      } catch (err) {
        setParseError({ source: 'load', message: err.message });
      }
    };
    reader.readAsText(file);
  }, []);

  // ── PV file handler ──────────────────────────────────────────────────────
  const handlePvFile = useCallback(file => {
    setParseError(null); setResults(null); setPvHourly(null); setPvMeta(null);
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const text              = e.target.result;
        const { hourly, systemKwDc } = parsePvwattsCsv(text);
        const annualKwh         = hourly.reduce((s, h) => s + h, 0);
        setPvHourly(hourly);
        setPvMeta({ filename: file.name, systemKwDc, annualKwh });
      } catch (err) {
        setParseError({ source: 'pv', message: err.message });
      }
    };
    reader.readAsText(file);
  }, []);

  // ── Compute ──────────────────────────────────────────────────────────────
  const handleCalculate = useCallback(() => {
    setParseError(null);
    try {
      const yearOffset = loadMeta?.yearOffset ?? 0;

      const _meta = { rateKey, customerType, isCare,
                      loadFilename: loadMeta?.filename || '',
                      pvFilename:   pvMeta?.filename   || '' };
      if (pvHourly) {
        // Savings mode: baseline vs solar
        const savingsResult = MOD04.computeSavings(
          loadIntervals, pvHourly, 1.0, rateKey,
          { nemType, yearOffset, utilEsc: 0.04, care: isCare }
        );
        setResults({ mode: 'savings', ...savingsResult, ..._meta });
      } else {
        // Bill-only mode: reproduce existing bill
        const billResult = MOD04.computeBill(
          loadIntervals, rateKey,
          { nemType: 'none', yearOffset, utilEsc: 0.04, care: isCare }
        );
        setResults({ mode: 'bill', bill: billResult, ..._meta });
      }
    } catch (err) {
      setParseError({ source: 'compute', message: err.message });
    }
  }, [loadIntervals, pvHourly, rateKey, nemType, loadMeta, pvMeta, isCare]);

  const handleDownloadManual = () => {
    const lines = [
      'RATE ENGINE — USER MANUAL',
      'Version ' + VERSION + ' | Center for Community Energy / Makello',
      'Generated: ' + new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'}),
      '',
    ];
    RATE_ENGINE_MANUAL.forEach(sec => {
      lines.push('');
      lines.push('── ' + sec.heading + ' ──');
      lines.push('');
      if (sec.body)    lines.push(sec.body);
      if (sec.bullets) sec.bullets.forEach(b => lines.push('  • ' + b));
      if (sec.body2)   { lines.push(''); lines.push(sec.body2); }
    });
    lines.push('');
    lines.push('──────────────────────────────────────────────────────────────');
    lines.push('Center for Community Energy · tools.cc-energy.org');
    downloadFile(lines.join('\n'), 'rate_engine_manual_v' + VERSION + '.txt', 'text/plain');
  };

  const canCompute = !!loadIntervals;

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text,
                  fontFamily: "'Inter', system-ui, sans-serif" }}>

      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '10px 24px', borderBottom: `1px solid ${C.border}`,
                    background: '#0d1520' }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em',
                      textTransform: 'uppercase', color: C.blue }}>
          CCE / MAKELLO
          <span style={{ color: '#8ab8ff', opacity: 0.7, margin: '0 8px' }}>|</span>
          RATE ENGINE
          <span style={{ color: '#8ab8ff', opacity: 0.7, margin: '0 8px' }}>|</span>
          v{VERSION}
          <span style={{ color: '#8ab8ff', opacity: 0.7, margin: '0 8px' }}>|</span>
          MOD-04
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => setShowManual(true)}
            style={{ padding: '4px 12px', fontSize: 11, fontWeight: 600, borderRadius: 5,
                     background: 'transparent', border: '1px solid #30363d',
                     color: '#8b949e', cursor: 'pointer', fontFamily: "'Inter',monospace",
                     letterSpacing: '0.07em' }}>
            ? HELP
          </button>
          <a href="index.html" style={{ fontSize: 12, color: '#6a9acc',
                                        textDecoration: 'none', fontFamily: 'monospace' }}>
            ← All Tools
          </a>
        </div>
      </div>

      <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 24px 48px' }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: C.text, marginBottom: 4 }}>
          Rate Engine
        </h1>
        <p style={{ fontSize: 13, color: C.muted, marginBottom: 24 }}>
          Apply a utility rate schedule to Green Button interval data.
          Add a PV production file to compute solar savings.
        </p>

        {/* ── Customer type selector ── */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
          {[
            { key: 'residential',      label: 'Residential' },
            { key: 'residential_care', label: 'Residential (CARE)' },
            { key: 'commercial',       label: 'Commercial' },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => {
                setCustomerType(key);
                setResults(null);
                const available = key === 'residential_care'
                  ? MOD04.listRates('residential').filter(r => r.careAvailable)
                  : MOD04.listRates(key === 'commercial' ? 'commercial' : 'residential');
                if (available.length > 0) handleRateChange(available[0].key);
              }}
              style={{
                padding: '6px 18px', fontSize: 12, fontWeight: 600, borderRadius: 20,
                border: `1px solid ${customerType === key ? (key === 'residential_care' ? C.purple : C.blue) : C.border}`,
                background: customerType === key ? (key === 'residential_care' ? '#221a33' : '#1a2d4a') : C.surface,
                color: customerType === key ? (key === 'residential_care' ? C.purple : C.blue) : C.muted,
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* ── CARE mode banner ── */}
        {customerType === 'residential_care' && (
          <div style={{ background: '#1e1530', border: `1px solid ${C.purple}`, borderRadius: 8,
                        padding: '10px 16px', marginBottom: 20, fontSize: 12,
                        display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <span style={{ color: C.purple, fontSize: 16, lineHeight: 1 }}>⚡</span>
            <div>
              <span style={{ color: C.purple, fontWeight: 600 }}>CARE discount applied — </span>
              <span style={{ color: '#c9a9ff' }}>
                Energy rates ~35–45% lower than standard. Base Services Charge: $0.197/day
                (vs $0.793/day standard). Rates verified from CPUC-sanctioned SDG&E tariff PDFs.
                Schedule DR (non-TOU) CARE rates not yet available.
              </span>
            </div>
          </div>
        )}

        {/* ── Error banner ── */}
        {parseError && (
          <div style={{ background: '#2a0e0e', border: `1px solid ${C.red}`, borderRadius: 8,
                        padding: '12px 16px', marginBottom: 20, fontSize: 12 }}>
            <div style={{ color: C.red, fontWeight: 600, marginBottom: 4 }}>
              {parseError.source === 'load' ? 'Load file error' :
               parseError.source === 'pv'   ? 'PV file error' : 'Computation error'}
            </div>
            <div style={{ color: '#f87171', whiteSpace: 'pre-wrap' }}>{parseError.message}</div>
          </div>
        )}

        {/* ── Step 1 + 2 + 3: inputs row ── */}
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>

          {/* Load data */}
          <UploadCard
            title="Green Button Load Data"
            accept=".csv"
            hint="SDG&E My Energy Center download · MOD-02b synthetic CSV · UtilityAPI export"
            onFile={handleLoadFile}
            meta={loadMeta}
          />

          {/* Rate + NEM */}
          <div style={{ background: C.surface, border: `1px solid ${C.border}`,
                        borderRadius: 8, padding: 16, flex: '1 1 220px', minWidth: 200 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 12 }}>
              Rate Schedule
            </div>

            <label style={{ fontSize: 11, color: C.muted, display: 'block', marginBottom: 4 }}>
              Rate plan
            </label>
            <select
              value={rateKey}
              onChange={e => handleRateChange(e.target.value)}
              style={{ width: '100%', background: '#0d1520', color: C.text,
                       border: `1px solid ${C.border}`, borderRadius: 6,
                       padding: '6px 8px', fontSize: 12, marginBottom: 14 }}
            >
              {rates.map(r => (
                <option key={r.key} value={r.key}>{r.key}</option>
              ))}
            </select>

            {customerType === 'commercial' && (
              <div style={{ fontSize: 11, color: C.orange, marginBottom: 14, lineHeight: 1.5 }}>
                Demand charges ($/kW) apply to AL-TOU and AL-TOU-2. Winter AL-TOU-2 values
                verified from SDG&E bill; summer and AL-TOU demand rates are approximate —
                verify before use in proposals.
              </div>
            )}

            {/* Rate note */}
            {(MOD04.ALL_RATES || MOD04.RESIDENTIAL_RATES)[rateKey] && (
              <div style={{ fontSize: 11, color: C.muted, marginBottom: 14,
                            lineHeight: 1.5 }}>
                {(MOD04.ALL_RATES || MOD04.RESIDENTIAL_RATES)[rateKey].rateNote}
              </div>
            )}

            <label style={{ fontSize: 11, color: C.muted, display: 'block', marginBottom: 4 }}>
              Export credit (NEM type)
            </label>
            <select
              value={nemType}
              onChange={e => { setNemType(e.target.value); setResults(null); }}
              disabled={!pvHourly}
              style={{ width: '100%', background: !pvHourly ? '#0a0f14' : '#0d1520',
                       color: !pvHourly ? C.faint : C.text,
                       border: `1px solid ${C.border}`, borderRadius: 6,
                       padding: '6px 8px', fontSize: 12 }}
            >
              <option value="none">No solar / bill analysis only</option>
              <option value="nem3">NEM 3.0 — NBT export credits</option>
              <option value="nem2">NEM 2.0 — retail net metering</option>
            </select>
            {!pvHourly && (
              <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>
                NEM selection applies when a PV file is loaded.
              </div>
            )}
          </div>

          {/* PV production */}
          <UploadCard
            title="PV Production"
            accept=".csv (PVWatts v8 or MOD-09 export)"
            hint="NREL PVWatts web calculator · MOD-09 Tracker Analyzer export"
            onFile={handlePvFile}
            meta={pvMeta ? {
              filename: pvMeta.filename,
              systemKwDc: pvMeta.systemKwDc,
              annualKwh: pvMeta.annualKwh,
            } : null}
            optional
          />
        </div>

        {/* ── Calculate button ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 32 }}>
          <button
            onClick={handleCalculate}
            disabled={!canCompute}
            style={{ padding: '10px 28px', fontSize: 14, fontWeight: 600, borderRadius: 8,
                     background: canCompute ? C.blue : C.faint,
                     color: canCompute ? '#0d1117' : C.muted,
                     border: 'none', cursor: canCompute ? 'pointer' : 'not-allowed',
                     transition: 'background 0.15s' }}
          >
            {pvHourly ? 'Calculate Savings' : 'Calculate Bill'}
          </button>
          {!loadIntervals && (
            <span style={{ fontSize: 12, color: C.muted }}>
              Upload a Green Button file to enable calculation.
            </span>
          )}
          {loadIntervals && !pvHourly && (
            <span style={{ fontSize: 12, color: C.muted }}>
              No PV file — will reproduce bill only (useful for rate validation).
            </span>
          )}
        </div>

        {/* ── Results ── */}
        {results && results.mode === 'bill' && <BillResults results={results} rateKey={rateKey} />}
        {results && results.mode === 'savings' && <SavingsResults results={results} />}

      {/* ── USER MANUAL MODAL ── */}
      {showManual && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(13,17,23,0.94)',
                      zIndex: 1000, overflowY: 'auto', padding: '40px 20px' }}>
          <div style={{ maxWidth: 700, margin: '0 auto', background: '#161b22',
                        border: '1px solid #30363d', borderRadius: 10, padding: '28px 32px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between',
                          alignItems: 'flex-start', marginBottom: 24 }}>
              <div>
                <div style={{ fontSize: 11, color: '#58a6ff', fontFamily: 'monospace',
                               letterSpacing: '0.12em', marginBottom: 6 }}>MOD-04 — USER MANUAL</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: '#e6edf3',
                               letterSpacing: '-0.02em' }}>Rate Engine</div>
                <div style={{ fontSize: 11, color: '#8b949e', fontFamily: 'monospace',
                               marginTop: 4 }}>v{VERSION} · Center for Community Energy / Makello</div>
              </div>
              <div style={{ display: 'flex', gap: 10, flexShrink: 0, marginLeft: 20 }}>
                <button onClick={handleDownloadManual}
                  style={{ padding: '7px 14px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                           background: '#1f6feb', border: '1px solid #388bfd',
                           color: '#fff', cursor: 'pointer', textTransform: 'uppercase',
                           letterSpacing: '0.05em' }}>↓ Download</button>
                <button onClick={() => setShowManual(false)}
                  style={{ padding: '7px 14px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                           background: 'transparent', border: '1px solid #30363d',
                           color: '#8b949e', cursor: 'pointer' }}>✕ Close</button>
              </div>
            </div>
            <div style={{ borderTop: '1px solid #30363d30', paddingTop: 20 }}>
              {RATE_ENGINE_MANUAL.map((sec, i) => (
                <div key={i} style={{ marginBottom: 24 }}>
                  <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#58a6ff',
                                 letterSpacing: '0.1em', textTransform: 'uppercase',
                                 marginBottom: 8, paddingBottom: 5,
                                 borderBottom: '1px solid #30363d30' }}>{sec.heading}</div>
                  {sec.body && <p style={{ fontSize: 13, color: '#8b949e',
                                           lineHeight: 1.7, margin: '0 0 8px' }}>{sec.body}</p>}
                  {sec.bullets && (
                    <ul style={{ paddingLeft: 18, margin: '0 0 8px' }}>
                      {sec.bullets.map((b, j) => (
                        <li key={j} style={{ fontSize: 13, color: '#8b949e',
                                             lineHeight: 1.7, marginBottom: 4 }}>{b}</li>
                      ))}
                    </ul>
                  )}
                  {sec.body2 && <p style={{ fontSize: 13, color: '#8b949e',
                                            lineHeight: 1.7, margin: '8px 0 0' }}>{sec.body2}</p>}
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                          marginTop: 8, paddingTop: 16, borderTop: '1px solid #30363d30' }}>
              <div style={{ fontSize: 10, color: '#8b949e', fontFamily: 'monospace' }}>
                tools.cc-energy.org · Center for Community Energy
              </div>
              <button onClick={() => setShowManual(false)}
                style={{ padding: '7px 20px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                         background: 'transparent', border: '1px solid #30363d',
                         color: '#8b949e', cursor: 'pointer' }}>✕ Close</button>
            </div>
          </div>
        </div>
      )}

      </div>
    </div>
  );
}

// ─── BILL-ONLY RESULTS ────────────────────────────────────────────────────────
function BillResults({ results, rateKey }) {
  const { bill } = results;

  const hasDemand = bill.breakdown.demandCharge > 0;
  const annualPeakKw = hasDemand
    ? Math.max(...bill.monthly.map(m => m.maxDemandKw))
    : null;

  const chartData = useMemo(() => bill.monthly.map(m => {
    const d = {
      month:            m.label,
      'Energy charge':  +m.energyCharge.toFixed(2),
      'Customer charge':+m.customerCharge.toFixed(2),
    };
    if (hasDemand) d['Demand charge'] = +m.demandCharge.toFixed(2);
    return d;
  }), [bill, hasDemand]);

  return (
    <div>
      {/* KPI tiles */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        <Tile label="Annual Bill"     value={`$${Math.round(bill.totalBill).toLocaleString()}`} color={C.orange} />
        <Tile label="Annual Usage"    value={`${Math.round(bill.annualImportKwh).toLocaleString()} kWh`} />
        <Tile label="Energy Rate"     value={`$${bill.effectiveRate.toFixed(4)}/kWh`}
              sub="energy charges ÷ import kWh" />
        <Tile label="Effective Net"   value={`$${bill.effectiveNetRate.toFixed(4)}/kWh`}
              sub="total bill ÷ import kWh" />
        <Tile label="Customer Charges" value={`$${Math.round(bill.breakdown.customerCharge).toLocaleString()}`}
              sub="12 mo × fixed monthly charge" />
        {hasDemand && (
          <Tile label="Demand Charges" value={`$${Math.round(bill.breakdown.demandCharge).toLocaleString()}/yr`}
                color={C.red} sub="based on monthly peak kW" />
        )}
        {hasDemand && annualPeakKw != null && (
          <Tile label="Annual Peak Demand" value={`${annualPeakKw.toFixed(1)} kW`}
                sub="max 15-min demand" />
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button onClick={() => {
          const safeName = (results.rateKey||'rate').replace(/[^a-zA-Z0-9]/g,'_').slice(0,30);
          downloadFile(buildSummaryCSV(results),
            'rate_engine_' + safeName + '_' + new Date().toISOString().slice(0,10) + '.csv',
            'text/csv');
        }} style={{ padding: '6px 16px', fontSize: 12, fontWeight: 600, borderRadius: 6,
                    background: '#161b22', border: '1px solid #39d353',
                    color: '#39d353', cursor: 'pointer' }}>↓ Export Summary CSV</button>
      </div>

      {/* Monthly bar chart */}
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8,
                    padding: 16, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between',
                         alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Monthly Bill</div>
          <button onClick={() => drawPng(results)}
            style={{ padding: '5px 14px', fontSize: 11, fontWeight: 600, borderRadius: 5,
                     background: 'transparent', border: '1px solid #30363d',
                     color: '#8b949e', cursor: 'pointer' }}>💾 Save PNG</button>
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={chartData} margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
            <XAxis dataKey="month" tick={{ fill: C.muted, fontSize: 11 }} />
            <YAxis tick={{ fill: C.muted, fontSize: 11 }} tickFormatter={v => '$' + v}
                   width={56} />
            <Tooltip
              contentStyle={{ background: C.card, border: `1px solid ${C.border}`,
                              color: C.text, fontSize: 12 }}
              formatter={(v, n) => [`$${v.toFixed(2)}`, n]}
            />
            <Legend wrapperStyle={{ fontSize: 12, color: C.muted }} />
            <Bar dataKey="Energy charge"    fill={C.blue}   stackId="a" radius={[0,0,0,0]} />
            {hasDemand && <Bar dataKey="Demand charge" fill={C.red}   stackId="a" radius={[0,0,0,0]} />}
            <Bar dataKey="Customer charge"  fill={C.faint}  stackId="a" radius={[2,2,0,0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Monthly table */}
      <MonthlyBillTable monthly={bill.monthly} hasDemand={hasDemand} />

      <div style={{ fontSize: 11, color: C.muted, marginTop: 12, lineHeight: 1.6 }}>
        Customer charges: standard $0.793/day · CARE $0.197/day · verified from CPUC tariff PDFs. ·
        Baseline allowance credit not modeled (CARE baseline adjustment credit ~$0.063/kWh also not modeled). ·
        NEM export credit not applied (no PV file loaded). ·
        Schedule DR tier boundary: ~350 kWh/month (approximate). ·
        AL-TOU-2 demand: winter values verified from SDG&E Viasat bill Mar 2025; summer on-peak and AL-TOU demand charges are approximate.
      </div>
    </div>
  );
}

// ─── SAVINGS RESULTS ──────────────────────────────────────────────────────────
function SavingsResults({ results }) {
  const { baseline, solar, annualSavings, annualGenKwh, selfConsumption } = results;
  const chartData = useMemo(() => makeSavingsChartData(baseline, solar), [baseline, solar]);

  return (
    <div>
      {/* KPI tiles */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        <Tile label="Baseline Bill"
              value={`$${Math.round(baseline.totalBill).toLocaleString()}/yr`}
              color={C.orange} />
        <Tile label="Solar Bill"
              value={`$${Math.round(solar.totalBill).toLocaleString()}/yr`}
              color={C.blue} />
        <Tile label="Annual Savings"
              value={`$${Math.round(annualSavings).toLocaleString()}/yr`}
              color={C.green} />
        <Tile label="Annual Generation"
              value={`${Math.round(annualGenKwh).toLocaleString()} kWh`} />
        <Tile label="Self-Consumption"
              value={`${(selfConsumption * 100).toFixed(1)}%`}
              sub="generation consumed on-site" />
        <Tile label="Export Credit"
              value={`$${Math.round(solar.breakdown.exportCredit).toLocaleString()}/yr`}
              sub={`${results.nemType === 'nem3' ? 'NBT rates' : results.nemType === 'nem2' ? 'retail net metering' : 'none'}`} />
        {baseline.breakdown.demandCharge > 0 && (
          <Tile label="Demand Savings"
                value={`$${Math.round(baseline.breakdown.demandCharge - solar.breakdown.demandCharge).toLocaleString()}/yr`}
                color={C.purple}
                sub="peak kW reduction from solar" />
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button onClick={() => {
          const safeName = (results.rateKey||'rate').replace(/[^a-zA-Z0-9]/g,'_').slice(0,30);
          downloadFile(buildSummaryCSV(results),
            'rate_engine_' + safeName + '_' + new Date().toISOString().slice(0,10) + '.csv',
            'text/csv');
        }} style={{ padding: '6px 16px', fontSize: 12, fontWeight: 600, borderRadius: 6,
                    background: '#161b22', border: '1px solid #39d353',
                    color: '#39d353', cursor: 'pointer' }}>↓ Export Summary CSV</button>
      </div>

      {/* Monthly comparison chart */}
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8,
                    padding: 16, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between',
                         alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Monthly Bill — Baseline vs Solar</div>
          <button onClick={() => drawPng(results)}
            style={{ padding: '5px 14px', fontSize: 11, fontWeight: 600, borderRadius: 5,
                     background: 'transparent', border: '1px solid #30363d',
                     color: '#8b949e', cursor: 'pointer' }}>💾 Save PNG</button>
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={chartData} margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
            <XAxis dataKey="month" tick={{ fill: C.muted, fontSize: 11 }} />
            <YAxis tick={{ fill: C.muted, fontSize: 11 }} tickFormatter={v => '$' + v}
                   width={60} />
            <Tooltip
              contentStyle={{ background: C.card, border: `1px solid ${C.border}`,
                              color: C.text, fontSize: 12 }}
              formatter={(v, n) => [`$${v.toFixed(2)}`, n]}
            />
            <Legend wrapperStyle={{ fontSize: 12, color: C.muted }} />
            <Bar dataKey="Baseline" fill={C.orange} radius={[2,2,0,0]} />
            <Bar dataKey="Solar"    fill={C.blue}   radius={[2,2,0,0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Monthly savings table */}
      <MonthlySavingsTable baseline={baseline} solar={solar} />

      <div style={{ fontSize: 11, color: C.muted, marginTop: 12, lineHeight: 1.6 }}>
        Customer charges: standard $0.793/day · CARE $0.197/day · verified CPUC tariff PDFs. ·
        Baseline allowance credit not modeled. · Demand charges not applicable (residential rates). ·
        NPV: use computeSavings() with installCost option. ·
        AL-TOU-2 demand: winter values verified from SDG&E Viasat bill Mar 2025; summer on-peak and AL-TOU demand charges are approximate.
      </div>
    </div>
  );
}

// ─── MONTHLY BILL TABLE ───────────────────────────────────────────────────────
function MonthlyBillTable({ monthly, hasDemand }) {
  const tdS = { padding: '6px 10px', borderBottom: `1px solid ${C.border}`,
                fontSize: 12, color: C.text, textAlign: 'right' };
  const thS = { ...tdS, color: C.muted, fontWeight: 600, fontSize: 11,
                textTransform: 'uppercase', letterSpacing: '0.04em' };

  const headers = hasDemand
    ? ['Month','Import kWh','Peak kWh','Off-Peak kWh','SOP kWh','Peak kW','Demand $','Energy $','Customer $','Total $']
    : ['Month','Import kWh','Peak kWh','Off-Peak kWh','SOP kWh','Energy $','Customer $','Total $'];

  const totals = monthly.reduce((acc, m) => ({
    importKwh: acc.importKwh + m.importKwh,
    peak: acc.peak + m.peakImportKwh,
    offpeak: acc.offpeak + m.offpeakImportKwh,
    sop: acc.sop + m.sopImportKwh,
    energyCharge: acc.energyCharge + m.energyCharge,
    customerCharge: acc.customerCharge + m.customerCharge,
    netBill: acc.netBill + m.netBill,
    demandCharge: acc.demandCharge + m.demandCharge,
  }), { importKwh:0, peak:0, offpeak:0, sop:0, energyCharge:0, customerCharge:0, netBill:0, demandCharge:0 });

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`,
                  borderRadius: 8, overflow: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: C.card }}>
            {headers.map(h => (
              <th key={h} style={{ ...thS, textAlign: h === 'Month' ? 'left' : 'right',
                                   paddingLeft: h === 'Month' ? 12 : undefined }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {monthly.map(m => (
            <tr key={m.month} style={{ background: m.month % 2 === 0 ? C.surface : 'transparent' }}>
              <td style={{ ...tdS, textAlign: 'left', paddingLeft: 12, color: C.text,
                           fontWeight: 500 }}>{m.label}</td>
              <td style={tdS}>{m.importKwh.toFixed(0)}</td>
              <td style={tdS}>{m.peakImportKwh.toFixed(0)}</td>
              <td style={tdS}>{m.offpeakImportKwh.toFixed(0)}</td>
              <td style={tdS}>{m.sopImportKwh.toFixed(0)}</td>
              {hasDemand && <td style={tdS}>{m.maxDemandKw.toFixed(1)}</td>}
              {hasDemand && <td style={tdS}>${m.demandCharge.toFixed(2)}</td>}
              <td style={tdS}>${m.energyCharge.toFixed(2)}</td>
              <td style={tdS}>${m.customerCharge.toFixed(2)}</td>
              <td style={{ ...tdS, fontWeight: 600 }}>${m.netBill.toFixed(2)}</td>
            </tr>
          ))}
          <tr style={{ background: C.card, fontWeight: 700 }}>
            <td style={{ ...tdS, textAlign: 'left', paddingLeft: 12 }}>Total</td>
            <td style={tdS}>{totals.importKwh.toFixed(0)}</td>
            <td style={tdS}>{totals.peak.toFixed(0)}</td>
            <td style={tdS}>{totals.offpeak.toFixed(0)}</td>
            <td style={tdS}>{totals.sop.toFixed(0)}</td>
            {hasDemand && <td style={tdS}>—</td>}
            {hasDemand && <td style={tdS}>${totals.demandCharge.toFixed(2)}</td>}
            <td style={tdS}>${totals.energyCharge.toFixed(2)}</td>
            <td style={tdS}>${totals.customerCharge.toFixed(2)}</td>
            <td style={{ ...tdS, color: C.orange }}>${totals.netBill.toFixed(2)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ─── MONTHLY SAVINGS TABLE ────────────────────────────────────────────────────
function MonthlySavingsTable({ baseline, solar }) {
  const tdS = { padding: '6px 10px', borderBottom: `1px solid ${C.border}`,
                fontSize: 12, color: C.text, textAlign: 'right' };
  const thS = { ...tdS, color: C.muted, fontWeight: 600, fontSize: 11,
                textTransform: 'uppercase', letterSpacing: '0.04em' };

  let totImport=0, totExport=0, totBaseline=0, totSolar=0, totSavings=0, totCredit=0;
  const rows = baseline.monthly.map((bm, i) => {
    const sm     = solar.monthly[i];
    const saving = bm.netBill - sm.netBill;
    totImport   += sm.importKwh;
    totExport   += sm.exportKwh;
    totBaseline += bm.netBill;
    totSolar    += sm.netBill;
    totSavings  += saving;
    totCredit   += sm.exportCredit;
    return { label: bm.label, month: bm.month, importKwh: sm.importKwh,
             exportKwh: sm.exportKwh, exportCredit: sm.exportCredit,
             baselineBill: bm.netBill, solarBill: sm.netBill, savings: saving };
  });

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`,
                  borderRadius: 8, overflow: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: C.card }}>
            {['Month','Import kWh','Export kWh','Export Credit','Baseline $',
              'Solar $','Savings $'].map(h => (
              <th key={h} style={{ ...thS, textAlign: h === 'Month' ? 'left' : 'right',
                                   paddingLeft: h === 'Month' ? 12 : undefined }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.month} style={{ background: r.month % 2 === 0 ? C.surface : 'transparent' }}>
              <td style={{ ...tdS, textAlign: 'left', paddingLeft: 12, fontWeight: 500 }}>{r.label}</td>
              <td style={tdS}>{r.importKwh.toFixed(0)}</td>
              <td style={tdS}>{r.exportKwh.toFixed(0)}</td>
              <td style={{ ...tdS, color: C.green }}>${r.exportCredit.toFixed(2)}</td>
              <td style={{ ...tdS, color: C.orange }}>${r.baselineBill.toFixed(2)}</td>
              <td style={{ ...tdS, color: C.blue }}>${r.solarBill.toFixed(2)}</td>
              <td style={{ ...tdS, color: C.green, fontWeight: 600 }}>${r.savings.toFixed(2)}</td>
            </tr>
          ))}
          <tr style={{ background: C.card, fontWeight: 700 }}>
            <td style={{ ...tdS, textAlign: 'left', paddingLeft: 12 }}>Total</td>
            <td style={tdS}>{totImport.toFixed(0)}</td>
            <td style={tdS}>{totExport.toFixed(0)}</td>
            <td style={{ ...tdS, color: C.green }}>${totCredit.toFixed(2)}</td>
            <td style={{ ...tdS, color: C.orange }}>${totBaseline.toFixed(2)}</td>
            <td style={{ ...tdS, color: C.blue }}>${totSolar.toFixed(2)}</td>
            <td style={{ ...tdS, color: C.green }}>${totSavings.toFixed(2)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ─── MOUNT ────────────────────────────────────────────────────────────────────
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
