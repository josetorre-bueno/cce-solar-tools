// contract_tool_app_v0.2.7.jsx
// Makello Contract Tool
// v0.2.7 — 2026-04-19
//
// Changes from v0.2.6:
//  - Header readiness indicator: always-visible label next to Generate that
//    shows "✓ All fields ready" (green) or "⚠ N fields need filling" (amber)
//    so the user knows at a glance whether the form is complete.
//  - Help panel: photo section now explains browser security model — browsers
//    only grant temporary access to a file when the user explicitly picks it;
//    there is no persistent path that a web page can re-read automatically.

const { useState, useEffect, useRef } = React;

// ─────────────────────────────────────────────────────────────────────────────
// Field manifest
// ─────────────────────────────────────────────────────────────────────────────

const TAX_STATUS_OPTIONS = ['', 'C corporation', 'S corporation', '501(c)(3)', 'Other'];

const FIELDS = [
  { key: 'effective_date',                    label: 'Contract execution date (e.g. April 17 2026)',                          type: 'job' },
  { key: 'contractor_name',                   label: 'Contractor company name',                                               type: 'stable', dflt: '' },
  { key: 'contractor_address',                label: 'Contractor street address city state zip',                              type: 'stable', dflt: '' },
  { key: 'contractor_license_no',             label: 'California Contractor License number',                                  type: 'stable', dflt: '' },
  { key: 'customer_org_name',                 label: 'Customer organization or business name',                                type: 'job' },
  { key: 'customer_address',                  label: 'Project site address city state zip',                                   type: 'job' },
  { key: 'customer_tax_status',               label: 'Customer tax status',                                                   type: 'job',    widget: 'select' },
  { key: 'customer_tax_status_other',         label: 'If "Other" — specify type',                                            type: 'job' },
  { key: 'initial_target_capacity',           label: 'System description (e.g. 24kW DC to 28kW DC solar tracker)',           type: 'job' },
  { key: 'material_escalation_threshold_pct', label: 'Material cost escalation threshold',                                   type: 'stable', dflt: '5%',  unit: 'pct' },
  { key: 'labor_escalation_threshold_pct',    label: 'Labor cost escalation threshold (ENR Skilled Labor Index)',             type: 'stable', dflt: '5%',  unit: 'pct' },
  { key: 'phase1_completion_days',            label: 'Days to complete Phase 1 after Effective Date',                        type: 'stable', dflt: '75' },
  { key: 'phase1_fee_pct',                    label: 'Phase 1 fee as % of Total Project Cost',                               type: 'stable', dflt: '8%',  unit: 'pct' },
  { key: 'estimated_total',                   label: 'Estimated Total Project Cost',                                          type: 'job',                 unit: 'usd' },
  { key: 'phase1_fee',                        label: 'Phase 1 fee — total dollar amount',                                     type: 'calc',   formula: 'estimated_total × phase1_fee_pct', unit: 'usd' },
  { key: 'phase1_fee_50pct_upfront',          label: '50% of Phase 1 fee due at signing',                                    type: 'calc',   formula: 'phase1_fee × 50%',                 unit: 'usd' },
  { key: 'phase1_fee_50pct_delivery',         label: '50% of Phase 1 fee due at delivery of Phase 1 deliverables',           type: 'calc',   formula: 'phase1_fee × 50%',                 unit: 'usd' },
  { key: 'phase2_start_days',                 label: 'Days to commence Phase 2 after Notice to Proceed',                     type: 'stable', dflt: '30' },
  { key: 'payment_ntp_pct',                   label: 'Payment due upon NTP and building permits',                             type: 'stable', dflt: '25%', unit: 'pct' },
  { key: 'payment_equipment_pct',             label: 'Payment due upon delivery of equipment to site',                       type: 'stable', dflt: '35%', unit: 'pct' },
  { key: 'payment_installation_pct',          label: 'Payment due upon completion of installation',                          type: 'stable', dflt: '25%', unit: 'pct' },
  { key: 'payment_closeout_pct',              label: 'Payment due upon PTO and closeout docs',                               type: 'stable', dflt: '15%', unit: 'pct' },
  { key: 'prevailing_wage',                   label: 'Prevailing wage',                                                       type: 'job',    widget: 'toggle', options: ['is', 'is not'] },
  { key: 'workmanship_warranty_years',        label: 'Workmanship warranty period in years',                                  type: 'stable', dflt: '1' },
  { key: 'design_warranty_years',             label: 'Phase 1 design and engineering warranty in years',                     type: 'stable', dflt: '1' },
  { key: 'contractor_signatory_name',         label: 'Full name of person signing on behalf of contractor',                   type: 'stable', dflt: '' },
  { key: 'contractor_signatory_title',        label: 'Title of contractor signatory (e.g. President)',                        type: 'stable', dflt: '' },
  { key: 'contract_date',                     label: 'Date contract is signed (same as or later than effective date)',         type: 'job' },
  { key: 'customer_name',                     label: 'Full name of customer individual signing the contract',                 type: 'job' },
  { key: 'customer_title',                    label: 'Title of customer signatory — leave blank if sole proprietor',          type: 'job' },
  { key: 'site_photo',                        label: 'Site photo — appears at top of contract',                              type: 'job',    widget: 'photo' },
];

const LEFT_KEYS  = FIELDS.filter(f => f.type === 'job' || f.type === 'calc').map(f => f.key);
const RIGHT_KEYS = FIELDS.filter(f => f.type === 'stable').map(f => f.key);
const JOB_KEYS   = FIELDS.filter(f => f.type === 'job').map(f => f.key);

const HARDCODED_DEFAULTS = Object.fromEntries(
  FIELDS.filter(f => f.type === 'stable').map(f => [f.key, f.dflt])
);

const LS_KEY = 'wipomo_contract_stable_v1';

// ─────────────────────────────────────────────────────────────────────────────
// Unit normalisation
// ─────────────────────────────────────────────────────────────────────────────

