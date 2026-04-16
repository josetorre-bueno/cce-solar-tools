# Wipomo / CCE Solar Tools — Claude Code Project

**Owner:** Jose Torre-Bueno (jose.torrebueno@cc-energy.org), Center for Community Energy
**Architecture spec:** `TOOL_ARCHITECTURE_6_4.md` (v6.4, 2026-04-03) — read this first for full detail
**Deployed at:** tools.cc-energy.org (GitHub Pages)

---

## Project Purpose

Modular suite of solar + battery + EV analysis tools for residential and commercial customers in SDG&E/SCE/PG&E territory. Built by CCE for use by the Wipomo sales team. Also supports CPUC intervenor research using real project data.

Three use cases:

- **UC-1:** Commercial solar+storage bid (rooftop, carport, dual-axis tracker, DA customers, fuel cells)
- **UC-2:** Residential solar+storage bid (NEM 3.0, Green Button data or synthetic load)
- **UC-3:** Off-grid island sizing (worst-window weather survival, bidirectional EV dispatch)

---

## Module Registry

| ID | Name | Status | Files |
|----|------|--------|-------|
| MOD-01 | `pvwatts` | Embedded in MOD-09 — needs extraction | — |
| MOD-02a | `green_button.parser` | Embedded in MOD-02b | — |
| MOD-02b | `green_button.emulator` | **Deployed v2.0.0** | `green_button_app_v1_9_3.jsx` + `green_button_emulator.html` |
| MOD-03 | `nsrdb` | **Complete** (data + aggregation script) | `nsrdb_aggregate_v2_1.py`, `nsrdb_daily_summary.json`, `nsrdb_stress_window.json` |
| MOD-04 | `rate_engine` | **Stage 2 v1.4.0** — residential + commercial SDG&E rates, browser UI | `rate_engine_v1.3.0.js` + `rate_engine_app_v1.4.0.jsx` + `rate_engine.html` |
| MOD-05 | `bill_modeler` | Partial (removed from MOD-02b v1.9.0, pending standalone) | — |
| MOD-06 | `island_dispatch` | **Deployed v0.4.75** (browser UI + Python prototype) | `island_dispatch_app_v0.1.0.jsx` + `island_dispatch.html` + `mod06_island_dispatch_v11.py` |
| MOD-06b | `grid_battery_dispatch` | Planned | — |
| MOD-07 | `ev_simulator` | Not built (commercial fleet) | — |
| MOD-08 | `financial_model` | Partial (payback/NPV in MOD-10) | — |
| MOD-09 | `tracker_analyzer` | **Deployed v6.17** | `tracker_tou_app_v6.17.jsx` + `tracker_tou.html` |
| MOD-10 | `nem3_optimizer` | Partial v3 | `pv_sizing_tool.html` |

**Reference specs exist for:** MOD-02b (`MOD-02b_reference_spec.md`), MOD-06 (`MOD-06_island_dispatch_reference_spec_v0.4.68.md` — spec at v0.4.68, tool now at v0.4.75), MOD-09 (`MOD-09_tracker_analyzer_reference_spec.md`)
**Reference specs pending:** MOD-03, MOD-04

---

## Architecture Principles

### UI / computation separation
All computation is UI-agnostic. Module functions take inputs and return outputs — no DOM, no fetch, no rendering. The UI layer collects inputs and renders results; it adds no calculations.

**Why this matters:** At some future point these tools will be linked together into a larger automated system and deployed as a Wipomo/Makello web application with a new UI developed by their team. CCE's role at that point is to provide the computation modules as a documented API — Wipomo's developers call them directly and build their own interface around them. The API spec in each module's reference spec is the integration contract for that handoff.

### Deployment sequence (four stages)

**Stage 1 — Algorithm testing (current for new modules)**
Call the JSX computation functions directly from the terminal or a test harness. No UI, no server. Validates that the math is correct before any UI work begins.

**Stage 2 — Local UI testing**
Run `python3 -m http.server 8080` from `~/Downloads/Project Files`. Open `http://localhost:8080/{tool}.html` in a browser. CORS restrictions require the server — `file://` loading does not work with external Babel/React scripts. This is the primary development environment.

**Stage 3 — Team exposure via tools.cc-energy.org**
Files uploaded to GitHub via web drag-and-drop and served via GitHub Pages at `tools.cc-energy.org`. This site is **not published or advertised** — it is not linked from cc-energy.org or any public page. Only someone who knows the URL can reach it. It is used to share working tools with CCE colleagues and the Wipomo/Makello team for review and feedback. Not a secret, but not public.

**Stage 4 — Production integration (future)**
Wipomo/Makello embeds the computation modules in their own web application using a new UI of their choosing. CCE provides the modules as a documented API. The reference spec for each module (in the module's `_reference_spec.md` file) is the integration contract — it must be complete enough for Wipomo's developers to implement their own UI without reading the source code.

**Current state:** MOD-02b, MOD-09, and MOD-06 are at Stage 3. MOD-02b and MOD-09 co-locate computation and UI in a single JSX file (pragmatic Stage 1/2 choice). When Stage 4 integration begins, computation functions will be extracted into a separate importable module. New modules should be written with this separation already in place.

### Module data separation
MOD-02b produces **load shape only** (35,040 × 15-min intervals). Rate application and billing belong exclusively to MOD-04/MOD-05. Never add rate logic to the load emulator.

### Sizing philosophy (UC-3)
Off-grid systems are sized to **achieve 100% load coverage during the worst consecutive 10-day weather window**. Annual reliability % is not computed and not a criterion — a system that survives the worst 10-day window is assumed adequate for the rest of the year.

All MOD-06 dispatch simulation runs on the **1,680-hour stress window only** (60-day spinup + 10-day worst window) — no full-year simulation. The NSRDB stress window is pre-computed per cell and selected by haversine nearest-cell lookup for any customer lat/lon.

### EV topology (must be established first for UC-3)
- **Topology A (WFH):** EV home during solar hours → acts as primary storage, ~37 DCFC trips/yr
- **Topology B (commuter, no workplace charging):** EV absent during solar → chronic curtailment, ~$5,000/yr DCFC — impractical
- **Topology C (commuter, free workplace L2):** employer grid is a system component, ~11 DCFC trips/yr

---

## Deployment Conventions

### Two-file pattern
Each browser tool = thin HTML wrapper + versioned JSX module. Both files must be co-located.

- Wrapper filename: stable (e.g. `tracker_tou.html`)
- JSX filename: carries version (e.g. `tracker_tou_app_v6.16.jsx`)
- The wrapper's `<script src>` tag must reference the current JSX version

### Version numbering rule
**Every edit to any file, no matter how small (including comments, whitespace, and single-character fixes), must:**
1. Increment the minor version (e.g. v0.4.70 → v0.4.71)
2. Update the `// Updated:` timestamp to the current date and time in `YYYY-MM-DD HH:MM PT` format

This is non-negotiable. A file that was edited but whose version or timestamp did not change cannot be distinguished from the copy already on GitHub. Tracking which version is deployed becomes impossible.

Always use full **major.minor.patch** format — never abbreviate (e.g. always `v1.4.0`, never `v1.4`).

The version number must appear **identically** in all of the following locations — if any one is missing, stale, or uses an abbreviated format, the file is not correctly versioned:

**For the JSX/JS computation module:**
1. **Filename** — e.g. `rate_engine_app_v1.4.0.jsx`
2. **File header comment line 2** — `// Version: v1.4.0`
3. **File header comment line 3** — `// Updated: YYYY-MM-DD HH:MM PT`
4. **On-screen UI display string** — hardcoded version literal visible in the top bar (e.g. `<span style={S.version}>v0.4.71</span>`). This is a **separate literal** from the header comment — both must be updated. Missing this is the most common versioning mistake.
5. **Every output file** — all CSVs, XMLs, and any other generated file must carry the version in a header comment or metadata field

**For the HTML wrapper:**
6. **`<!-- Version: vX.Y.Z -->` comment** — line 3 of the wrapper (must match JSX version exactly)
7. **`<!-- Updated: YYYY-MM-DD HH:MM PT -->` comment** — line 4 of the wrapper
8. **`<title>` tag** — e.g. `Rate Engine v1.4.0 — CCE / Makello`
9. **`<script src>` tag** — filename and `?v=` cache-bust parameter must both match, e.g. `src="rate_engine_app_v1.4.0.jsx?v=1.4.0"`

When bumping a version:
- Rename the JSX file (e.g. `rate_engine_app_v1.4.0.jsx` → `rate_engine_app_v1.5.0.jsx`)
- Update the HTML wrapper `<script src>` filename and `?v=` parameter
- Update the HTML wrapper `<!-- Version: -->` comment and `<!-- Updated: -->` comment
- Update the HTML `<title>` tag
- Update the **on-screen UI version string** inside the JSX (the hardcoded literal, not just the header comment)
- Update the JSX file header comment lines 2 and 3 (Version + Updated)
- Search both files for all occurrences of the old version string and update every one

### Required file header (every source file)
Every file must include a timestamp on the line after the version. This makes it unambiguous which version is deployed on GitHub vs. what is local — the timestamp is the ground truth.

JSX/JS modules (`.jsx` for React UI, `.js` for Stage 1 pure-computation):
```
// MOD-{XX} {canonical_name} — module
// Version: v{X.Y.Z}
// Updated: YYYY-MM-DD HH:MM PT
// Part of: Wipomo / CCE Solar Tools
```
HTML wrappers:
```html
<!-- MOD-{XX} {canonical_name} — wrapper -->
<!-- Version: v{X.Y.Z} -->
<!-- Updated: YYYY-MM-DD HH:MM PT -->
<!-- Module file: {jsx_filename} -->
<!-- Part of: Wipomo / CCE Solar Tools -->
```

Use Pacific Time (PT). Format exactly as shown — `YYYY-MM-DD HH:MM PT`.

**File extension convention:** Stage 1 pure-computation modules with no React dependency use `.js`. Modules with React UI use `.jsx`. Both are loaded identically via `<script>` tags.

### Permissions
Tool permissions are configured in two files — do not remove or overwrite entries without checking first:

- **`~/.claude/settings.json`** — global, applies to all projects. Contains `Bash(*)` wildcard so bash commands never require per-command approval.
- **`.claude/settings.local.json`** (this directory) — project-level additions on top of the global file: `Bash(*)` plus specific `WebFetch` domains needed by the tools (NREL, SDG&E, Nominatim, tools.cc-energy.org).

When Claude Code prompts for permission on a bash command, it usually means the global settings.json was not picked up. Check that it exists at `~/.claude/settings.json`.

### Local testing
CORS restrictions prevent `file://` loading (Babel external script load). Use:
```
python3 -m http.server 8080
```
Then open `http://localhost:8080/tracker_tou.html`

### Cache-busting
Append `?v=x.x.x` query string to ALL `<script src>` tags in HTML wrappers when deploying a new version, to force browser cache refresh. This applies to both versioned JSX modules and shared utility scripts like `auth.js`. Always use full `vX.Y.Z` semantic version format — never use bare integers like `?v=2`.

### GitHub upload method
Files are uploaded to GitHub via the **web interface drag-and-drop** — there is no local git clone.

### End-of-session file summary (required)
The **last lines of every response that writes or modifies files** must list all files changed and their version numbers, formatted for easy copy-paste when uploading to GitHub. Example:

```
📦 Files ready to publish:
  rate_engine_v1.2.0.js          v1.2.0
  rate_engine_app_v1.3.1.jsx     v1.3.1
  rate_engine.html               v1.3.1
```

This is required SOP — never omit it when files have been written or modified.

### Source of truth
**`~/Downloads/Project Files` on the local machine is the ultimate source of truth.** GitHub uploads are for demonstrating progress to management — not for deployment. Claude project knowledge is updated by uploading from local. Neither GitHub nor Claude project knowledge syncs back to the local machine.

---

## Naming Conventions

- Module IDs: `MOD-XX` (two digits, consistent everywhere)
- Field names: `snake_case` throughout
- Hourly arrays: always 8760 elements; hour 0 = Jan 1 00:00–01:00 local time
- 15-min interval arrays: always 35,040 elements; interval 0 = Jan 1 00:00–00:15 local time
- Energy: **kWh** (PVWatts raw output is Wh; ESPI interval values are Wh)
- Power: **kW**
- Rates: $/kWh (energy), $/kW (demand)
- Currency: USD, nominal dollars
- Coordinates: decimal degrees, longitude negative for west

---

## Tech Stack

- **Frontend:** React + Babel (runs in browser, no build step), Recharts, Chart.js
- **Python:** standard library only (no numpy/pandas) for MOD-03 and MOD-06
- **Python PDF parsing:** `pdfplumber` v0.11.9 is installed under Python 3.14 at `/usr/local/bin/python3`. The system default `python3` (`/usr/bin/python3`, v3.9) does **not** have it. Always use `/usr/local/bin/python3` for any PDF reading task.
- **APIs:** NREL PVWatts v8, NREL NSRDB GOES Aggregated v4.0.0, Nominatim geocoding
- **Data formats:** NAESB ESPI XML, SDG&E Green Button CSV, PVWatts v8 CSV, JSON
- **CSV encoding:** Always write CSV files with a UTF-8 BOM (`encoding='utf-8-sig'` in Python, `\uFEFF` prefix in JS). Without the BOM, Excel misreads UTF-8 as MacRoman/Windows-1252 and garbles em dashes, smart quotes, and other non-ASCII characters.

---

## Key Project Sites

| Site | Address | Notes |
|------|---------|-------|
| **Sanchez Residence** (UC-3 off-grid) | 29756 Wilkes Road, Valley Center CA 92082 | CZ10, new construction, all-electric, 1,626 sqft, 4BR/2BA. Sizing sweep complete: `sizing_sweep_v11.csv`, `sizing_summary_v11.json` |
| **Viasat campus** (UC-1 commercial) | Carlsbad, El Camino Real, buildings W1–W5, E1–E4, N1–N2 | SDG&E AL-TOU-2 + CE CCA. Demand charges ~86% of bill |
| **Narragansett Ave** (UC-2 multifamily) | 5021–5025 Narragansett Ave, San Diego CA 92107 | 6 units, fuel config TBD. Pending MOD-02b load profile |

---

## People

- **Jose Torre-Bueno** (jose.torrebueno@cc-energy.org) — CCE Director, project owner
- **Susan Wayo** — CCE colleague
- **Charlie Johnson** — owns Wipomo (sales) and Green Energy EPC by Makello (installation). **Wipomo and Makello are the same business entity operating under different DBAs.** Wipomo is the sales/advisory brand; Makello is the installation/EPC brand. Either name may appear in contracts, proposals, and future API integration work — treat them as interchangeable when the context is Charlie's business.

---

## Current Priorities (as of v6.4, updated 2026-04-03)

1. **MOD-04 rate_engine — Stage 2 complete (v1.4.0)** — SDG&E residential (TOU-DR1, EV-TOU-5, DR-SES, DR + CARE variants) and commercial (TOU-A, AL-TOU, AL-TOU-2) rates with browser UI. Next: verify approximate commercial demand charges (⚠-flagged), add SCE/PG&E/APU rates, write MOD-04 reference spec.
2. **MOD-05 standalone bill modeler** — single tool with `customer_type` flag (bundled / direct_access / fuel_cell_da); depends on MOD-04
3. **MOD-01 extraction** — PVWatts wrapper still embedded in MOD-09; extract as `pvwatts_v1.0.0.js` following MOD-04 pattern
4. **MOD-03 reference spec** — document as-implemented API for NSRDB aggregation and stress window selection
5. **MOD-06b grid_battery_dispatch** — planned; complement to MOD-06 for grid-tied battery dispatch

*MOD-04 rate_engine (v1.4.0) — Stage 2 complete. API: `computeNetIntervals()`, `computeBill()`, `computeSavings()`, `listRates()`, `selfTest()`. SDG&E residential rates (TOU-DR1, EV-TOU-5, DR-SES, DR) + CARE variants + commercial rates (TOU-A, AL-TOU, AL-TOU-2). Some commercial demand charges approximate (⚠-flagged in source). Reference spec pending.*
*MOD-06 browser UI (v0.4.72) — COMPLETE. Features: haversine nearest-cell lookup, 1,680-hour stress window dispatch, EV impact analysis, report generation, Title 24 compliance checks, optional generator dispatch. v0.4.72 fixes prio-0/1 battery→EV charging to use conservative trip-sized targets (not 90%) and adds road trip destination L2 charging, preventing battery depletion in multi-EV worst-window scenarios.*
*MOD-06 browser UI (v0.4.75) — Fixes emergency DCFC over-counting caused by prio-2 battery→EV charging at night after road trip days. Prio-2 (general top-up) is now restricted to solar-surplus hours only; nighttime battery→EV is prio-0/1 only. Also adds diagnostic breakdown in no-solution error message (worst-window pass count, en-route/emergency DCFC best values vs limits).*

---

## File Operations (Claude Code tips)

- For multi-line replacements in JSX/Python, use Python file manipulation rather than sed for reliability
- Always verify key content after edits before considering a task done
- For HTML wrapper version bumps: rewrite the full wrapper file rather than sed substitution
- Write outputs to the working directory; present final deliverables clearly

---

## Subdirectories

| Directory | Contents |
|-----------|----------|
| `Anaheim rates/` | APU tariff PDFs — read on demand when working on APU rate implementation |

More subdirectories will be added as the project grows (e.g. rate documents by utility, test data, reference CSVs). **These are never loaded automatically** — only read when a task requires them.

---

## Key Data Files

| File | Size | Notes |
|------|------|-------|
| `nsrdb_daily_summary.json` | 3.2 MB | 683 cells, 26 years each; load at startup |
| `nsrdb_stress_window.json` | 16.5 MB | 70-day stress arrays; local machine only (too large for Claude project knowledge) |
| `sizing_sweep_v11.csv` | 283 KB | All PV × battery × EV scenario combinations for Valley Center site |
| `sizing_summary_v11.json` | 3.7 KB | Min-cost configs at 90/95/99% annual reliability |

NSRDB raw hourly CSVs (~270 MB) are local machine only — too large for GitHub or Claude project knowledge and not needed at runtime.

`nsrdb_stress_window.json` (16.5 MB) **is deployed to GitHub** alongside `island_dispatch.html` — MOD-06 fetches it at runtime and cannot function without it. It is too large for Claude project knowledge but is within GitHub's 25 MB web-upload limit. Do not treat it as local-only.

`pvwatts_config.json` **must be deployed to GitHub** — MOD-06 and MOD-09 fetch it at startup to load the NREL API key. Without it, tools fall back to localStorage and show "key not set." ⚠️ This file contains the API key in plain text. JavaScript-based auth (auth.js) does not protect static files from direct URL access — the key is technically readable at `tools.cc-energy.org/pvwatts_config.json` without a password. Risk is low (NREL keys are free, rate-limited, easy to rotate) but the limitation is known.

---

## External APIs

- **NREL PVWatts v8:** `https://developer.nrel.gov/api/pvwatts/v8.json` — API key on file at CCE (admin@cc-energy.org)
- **NREL NSRDB:** `https://developer.nrel.gov/api/nsrdb/v2/solar/nsrdb-GOES-aggregated-v4-0-0-download.csv`
- **Nominatim geocoding:** free, no key required (used in MOD-09)