function normalizePct(val) {
  const s = String(val).trim();
  if (!s) return s;
  if (s.endsWith('%')) return s;
  const n = parseFloat(s.replace(/[$,\s]/g, ''));
  if (isNaN(n)) return val;
  return (n <= 1 ? +(n * 100).toFixed(4) : n) + '%';
}
function normalizeUsd(val) {
  const s = String(val).trim();
  if (!s) return s;
  if (s.startsWith('$')) return s;
  const n = parseFloat(s.replace(/[,%\s]/g, ''));
  if (isNaN(n)) return val;
  const numStr = s.includes(',') ? s : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return '$' + numStr;
}
function normalizeValue(val, unit) {
  if (!unit || !val) return val;
  if (unit === 'pct') return normalizePct(val);
  if (unit === 'usd') return normalizeUsd(val);
  return val;
}
function normalizeAllValues(vals) {
  const out = { ...vals };
  for (const f of FIELDS) {
    if (f.unit && out[f.key] !== undefined) out[f.key] = normalizeValue(out[f.key], f.unit);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Calc helpers
// ─────────────────────────────────────────────────────────────────────────────

function parsePct(str) {
  const n = parseFloat(String(str || '').replace(/[%$,\s]/g, ''));
  if (isNaN(n)) return 0;
  return n > 1 ? n / 100 : n;
}
function parseMoney(str) {
  return parseFloat(String(str || '').replace(/[$,\s]/g, '')) || 0;
}
function fmtUsd(n) {
  if (!n || isNaN(n)) return '';
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function calcFields(vals) {
  const total = parseMoney(vals.estimated_total);
  const pct   = parsePct(vals.phase1_fee_pct);
  const fee   = total * pct;
  return {
    phase1_fee:               fmtUsd(fee),
    phase1_fee_50pct_upfront:  fmtUsd(fee * 0.5),
    phase1_fee_50pct_delivery: fmtUsd(fee * 0.5),
  };
}
function todayISO() { return new Date().toISOString().slice(0, 10); }

// ─────────────────────────────────────────────────────────────────────────────
// Image helpers
// ─────────────────────────────────────────────────────────────────────────────

// Decode a data URL to a Uint8Array for embedding in the docx zip
function dataUrlToUint8Array(dataUrl) {
  const base64 = dataUrl.split(',')[1];
  const binary  = atob(base64);
  const bytes   = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// 1 inch = 914400 EMUs.  Target max width: 6 inches.
const MAX_WIDTH_EMU  = 6    * 914400;  // 5486400  — 6" max width (fits between 1" margins)
const MAX_HEIGHT_EMU = 2.25 * 914400;  // 2057400  — ¼ of 9" usable page height (11" - 1" top - 1" bottom)

function calcImageEmu(naturalWidth, naturalHeight) {
  const ar = naturalHeight / naturalWidth;
  let cx = MAX_WIDTH_EMU;
  let cy = Math.round(cx * ar);
  if (cy > MAX_HEIGHT_EMU) { cy = MAX_HEIGHT_EMU; cx = Math.round(cy / ar); }
  return { cx, cy };
}

// Build the Word drawing XML for an inline image.
// a: and pic: namespaces are declared inline because the template
// does not declare them on <w:document>.
function buildImageXml(rId, cx, cy) {
  return `
<w:p><w:pPr><w:jc w:val="center"/></w:pPr>
<w:r><w:drawing>
<wp:inline distT="0" distB="0" distL="0" distR="0">
  <wp:extent cx="${cx}" cy="${cy}"/>
  <wp:docPr id="200" name="SitePhoto"/>
  <wp:cNvGraphicFramePr>
    <a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/>
  </wp:cNvGraphicFramePr>
  <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
    <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
      <pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
        <pic:nvPicPr>
          <pic:cNvPr id="200" name="SitePhoto"/>
          <pic:cNvPicPr><a:picLocks noChangeAspect="1" noChangeArrowheads="1"/></pic:cNvPicPr>
        </pic:nvPicPr>
        <pic:blipFill>
          <a:blip r:embed="${rId}"/>
          <a:stretch><a:fillRect/></a:stretch>
        </pic:blipFill>
        <pic:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
        </pic:spPr>
      </pic:pic>
    </a:graphicData>
  </a:graphic>
</wp:inline>
</w:drawing></w:r></w:p>`;
}

/// Post-process a rendered docx blob: inject site photo at the top of page 1
async function addPhotoToDocx(docxBlob, photoData) {
  const { dataUrl, mimeType, width, height } = photoData;
  const ext   = mimeType === 'image/png' ? 'png' : 'jpg';
  const rId   = 'rIdSitePhoto99';
  const fname = `word/media/sitePhoto.${ext}`;

  const buf  = await docxBlob.arrayBuffer();
  const zip  = new PizZip(buf);
  const img  = dataUrlToUint8Array(dataUrl);

  // 1. Add image file
  zip.file(fname, img);

  // 2. Add relationship
  const relType = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';
  const relsXml = zip.file('word/_rels/document.xml.rels').asText();
  const newRel  = `<Relationship Id="${rId}" Type="${relType}" Target="media/sitePhoto.${ext}"/>`;
  zip.file('word/_rels/document.xml.rels', relsXml.replace('</Relationships>', newRel + '</Relationships>'));

  // 3. Register content type for the image — OOXML requires every part to have one.
  //    Without this entry Word flags the file as "unreadable content".
  const mimeMap  = { png: 'image/png', jpg: 'image/jpeg' };
  const imgMime  = mimeMap[ext] || 'image/jpeg';
  let ctXml      = zip.file('[Content_Types].xml').asText();
  // Only add if not already present (idempotent)
  if (!ctXml.includes(`Extension="${ext}"`)) {
    ctXml = ctXml.replace('</Types>', `<Default Extension="${ext}" ContentType="${imgMime}"/></Types>`);
    zip.file('[Content_Types].xml', ctXml);
  }

  // 4. Build image paragraph — centered, no page break, flows into contract below
  const { cx, cy } = calcImageEmu(width, height);
  const topXml = buildImageXml(rId, cx, cy) + '\n<w:p/>';  // one blank line after photo

  // 5. Inject at the very start of <w:body>, before all contract content
  const docXml = zip.file('word/document.xml').asText();
  zip.file('word/document.xml', docXml.replace('<w:body>', '<w:body>' + topXml));

  const out = zip.generate({ type: 'uint8array' });
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

// ─────────────────────────────────────────────────────────────────────────────
// CSV helpers
// ─────────────────────────────────────────────────────────────────────────────

function parseCsv(text) {
  const rows = Papa.parse(text.trim(), { skipEmptyLines: true }).data;
  const out  = {};
  for (const row of rows) {
    if (row.length < 2) continue;
    const c0 = String(row[0]).trim(), c1 = String(row[1]).trim();
    if (c0.toLowerCase() === 'description' || c0.toLowerCase() === 'field') continue;
    let key, value;
    if (row.length >= 3 && c1.includes('{{')) {
      key = c1.replace(/\{\{|\}\}/g, '').trim(); value = String(row[2]).trim();
    } else { key = c0; value = c1; }
    if (key) out[key] = value;
  }
  return out;
}
function loadStableFromStorage() {
  try { const s = localStorage.getItem(LS_KEY); if (s) return { ...HARDCODED_DEFAULTS, ...JSON.parse(s) }; }
  catch (_) {}
  return null;
}
function saveStableToStorage(vals) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(vals)); } catch (_) {}
}
function downloadBlankCsv() {
  const lines = ['description,placeholder,value',
    ...FIELDS.filter(f => f.type === 'job' && f.widget !== 'photo').map(f => {
      const d = f.label.includes(',') ? `"${f.label}"` : f.label;
      return `${d},{{${f.key}}},`;
    })];
  saveAs(new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' }), 'contract_input_blank.csv');
}

// ─────────────────────────────────────────────────────────────────────────────
// File-save helper — uses File System Access API when available so the user
// can choose the destination directory; falls back to FileSaver otherwise.
// ─────────────────────────────────────────────────────────────────────────────

async function saveWithPicker(content, filename, mimeType) {
  if (typeof window.showSaveFilePicker === 'function') {
    try {
      const ext    = filename.split('.').pop().toLowerCase();
      const accept = ext === 'csv'  ? { 'text/csv':           ['.csv']  }
                   : ext === 'json' ? { 'application/json':   ['.json'] }
                   :                  { 'application/octet-stream': [] };
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: filename, accept }],
      });
      const writable = await handle.createWritable();
      await writable.write(new Blob([content], { type: mimeType }));
      await writable.close();
      return true;
    } catch (err) {
      if (err.name === 'AbortError') return false;   // user hit Cancel
      // Any other error → fall through to FileSaver
    }
  }
  saveAs(new Blob([content], { type: mimeType }), filename);
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Colour tokens
// ─────────────────────────────────────────────────────────────────────────────

const C = {
  job:    { bg: '#ffffff', bdr: '#e2e8f0', lbl: '#4a5568' },
  stable: { bg: '#ebf8ff', bdr: '#bee3f8', lbl: '#2c5282' },
  calc:   { bg: '#fffff0', bdr: '#faf089', lbl: '#975a16' },
};

function UnitBadge({ unit }) {
  if (!unit) return null;
  const [label, bg, color] = unit === 'pct'
    ? ['%', '#e9d8fd', '#553c9a']
    : ['$', '#c6f6d5', '#276749'];
  return (
    <span style={{ display: 'inline-block', marginLeft: 5, padding: '0 5px', fontSize: 10,
                   borderRadius: 3, background: bg, color, fontWeight: 700, verticalAlign: 'middle' }}>
      {label}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Field widgets
// ─────────────────────────────────────────────────────────────────────────────

function FieldShell({ field, dimmed, children }) {
  const col = C[field.type] || C.job;
  return (
    <div style={{ background: col.bg, border: `1px solid ${col.bdr}`, borderRadius: 6,
                  padding: '6px 10px', opacity: dimmed ? 0.4 : 1, transition: 'opacity .2s' }}>
      <div style={{ fontSize: 11, color: col.lbl, marginBottom: 3, lineHeight: 1.3 }}>
        {field.label}
        <UnitBadge unit={field.unit} />
        {field.type === 'calc' && (
          <span style={{ marginLeft: 6, fontSize: 10, color: '#b7791f' }}>= {field.formula}</span>
        )}
      </div>
      {children}
    </div>
  );
}

const inputBase = { width: '100%', border: 'none', background: 'transparent',
                    padding: '2px 0', fontSize: 13, color: '#1a202c', outline: 'none' };

function SelectField({ field, value, locked, onChange }) {
  return (
    <FieldShell field={field}>
      <select value={value} disabled={locked} onChange={e => onChange && onChange(e.target.value)}
        style={{ ...inputBase, borderBottom: locked ? 'none' : `1px solid ${C[field.type]?.bdr || '#e2e8f0'}`,
                 cursor: locked ? 'default' : 'pointer', appearance: locked ? 'none' : 'auto' }}>
        {TAX_STATUS_OPTIONS.map(o => <option key={o} value={o}>{o || '— select —'}</option>)}
      </select>
    </FieldShell>
  );
}

function ToggleField({ field, value, locked, onChange }) {
  return (
    <FieldShell field={field}>
      <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
        {(field.options || ['is', 'is not']).map(opt => {
          const active = value === opt;
          return (
            <button key={opt} disabled={locked} onClick={() => !locked && onChange && onChange(opt)}
              style={{ padding: '3px 14px', fontSize: 12, borderRadius: 4, fontWeight: active ? 600 : 400,
                       border: `1px solid ${active ? '#2b6cb0' : '#cbd5e0'}`,
                       background: active ? '#2b6cb0' : '#f7fafc',
                       color: active ? 'white' : '#4a5568',
                       cursor: locked ? 'default' : 'pointer', transition: 'all .15s' }}>
              {opt}
            </button>
          );
        })}
      </div>
    </FieldShell>
  );
}

function PhotoUploadField({ field, photo, onPhotoChange, csvPhotoName }) {
  const inputRef = useRef(null);

  function handleFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const dataUrl = ev.target.result;
      const img = new window.Image();
      img.onload = () => {
        onPhotoChange({
          dataUrl,
          mimeType: file.type || 'image/jpeg',
          width:    img.naturalWidth,
          height:   img.naturalHeight,
          name:     file.name,
        });
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  }

  function onDrop(e) {
    e.preventDefault();
    handleFile(e.dataTransfer.files[0]);
  }

  return (
    <FieldShell field={field}>
      {photo ? (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 4 }}>
          <img src={photo.dataUrl} alt="site" style={{ height: 64, maxWidth: 96, objectFit: 'cover', borderRadius: 4, border: '1px solid #e2e8f0' }} />
          <div style={{ fontSize: 11, color: '#4a5568', flex: 1 }}>
            <div style={{ fontWeight: 500 }}>{photo.name}</div>
            <div style={{ color: '#718096' }}>{photo.width} × {photo.height} px</div>
          </div>
          <button onClick={() => onPhotoChange(null)}
            style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, border: '1px solid #e2e8f0',
                     background: '#f7fafc', cursor: 'pointer', color: '#c53030' }}>
            ✕ Remove
          </button>
        </div>
      ) : (
        <div
          onDragOver={e => e.preventDefault()}
          onDrop={onDrop}
          onClick={() => inputRef.current.click()}
          style={{ marginTop: 4, padding: '10px 14px', border: '2px dashed #e2e8f0', borderRadius: 5,
                   textAlign: 'center', cursor: 'pointer', fontSize: 12, color: '#718096',
                   background: '#fafafa', transition: 'all .15s' }}
        >
          📷 Drop photo or click to upload (jpg / png / webp)
          {csvPhotoName ? (
            <div style={{ fontSize: 11, color: '#744210', marginTop: 4, background: '#fefcbf',
                          border: '1px solid #f6e05e', borderRadius: 3, padding: '2px 6px' }}>
              Last used: <strong>{csvPhotoName}</strong> — re-upload to include in contract
            </div>
          ) : (
            <div style={{ fontSize: 10, color: '#a0aec0', marginTop: 3 }}>
              Filename saves to CSV as a reminder — photo must be re-uploaded each session
            </div>
          )}
        </div>
      )}
      <input type="file" accept="image/jpeg,image/png,image/webp" ref={inputRef}
             style={{ display: 'none' }} onChange={e => handleFile(e.target.files[0])} />
    </FieldShell>
  );
}

function FieldRow({ field, value, locked, onChange, dimmed, photo, onPhotoChange, csvPhotoName }) {
  if (field.widget === 'photo')  return <PhotoUploadField field={field} photo={photo} onPhotoChange={onPhotoChange} csvPhotoName={csvPhotoName} />;
  if (field.widget === 'select') return <SelectField field={field} value={value} locked={locked} onChange={onChange} />;
  if (field.widget === 'toggle') return <ToggleField  field={field} value={value} locked={locked} onChange={onChange} />;
  return (
    <FieldShell field={field} dimmed={dimmed}>
      <input type="text" value={value} readOnly={locked}
        onChange={e => onChange && onChange(e.target.value)}
        onBlur={() => { if (!locked && field.unit && onChange) { const n = normalizeValue(value, field.unit); if (n !== value) onChange(n); } }}
        style={{ ...inputBase, borderBottom: locked ? 'none' : `1px solid ${C[field.type]?.bdr || '#e2e8f0'}`,
                 cursor: locked ? 'default' : 'text' }} />
    </FieldShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility button
// ─────────────────────────────────────────────────────────────────────────────

function Btn({ onClick, children, title, bg = '#edf2f7', bdr = '#cbd5e0', color = '#2d3748' }) {
  return (
    <button onClick={onClick} title={title} style={{ padding: '5px 12px', fontSize: 12, borderRadius: 4,
      cursor: 'pointer', border: `1px solid ${bdr}`, background: bg, color, whiteSpace: 'nowrap' }}>
      {children}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Pre-flight validation
// ─────────────────────────────────────────────────────────────────────────────

// Fields that may legitimately be left blank
const OPTIONAL_KEYS = new Set([
  'site_photo',              // optional — no photo is fine
  'customer_title',          // blank for sole proprietors
  'customer_tax_status_other', // only required when tax status === 'Other'
]);

function getMissingFields(allValues, taxStatus) {
  const missing = [];
  for (const f of FIELDS) {
    if (f.type === 'calc')       continue;  // auto-calculated, never blank
    if (f.widget === 'photo')    continue;  // handled by OPTIONAL_KEYS
    if (OPTIONAL_KEYS.has(f.key)) continue;
    // customer_tax_status_other: only required when tax status is Other
    if (f.key === 'customer_tax_status_other' && taxStatus !== 'Other') continue;
    const val = allValues[f.key];
    if (!val || String(val).trim() === '') missing.push({ key: f.key, label: f.label });
  }
  return missing;
}

// ─────────────────────────────────────────────────────────────────────────────
// App
// ─────────────────────────────────────────────────────────────────────────────

function App() {
  const [stable,         setStable]         = useState(HARDCODED_DEFAULTS);
  const [job,            setJob]            = useState(() => Object.fromEntries(JOB_KEYS.map(k => [k, ''])));
  const [sitePhoto,      setSitePhoto]      = useState(null);   // { dataUrl, mimeType, width, height, name }
  const [originalJob,    setOriginalJob]    = useState(null);
  const [stableUnlocked, setStableUnlocked] = useState(false);
  const [csvFile,        setCsvFile]        = useState(null);
  const [dragOver,       setDragOver]       = useState(false);
  const [status,         setStatus]         = useState('');
  const [generating,     setGenerating]     = useState(false);
  const [defaultsLoaded, setDefaultsLoaded] = useState(false);
  const [diagErrors,     setDiagErrors]     = useState([]);   // unpacked docxtemplater errors
  const [showHelp,       setShowHelp]       = useState(false);

  const csvInputRef  = useRef(null);
  const importDefRef = useRef(null);

  // ── On mount: localStorage → contract_defaults.json → hardcoded ─────────
  useEffect(() => {
    const fromStorage = loadStableFromStorage();
    if (fromStorage) { setStable(fromStorage); setDefaultsLoaded(true); return; }
    fetch('./contract_defaults.json')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setStable(prev => ({ ...HARDCODED_DEFAULTS, ...data })); setDefaultsLoaded(true); })
      .catch(() => setDefaultsLoaded(true));
  }, []);

  useEffect(() => { if (defaultsLoaded) saveStableToStorage(stable); }, [stable, defaultsLoaded]);

  // ── Derived ──────────────────────────────────────────────────────────────
  const calc      = calcFields({ ...stable, ...job });
  const allValues = { ...stable, ...job, ...calc };

  // ── CSV load ─────────────────────────────────────────────────────────────
  function applyCsvData(text, fname) {
    const parsed = parseCsv(text);
    const newJob = { ...job };
    let matched = 0;
    for (const key of JOB_KEYS) {
      if (parsed[key] !== undefined && parsed[key] !== '') {
        const field = FIELDS.find(f => f.key === key);
        newJob[key] = normalizeValue(parsed[key], field?.unit);
        matched++;
      }
    }
    setJob(newJob); setOriginalJob({ ...newJob }); setCsvFile(fname);
    setStatus(matched > 0 ? `✓ ${fname} — ${matched} field${matched !== 1 ? 's' : ''} populated` : `⚠ ${fname} — no matching fields found`);
  }
  function onCsvFile(e) {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader(); r.onload = ev => applyCsvData(ev.target.result, f.name);
    r.readAsText(f); e.target.value = '';
  }
  function onDrop(e) {
    e.preventDefault(); setDragOver(false);
    const f = e.dataTransfer.files[0]; if (!f) return;
    const r = new FileReader(); r.onload = ev => applyCsvData(ev.target.result, f.name);
    r.readAsText(f);
  }

  // ── Export CSV ───────────────────────────────────────────────────────────
  async function exportCsv() {
    const today = todayISO();
    const esc   = v => `"${String(v).replace(/"/g, '""')}"`;
    const lines = ['description,placeholder,value,notes'];
    for (const f of FIELDS.filter(fi => fi.type === 'job')) {
      let cur, note;
      if (f.widget === 'photo') {
        cur  = sitePhoto ? sitePhoto.name : '';
        note = '';
      } else {
        cur  = job[f.key] ?? '';
        const orig = originalJob ? (originalJob[f.key] ?? '') : '';
        note = (originalJob !== null && cur !== orig) ? `changed ${today}` : '';
      }
      lines.push(`${esc(f.label)},{{${f.key}}},${esc(cur)},${esc(note)}`);
    }
    const slug    = (job.customer_name || 'contract').replace(/[^a-zA-Z0-9]+/g, '_');
    const fname   = `contract_input_${slug}.csv`;
    const content = '\uFEFF' + lines.join('\n');
    const saved   = await saveWithPicker(content, fname, 'text/csv;charset=utf-8');
    if (saved) setStatus('✓ CSV exported');
  }

  // ── Stable defaults ──────────────────────────────────────────────────────
  async function saveDefaultsToFile() {
    const content = JSON.stringify(stable, null, 2);
    const saved   = await saveWithPicker(content, 'contract_defaults.json', 'application/json');
    if (saved) setStatus('contract_defaults.json saved — commit & push to share across computers');
  }
  function onImportDefaults(e) {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = ev => {
      try { setStable(prev => ({ ...prev, ...JSON.parse(ev.target.result) })); setStatus('✓ Defaults imported'); }
      catch (_) { setStatus('✗ Could not parse defaults file'); }
    };
    r.readAsText(f); e.target.value = '';
  }

  // ── Generate contract ────────────────────────────────────────────────────
  async function generateContract() {
    setDiagErrors([]);

    // ── Pre-flight: check required fields before touching the template ──────
    const missing = getMissingFields(allValues, job.customer_tax_status);
    if (missing.length > 0) {
      setStatus(`✗ ${missing.length} required field${missing.length !== 1 ? 's' : ''} empty — fill them in and try again`);
      setDiagErrors(missing.map(f => ({ id: 'missing', tag: f.key, offset: '', message: f.label })));
      return;
    }

    setGenerating(true); setStatus('Loading template…');
    try {
      const resp = await fetch('./Wipomo_Contract_Template.docx');
      if (!resp.ok) throw new Error(`Template not found (HTTP ${resp.status})`);

      // Keep the raw bytes — we'll open TWO PizZips from this buffer:
      //   renderZip  → fed to docxtemplater just to produce rendered document.xml
      //   outputZip  → fresh copy of the original; only document.xml is replaced
      // This means every other file (fonts, styles, numbering …) is byte-for-byte
      // from the original template and never recompressed by PizZip.
      const templateBuf = await resp.arrayBuffer();

      // 1. Render placeholders
      const renderZip = new PizZip(templateBuf);
      const doc = new window.docxtemplater(renderZip, {
        delimiters: { start: '{{', end: '}}' },
      });
      const mergeData = normalizeAllValues({ ...allValues, site_photo: '' });
      doc.render(mergeData);

      // 2. Extract rendered document.xml, strip comment anchors
      let docXml = doc.getZip().file('word/document.xml').asText();
      docXml = docXml
        .replace(/<w:commentRangeStart\b[^/]*\/>/g, '')
        .replace(/<w:commentRangeEnd\b[^/]*\/>/g, '')
        .replace(/<w:commentReference\b[^/]*\/>/g, '');  // remove inline, regardless of run contents

      // 3. Patch into a fresh copy of the original ZIP
      const outputZip = new PizZip(templateBuf);
      outputZip.file('word/document.xml', docXml);

      // 4. Remove leftover template comment files + their references
      ['word/comments.xml', 'word/commentsExtended.xml', 'word/commentsIds.xml']
        .forEach(f => { try { outputZip.remove(f); } catch (_) {} });
      let rels = outputZip.file('word/_rels/document.xml.rels').asText();
      rels = rels.replace(/<Relationship\b[^>]*[Cc]omments[^>]*\/>/g, '');
      outputZip.file('word/_rels/document.xml.rels', rels);
      let ct = outputZip.file('[Content_Types].xml').asText();
      ct = ct.replace(/<Override\b[^>]*[Cc]omments[^>]*\/>/g, '');
      outputZip.file('[Content_Types].xml', ct);

      // 5. Generate — no compression override so PizZip preserves each file's
      //    original compression method (fonts stay as they were in the template)
      const out    = outputZip.generate({ type: 'uint8array' });
      let docxBlob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });

      if (sitePhoto) {
        setStatus('Adding site photo…');
        docxBlob = await addPhotoToDocx(docxBlob, sitePhoto);
      }

      const slug = (allValues.customer_name || 'Contract').replace(/[^a-zA-Z0-9]+/g, '_');
      const ds   = (allValues.contract_date || allValues.effective_date || '').replace(/[^a-zA-Z0-9]+/g, '-');
      saveAs(docxBlob, `Wipomo_Contract_${slug}${ds ? '_' + ds : ''}.docx`);
      setStatus(sitePhoto ? '✓ Contract with site photo generated' : '✓ Contract generated');

    } catch (err) {
      console.error('Generation error:', err);

      // Unpack docxtemplater Multi error
      const subErrors = err?.properties?.errors;
      if (Array.isArray(subErrors) && subErrors.length > 0) {
        setDiagErrors(subErrors.map(e => ({
          id:      e?.properties?.id      ?? '?',
          tag:     e?.properties?.xtag    ?? e?.properties?.tag ?? '',
          offset:  e?.properties?.offset  ?? '',
          message: e?.message             ?? String(e),
        })));
        setStatus(`✗ Template error — ${subErrors.length} problem${subErrors.length !== 1 ? 's' : ''} found (see below)`);
      } else {
        setDiagErrors([{ id: 'error', tag: '', offset: '', message: err.message }]);
        setStatus(`✗ ${err.message}`);
      }
    } finally { setGenerating(false); }
  }

  const setJobField    = (key, val) => setJob(prev    => ({ ...prev, [key]: val }));
  // When tax status changes away from Other, clear the specify-type field
  const onTaxStatusChange = (val) => setJob(prev => ({
    ...prev,
    customer_tax_status: val,
    customer_tax_status_other: val === 'Other' ? prev.customer_tax_status_other : '',
  }));
  const setStableField = (key, val) => setStable(prev => ({ ...prev, [key]: val }));
  const statusIsGood   = status.startsWith('✓');
  const missingCount   = getMissingFields(allValues, job.customer_tax_status).length;
  const readyToGenerate = missingCount === 0;
  const taxIsOther     = job.customer_tax_status === 'Other';

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: '#f0f4f8' }}>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div style={{ background: '#1a365d', color: 'white', padding: '10px 20px',
                    display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 700, fontSize: 17 }}>Makello Contract Tool</span>
        <span style={{ fontSize: 11, opacity: 0.45 }}>v0.2.7</span>
        <button onClick={() => setShowHelp(h => !h)} title="Help"
          style={{ padding: '2px 10px', fontSize: 12, borderRadius: 4, border: '1px solid rgba(255,255,255,0.3)',
                   background: showHelp ? 'rgba(255,255,255,0.2)' : 'transparent',
                   color: 'white', cursor: 'pointer' }}>
          {showHelp ? '✕ Help' : '? Help'}
        </button>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 12, alignItems: 'center' }}>
          {/* Always-visible readiness pill */}
          <span style={{ fontSize: 12, fontWeight: 600,
                         color: readyToGenerate ? '#9ae6b4' : '#fbd38d' }}>
            {readyToGenerate
              ? '✓ All fields ready'
              : `⚠ ${missingCount} field${missingCount !== 1 ? 's' : ''} need filling`}
          </span>
          {/* Action status — appears after operations */}
          {status && (
            <span style={{ fontSize: 12, color: statusIsGood ? '#9ae6b4' : '#feb2b2',
                           borderLeft: '1px solid rgba(255,255,255,0.2)', paddingLeft: 12 }}>
              {status}
            </span>
          )}
          <button onClick={generateContract} disabled={generating} style={{
            padding: '6px 22px', fontSize: 13, fontWeight: 600,
            background: generating ? '#4a5568' : '#2b6cb0',
            color: 'white', border: 'none', borderRadius: 5,
            cursor: generating ? 'not-allowed' : 'pointer' }}>
            {generating ? 'Generating…' : '⬇ Generate Contract'}
          </button>
        </div>
      </div>

      {/* ── Help panel ─────────────────────────────────────────────────── */}
      {showHelp && (
        <div style={{ background: '#ebf8ff', borderBottom: '2px solid #bee3f8', padding: '16px 24px' }}>
          <div style={{ maxWidth: 1100, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 24 }}>

            {/* Col 1 — Input CSV */}
            <div>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#2c5282', marginBottom: 6 }}>Input CSV</div>
              <p style={{ margin: '0 0 6px', fontSize: 12, color: '#2d3748', lineHeight: 1.5 }}>
                The input CSV is a 3-column file that carries the per-job field values into the tool:
              </p>
              <table style={{ fontSize: 11, borderCollapse: 'collapse', width: '100%', marginBottom: 8 }}>
                <thead><tr style={{ background: '#bee3f8' }}>
                  <th style={{ padding: '3px 6px', textAlign: 'left' }}>Col A</th>
                  <th style={{ padding: '3px 6px', textAlign: 'left' }}>Col B</th>
                  <th style={{ padding: '3px 6px', textAlign: 'left' }}>Col C</th>
                </tr></thead>
                <tbody><tr>
                  <td style={{ padding: '3px 6px', color: '#4a5568' }}>Field description</td>
                  <td style={{ padding: '3px 6px', fontFamily: 'monospace' }}>{'{{placeholder}}'}</td>
                  <td style={{ padding: '3px 6px', color: '#4a5568' }}>Value to fill in</td>
                </tr></tbody>
              </table>
              <p style={{ margin: '0 0 4px', fontSize: 12, color: '#2d3748', lineHeight: 1.5 }}>
                Click <strong>⬇ Blank CSV</strong> to download a starter file. Fill in Column C in Excel or Numbers, save as CSV, then drag-and-drop or click to load it.
              </p>
              <p style={{ margin: 0, fontSize: 12, color: '#2d3748', lineHeight: 1.5 }}>
                An exported CSV (↑ Export CSV) adds a fourth column noting any fields that were changed from the originally loaded values, along with the date of the change.
              </p>
              <p style={{ margin: '6px 0 0', fontSize: 12, color: '#744210', lineHeight: 1.5 }}>
                <strong>Site photo</strong> — browsers only grant access to a file at the moment you explicitly pick it; there is no persistent path a web page can re-read automatically. This is a deliberate browser security boundary: a website cannot read files off your computer without your permission each time. The filename is saved to the CSV as a reminder of which file to upload, but the photo itself must be picked again each session.
              </p>
            </div>

            {/* Col 2 — Contractor defaults */}
            <div>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#2c5282', marginBottom: 6 }}>Contractor Defaults File</div>
              <p style={{ margin: '0 0 6px', fontSize: 12, color: '#2d3748', lineHeight: 1.5 }}>
                Fields that stay the same for every contract — contractor name, address, license number, signatory, payment percentages, warranty years, and escalation thresholds — are stored in the browser and in a file called <code style={{ background: '#e2e8f0', padding: '1px 4px', borderRadius: 3 }}>contract_defaults.json</code>.
              </p>
              <p style={{ margin: '0 0 6px', fontSize: 12, color: '#2d3748', lineHeight: 1.5 }}>
                <strong>Save Defaults</strong> — saves the current values to <code style={{ background: '#e2e8f0', padding: '1px 4px', borderRadius: 3 }}>contract_defaults.json</code>. Commit and push this file to the GitHub repo so the same defaults load on any computer.
              </p>
              <p style={{ margin: '0 0 6px', fontSize: 12, color: '#2d3748', lineHeight: 1.5 }}>
                <strong>Import Defaults</strong> — loads a previously saved defaults file. Use this to restore settings on a new computer before the repo copy has been fetched.
              </p>
              <p style={{ margin: 0, fontSize: 12, color: '#2d3748', lineHeight: 1.5 }}>
                The tool automatically loads defaults from the repo copy on startup, then falls back to the browser's local storage if the file is not reachable.
              </p>
            </div>

            {/* Col 3 — Template & calculated fields */}
            <div>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#2c5282', marginBottom: 6 }}>Template &amp; Calculated Fields</div>
              <p style={{ margin: '0 0 6px', fontSize: 12, color: '#2d3748', lineHeight: 1.5 }}>
                The Word template is <code style={{ background: '#e2e8f0', padding: '1px 4px', borderRadius: 3 }}>Wipomo_Contract_Template.docx</code>. Placeholders use <code style={{ background: '#e2e8f0', padding: '1px 4px', borderRadius: 3 }}>{'{{double-brace}}'}</code> syntax. Do not rename or move this file.
              </p>
              <p style={{ margin: '0 0 6px', fontSize: 12, color: '#2d3748', lineHeight: 1.5 }}>
                Three fields are calculated automatically and cannot be edited directly:
              </p>
              <ul style={{ margin: '0 0 6px', paddingLeft: 18, fontSize: 12, color: '#2d3748', lineHeight: 1.6 }}>
                <li><strong>Phase 1 fee</strong> = Estimated Total × Phase 1 fee %</li>
                <li><strong>50% upfront</strong> = Phase 1 fee × 50%</li>
                <li><strong>50% on delivery</strong> = Phase 1 fee × 50%</li>
              </ul>
              <p style={{ margin: 0, fontSize: 12, color: '#2d3748', lineHeight: 1.5 }}>
                Dollar amounts are formatted automatically when you leave a field — enter a bare number and <strong>$</strong> is added. Percentage fields add <strong>%</strong> the same way. Values above 1 are treated as already in percent (e.g. <em>8</em> → <em>8%</em>); values ≤ 1 are scaled (e.g. <em>0.08</em> → <em>8%</em>).
              </p>
            </div>

          </div>
        </div>
      )}

      {/* ── Diagnostic error panel ─────────────────────────────────────── */}
      {diagErrors.length > 0 && (() => {
        const isMissing = diagErrors[0]?.id === 'missing';
        return (
          <div style={{ background: isMissing ? '#fffbeb' : '#fff5f5',
                        borderBottom: `2px solid ${isMissing ? '#f6e05e' : '#fc8181'}`,
                        padding: '10px 20px' }}>
            <div style={{ fontWeight: 700, fontSize: 13,
                          color: isMissing ? '#744210' : '#c53030', marginBottom: 6 }}>
              {isMissing
                ? `⚠ ${diagErrors.length} required field${diagErrors.length !== 1 ? 's' : ''} empty — fill in before generating:`
                : `⚠ Template errors (${diagErrors.length}) — fix these placeholders then regenerate:`}
            </div>
            <table style={{ fontSize: 12, borderCollapse: 'collapse', width: '100%', maxWidth: 900 }}>
              {!isMissing && (
                <thead>
                  <tr style={{ color: '#742a2a', borderBottom: '1px solid #feb2b2' }}>
                    <th style={{ textAlign: 'left', padding: '2px 10px 4px 0', width: 120 }}>Error ID</th>
                    <th style={{ textAlign: 'left', padding: '2px 10px 4px 0', width: 160 }}>Tag / Placeholder</th>
                    <th style={{ textAlign: 'left', padding: '2px 10px 4px 0', width: 80  }}>Offset</th>
                    <th style={{ textAlign: 'left', padding: '2px 0 4px 0'               }}>Message</th>
                  </tr>
                </thead>
              )}
              <tbody>
                {diagErrors.map((e, i) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${isMissing ? '#fef08a' : '#fed7d7'}` }}>
                    {isMissing ? (
                      <td style={{ padding: '3px 0', color: '#92400e' }}>• {e.message}</td>
                    ) : (<>
                      <td style={{ padding: '3px 10px 3px 0', color: '#c53030', fontFamily: 'monospace' }}>{e.id}</td>
                      <td style={{ padding: '3px 10px 3px 0', color: '#744210', fontFamily: 'monospace' }}>
                        {e.tag ? `{{${e.tag}}}` : '—'}
                      </td>
                      <td style={{ padding: '3px 10px 3px 0', color: '#718096' }}>{e.offset !== '' ? e.offset : '—'}</td>
                      <td style={{ padding: '3px 0',           color: '#1a202c' }}>{e.message}</td>
                    </>)}
                  </tr>
                ))}
              </tbody>
            </table>
            {!isMissing && (
              <div style={{ fontSize: 11, color: '#718096', marginTop: 6 }}>
                Full error object logged to browser console (F12 → Console).
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Body ───────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 14, padding: 14, maxWidth: 1400, margin: '0 auto', alignItems: 'flex-start' }}>

        {/* LEFT — per-job */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ background: '#e6fffa', border: '1px solid #b2f5ea', borderRadius: 7,
                        padding: '10px 14px', marginBottom: 10 }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>Per-Job Fields</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <div onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                   onDragLeave={() => setDragOver(false)} onDrop={onDrop}
                   onClick={() => csvInputRef.current.click()}
                   style={{ border: `2px dashed ${dragOver ? '#319795' : '#81e6d9'}`, borderRadius: 5,
                            padding: '5px 14px', background: dragOver ? '#b2f5ea' : '#f0fff4',
                            cursor: 'pointer', fontSize: 12, color: '#234e52', transition: 'all .15s' }}>
                {csvFile ? <span>📎 {csvFile} — <u>change</u></span> : <span>📄 Drop CSV or <u>click to browse</u></span>}
              </div>
              <input type="file" accept=".csv" ref={csvInputRef} style={{ display: 'none' }} onChange={onCsvFile} />
              <Btn onClick={downloadBlankCsv}>⬇ Blank CSV</Btn>
              <Btn onClick={exportCsv} bg="#2c7a7b" bdr="#285e61" color="white">↑ Export CSV</Btn>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {LEFT_KEYS.map(key => {
              const field  = FIELDS.find(f => f.key === key);
              const value  = field.type === 'calc' ? (calc[key] ?? '') : (job[key] ?? '');
              const dimmed = key === 'customer_tax_status_other' && !taxIsOther;
              return (
                <FieldRow key={key} field={field} value={value}
                          locked={field.type === 'calc'} dimmed={dimmed}
                          onChange={key === 'customer_tax_status'
                            ? onTaxStatusChange
                            : val => setJobField(key, val)}
                          photo={key === 'site_photo' ? sitePhoto : undefined}
                          onPhotoChange={key === 'site_photo' ? setSitePhoto : undefined}
                          csvPhotoName={key === 'site_photo' ? (job.site_photo || '') : undefined} />
              );
            })}
          </div>
        </div>

        {/* RIGHT — stable */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ background: stableUnlocked ? '#fffbeb' : '#ebf8ff',
                        border: `1px solid ${stableUnlocked ? '#f6e05e' : '#bee3f8'}`,
                        borderRadius: 7, padding: '10px 14px', marginBottom: 10,
                        transition: 'background .2s, border-color .2s' }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>Contractor Defaults</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {stableUnlocked ? (
                <button onClick={() => setStableUnlocked(false)} style={{ padding: '5px 14px', fontSize: 12,
                  fontWeight: 600, borderRadius: 4, background: '#d69e2e', border: '1px solid #b7791f',
                  color: 'white', cursor: 'pointer' }}>🔒 Lock Defaults</button>
              ) : (
                <button onClick={() => setStableUnlocked(true)} style={{ padding: '5px 14px', fontSize: 12,
                  fontWeight: 600, borderRadius: 4, background: '#2c5282', border: '1px solid #2a4a7f',
                  color: 'white', cursor: 'pointer' }}>✏️ Edit Defaults</button>
              )}
              <Btn onClick={saveDefaultsToFile} bg="#2c5282" bdr="#2a4a7f" color="white"
                   title="Download contract_defaults.json — commit & push to share across computers">
                Save Defaults ↓
              </Btn>
              <Btn onClick={() => importDefRef.current.click()}>Import Defaults</Btn>
              <input type="file" accept=".json" ref={importDefRef} style={{ display: 'none' }} onChange={onImportDefaults} />
              {stableUnlocked && <span style={{ fontSize: 11, color: '#975a16', fontStyle: 'italic' }}>Editing — changes save automatically</span>}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {RIGHT_KEYS.map(key => {
              const field = FIELDS.find(f => f.key === key);
              return (
                <FieldRow key={key} field={field} value={stable[key] ?? ''}
                          locked={!stableUnlocked} onChange={val => setStableField(key, val)} />
              );
            })}
          </div>
        </div>

      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Mount
// ─────────────────────────────────────────────────────────────────────────────

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
