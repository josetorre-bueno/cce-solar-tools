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
| MOD-03 | `nsrdb` | **Complete** (data + aggregation script) | `nsrdb_aggregate_v2_2.py`, `nsrdb_daily_summary.json`, `nsrdb_stress_window.json` |
| MOD-04 | `rate_engine` | **Stage 2 v1.4.0** — residential + commercial SDG&E rates, browser UI | `rate_engine_v1.3.0.js` + `rate_engine_app_v1.4.0.jsx` + `rate_engine.html` |
| MOD-05 | `bill_modeler` | Partial (removed from MOD-02b v1.9.0, pending standalone) | — |
| MOD-06 | `island_dispatch` | **Deployed v0.4.116** (browser UI + Python prototype) | `island_dispatch_app_v0.1.0.jsx` + `island_dispatch.html` + `mod06_island_dispatch_v11.py` |
| MOD-06b | `grid_battery_dispatch` | Planned | — |
| MOD-07 | `ev_simulator` | Not built (commercial fleet) | — |
| MOD-08 | `financial_model` | Partial (payback/NPV in MOD-10) | — |
| MOD-09 | `tracker_analyzer` | **Deployed v6.17** | `tracker_tou_app_v6.17.jsx` + `tracker_tou.html` |
| MOD-10 | `nem3_optimizer` | Partial v3 | `pv_sizing_tool.html` |

**Reference specs exist for:** MOD-02b (`MOD-02b_reference_spec.md`), MOD-06 (`MOD-06_island_dispatch_reference_spec_v0.4.68.md` — spec at v0.4.68, tool now at v0.4.116), MOD-09 (`MOD-09_tracker_analyzer_reference_spec.md`)
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

All MOD-06 dispatch simulation runs on the **1,680-hour core period** (60-day spinup + 10-day worst window) — no full-year simulation. The NSRDB JSON (v2.2+) stores **1,800 hours per cell** (75 days = 60 spinup + 10 WW + 5 post-window display days); the post-window hours are used only for chart display and are excluded from pass/fail logic and all annual extrapolations. `annualScale = 365 / coreDays` always uses `coreDays = 70`. The NSRDB stress window is pre-computed per cell and selected by haversine nearest-cell lookup for any customer lat/lon.

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

## Current Priorities (as of v6.4, updated 2026-04-16)

1. **MOD-04 rate_engine — Stage 2 complete (v1.4.0)** — SDG&E residential (TOU-DR1, EV-TOU-5, DR-SES, DR + CARE variants) and commercial (TOU-A, AL-TOU, AL-TOU-2) rates with browser UI. Next: verify approximate commercial demand charges (⚠-flagged), add SCE/PG&E/APU rates, write MOD-04 reference spec.
2. **MOD-05 standalone bill modeler** — single tool with `customer_type` flag (bundled / direct_access / fuel_cell_da); depends on MOD-04
3. **MOD-01 extraction** — PVWatts wrapper still embedded in MOD-09; extract as `pvwatts_v1.0.0.js` following MOD-04 pattern
4. **MOD-03 reference spec** — document as-implemented API for NSRDB aggregation and stress window selection
5. **MOD-06b grid_battery_dispatch** — planned; complement to MOD-06 for grid-tied battery dispatch

*MOD-04 rate_engine (v1.4.0) — Stage 2 complete. API: `computeNetIntervals()`, `computeBill()`, `computeSavings()`, `listRates()`, `selfTest()`. SDG&E residential rates (TOU-DR1, EV-TOU-5, DR-SES, DR) + CARE variants + commercial rates (TOU-A, AL-TOU, AL-TOU-2). Some commercial demand charges approximate (⚠-flagged in source). Reference spec pending.*
*MOD-06 browser UI (v0.4.72) — COMPLETE. Features: haversine nearest-cell lookup, 1,680-hour stress window dispatch, EV impact analysis, report generation, Title 24 compliance checks, optional generator dispatch. v0.4.72 fixes prio-0/1 battery→EV charging to use conservative trip-sized targets (not 90%) and adds road trip destination L2 charging, preventing battery depletion in multi-EV worst-window scenarios.*
*MOD-06 browser UI (v0.4.75) — Fixes emergency DCFC over-counting caused by prio-2 battery→EV charging at night after road trip days. Prio-2 (general top-up) is now restricted to solar-surplus hours only; nighttime battery→EV is prio-0/1 only. Also adds diagnostic breakdown in no-solution error message (worst-window pass count, en-route/emergency DCFC best values vs limits).*
*MOD-06 browser UI (v0.4.76) — Adds per-category emergency DCFC breakdown in no-solution diagnostic: road-trip infeasible, commute-return chargeToday, home-based EV — each shown as raw sim count and annualized, with ×annualScale shown. Tracks three sub-counters in dispatch() and aggregates in findOptimum() from the best-emergency config.*
*MOD-06 browser UI (v0.4.77) — Fixes emergency DCFC for V2G commuter EVs. Previous code excluded bidi EVs from prio-1 AND prio-2 battery charging (assuming peer charging covers them), but peer charging is opportunistic and may leave a V2G commuter in the dangerous zone: above tripCheckKwh (can depart) but below roundTripKwh×1.10 (can't finish round trip) → emergency on return. Fix: exclude V2G from prio-2 only; prio-1 (transport-critical) is now allowed as battery fallback for bidi commuters.*
*MOD-06 browser UI (v0.4.78) — Implements correct priority spec: EV battery is LAST drained and FIRST charged. (1) V2H discharge order reversed: stationary battery now covers load deficit first, bidi EVs discharge as backup only when battery is insufficient. Previous order (EVs first) was draining V2G commuters during the day, causing emergency DCFC. (2) Solar surplus charging restructured into 3 phases: EVs below transport minimum first, then battery, then EVs general top-up. Phase 1 is a targeted no-op when EVs are already transport-ready.*
*MOD-06 browser UI (v0.4.79) — All SOC/battery charts now scale to 0–100 % of each device's own capacity (y-axis "SOC %" instead of "Energy kWh", fixed max=100). Confirmed stationary battery is shown alone (batKwhEnd = batE only, not summed with EVs). Also fixed undeclared evKwhCap variable in main result chart label (was undefined; now uses evList[0].kwh). Min-SOC dashed reference lines updated to show % values. Applied to all four chart sections: main result, EV impact, EV detail (±24h).*
*MOD-06 browser UI (v0.4.80) — Travel-frequency dispatch priority: EVs with more trips/week are charged first and discharged last (protecting the most-traveled commuter's range). evSolarOrder sort uses tripsPerWeek descending; bidiOrder (V2H discharge) uses tripsPerWeek ascending (least-traveled V2G EV gives energy first); bidiSources (peer charging) also sorted by tripsPerWeek ascending. Dual y-axis charts: all battery/EV SOC panels now show kWh on the left axis (common scale = max device capacity × 1.05) and %SOC on the right axis, calibrated per device so 100% always aligns with full capacity. Data stays in kWh; right axis shows only 0/25/50/75/100% ticks.*
*MOD-06 browser UI (v0.4.86) — Fixes generator PV paradox: battery+generator path was requiring more PV than battery-only because the TMY annual generator simulation (`countAnnualGenHours`) kept hitting the 10% floor in winter, inflating annual hours >> 52 hr limit and forcing larger PV. Fix: `findOptimumGenerator` now filters on `r.simGenHours ≤ genHrLimit` (stress-window hours as proxy) instead of the TMY hard-filter. The TMY run is retained only for fuel NPV cost estimation, not as a constraint.*
*MOD-06 browser UI (v0.4.87) — (1) Chart alignment fix: Battery kWh panel was narrower than Power panel because %SOC right axis consumed extra width. Fix: `afterFit: yFit2` callback on all `makeSocAxisY2` instances forces fixed right-axis width (`Y2_W = 46`); panels without a right axis get `layout.padding.right: Y2_W` to match. (2) Battery costs are now settable per-system in the UI (replaces $/kWh × kWh model). `BATTERY_LIBRARY` uses `fixedCost` ($/system). `batteryCosts` state persists in localStorage. Both `findOptimum` and `findOptimumGenerator` updated to use `bat.fixedCost` directly.*
*MOD-06 browser UI (v0.4.88/v0.4.89) — Post-window display extension. Requires `nsrdb_aggregate_v2_2.py` (new) which adds `--post-window-days 5` (default), storing 1,800 hours/cell (75 days) instead of 1,680. `expandStressWindow` sets `isPostWindow` flag on hours after the 10-day WW. `annualScale` correctly uses `coreDays = 70` (excludes post-window). All chart blocks (main result, EV impact, EV impact detail, generator dispatch) shade post-window hours green. Hover sidebars show "Period: Post-window" in green for those hours. CSV exports include PW column. v0.4.89 fixes `ReferenceError: displayEnd is not defined` in Block 1's generator overlay slice.*
*MOD-06 browser UI (v0.4.90) — Three gen dispatch fixes: (1) Start day alignment: gen chart now uses same 48h (2-day) lead-in as PV-only chart (was 96h/4-day). (2) Panel width alignment: gen Panel 1 now has `layout.padding.right: Y2_W` and Panel 2 now has a `y2` %SOC right axis (calibrated to battery capacity) using `makeSocAxisY2`, matching the width of the PV-only chart. (3) False gen trigger at end of data: `shortageExpected` and `canStop` look-ahead loops previously clamped `idx = Math.min(h+j, N-1)`, causing them to read the last data row indefinitely when near the end of the simulation window; changed to `break` when `idx >= N` so the projection stops cleanly at the data boundary.*
*MOD-06 browser UI (v0.4.91) — Two post-window display fixes: (1) Hover panel showed "Spinup" for post-window hours in the battery-only chart because `dispatch()` trace was missing `isPostWindow` — added `isPostWindow: r.isPostWindow || false` to the trace.push. (2) Post-window green background tint removed from all four chart blocks (main result, EV impact, EV detail, gen dispatch) and all legend `LEG_PW` entries removed — post-window now has a white background identical to spinup. All "Post-window" period labels in hover sidebars retain the text but use neutral grey (#555) instead of green.*
*MOD-06 browser UI (v0.4.92) — Fix generator Criterion 2 hard filter. `findOptimumGenerator` was filtering on `r.simGenHours` (70-day stress-window hours) as a proxy for annual hours — a v0.4.86 workaround for the PV paradox that turned out to be too permissive: configurations with 245 TMY hr/yr were accepted against a 52 hr/yr limit. Fix: `countAnnualGenHours` (TMY 8760-h, emergency-floor trigger only) is now called BEFORE the `genHrLimit` check, and `ann.annualGenHours > genHrLimit` is used as the hard filter. `r.simGenHours` check removed. The TMY annual simulation correctly reflects real-world ordinance compliance.*
*MOD-06 browser UI (v0.4.93) — Fix two bugs in `countAnnualGenHours` that caused the PV paradox (generator requiring MORE PV/battery than battery-only): (1) Starting SOC: changed from 50% to 100%. The stress-window simulation has an autumn spinup that charges the battery to ~80-90% before the worst winter window; the annual sim starts January 1 with no such spinup, so a 50% start caused spurious January floor-hits and generator runs for systems that passed battery-only. (2) Same-timestep stop-restart race: `sol >= ld` stopped the generator at dawn, then `batE <= batMin` immediately restarted it in the same timestep (battery still at floor from the preceding night), logging a spurious run-hour every morning. Fix: added `sol < ld` to the generator start condition. Both fixes together ensure that any (pvKw, bat) combination that passes battery-only has ≤ 52 annual generator hours when a generator is added — eliminating the paradox while still correctly rejecting genuinely generator-heavy designs.*
*MOD-06 browser UI (v0.4.94) — Fix remaining PV paradox: even after v0.4.93 fixes, the generator optimizer could still recommend MORE solar than battery-only because small batteries (`codeMinBatKwhWithGen = 0`) create frequent floor hits in the TMY simulation, forcing larger PV to keep annual hours ≤ 52. Root fix: in `findOptimumGenerator`, before the `genKw` inner loop, call `dispatchGenerator(genKw=0)` to pre-check if the battery alone passes the stress window. If yes (`batAlreadyPasses = true`), annual hours are set to 0 unconditionally — the battery handles everything and the generator never fires in a typical year, regardless of battery size. This is a mathematical guarantee: if the stress window (worst 70 days) is survived without a generator, all other days in a TMY year are at least as easy. `countAnnualGenHours` is now only called for generator-dependent configurations (battery alone fails stress window), where the TMY simulation correctly measures how often the generator is needed in a typical year.*
*MOD-06 browser UI (v0.4.95) — Fix suboptimal planning trigger in `dispatchGenerator`: the afternoon lookahead trigger was starting the generator even when the battery was at 95-100% SOC. A 10 kW generator serving a 2 kW load produces 8 kW of surplus, but a full battery has nowhere to absorb it — the output is curtailed and the 95% stop condition fires after just one wasted hour. Fix: added `batE < batMax * 0.75` guard to the planning trigger — the generator only starts when the battery has discharged below 75%, ensuring each planning run has at least 20% of capacity to absorb (4+ kWh for a 20 kWh battery). This significantly reduces total annual run hours and allows smaller batteries to pass the 52 hr/yr Criterion 2 limit.*
*MOD-06 browser UI (v0.4.96) — Regulatory fix for generator hour limits. The CA ordinance 52 hr/yr limit applies only to NORMAL operation outside the worst 10-day window; generator hours during the worst window (emergency) and during the 3-day no-solar test (also emergency) are exempt. Three changes: (1) `countAnnualGenHours` gains `wwStartH`/`wwLenH` parameters — generator hours during the worst-window period are excluded from `annualGenHours` (the ordinance count) but still accumulate in `genHoursTotal` for fuel cost. (2) `findOptimumGenerator` and both `sweepGenerators` call sites now pass this mask. (3) `criterion1Pass` (3-day no-solar test) now compares against `emergencyGenHrLimit` (200 hr) instead of `genHrLimit` (52 hr) — no-solar is an emergency scenario where the ordinance restriction is lifted. UI display updated: Criterion 1 shows "of 200 hr emergency limit"; Criterion 2 shows "(excl. worst window)".*
*MOD-06 browser UI (v0.4.97) — Fix planning trigger "small boost" pattern. `canStop(h)` was stopping the generator at 65-70% SOC based on an optimistic lookahead that tomorrow's solar would finish the charge. On consecutive bad days this was wrong: the battery would receive only a small boost, drain further overnight, trigger another short run the next evening, and cycle repeatedly without ever reaching a full charge. Fix: add `genByPlanning` boolean flag to `dispatchGenerator`. When the afternoon planning trigger fires it sets `genByPlanning = true`. The `canStop` stop condition is now guarded by `!genByPlanning` — planning runs ignore canStop and charge all the way to 95% (battery-full threshold). Emergency runs (floor trigger, `genByPlanning = false`) retain canStop as before. Both run types still stop immediately on `sol >= ld` or battery ≥ 95%, and both reset `genByPlanning = false` on stop. The result is fewer, longer planning runs that fully recharge the battery each time, enabling the optimizer to select smaller batteries.*
*MOD-06 browser UI (v0.4.98) — Fix `countAnnualGenHours` over-counting annual hours for high-load scenarios. With the default 16,000 kWh/yr load and limited PV, the battery drains to the emergency floor (10%) repeatedly each winter, and each floor-to-95% refill takes ~4× longer than a planning top-up. The emergency-floor-only trigger in `countAnnualGenHours` was therefore reporting 100+ annual hours for small batteries, causing the optimizer to require large PV or large batteries to stay under the 52 hr/yr limit. Fix: add the same afternoon planning trigger (hr ≥ 14 or hr = 18, batE < 75%, sol < ld) to `countAnnualGenHours`. This mirrors actual dispatch behaviour: the generator fires proactively at 75% for a ~1-hour top-up rather than waiting for the 10% floor and a ~4-hour refill. The result is both more accurate (matches the dispatch model) and much lower annual hour counts for high-load scenarios, allowing the optimizer to find smaller, cheaper battery configurations.*
*MOD-06 browser UI (v0.4.99/v0.4.100) — Add battery optimizer diagnostics table and full CSV export. After running the 4-way sweep, `findOptimumGenerator` now returns a `batteryDiag` object keyed by battery label. For each battery it records: (a) count of configs rejected because stress-window simulation failed (`rejectWwPass`), (b) count rejected because worst-window gen hours exceeded 200 hr limit (`rejectWwHours`), (c) count rejected because annual gen hours exceeded 52 hr/yr limit (`rejectAnnualHours`), (d) lowest annual gen hours seen across all rejected configs (`bestAnnualHours`), and (e) best-cost passing config if any. A diagnostics table is rendered below the battery-vs-generator comparison panel, showing each battery size, its rejection counts, best annual hours seen, best achievable NPV cost, and a status column (★ SELECTED / passes — $cost / ✗ rejection reason). v0.4.100 extends this with a full per-combination CSV export (every mount × pvKw × battery × genKw row with all metrics including annGenHours, wwGenHours, pvCost, batCost, fuelNpv, totalCost, rejection reason, and isOptimum flag) downloadable via "⬇ Export full CSV" button in the diagnostics panel.*
*MOD-06 browser UI (v0.4.101) — Fix multi-fire bug in `countAnnualGenHours` planning trigger. The `hr >= 14` trigger check ran every hour from 14:00 to 23:59; after charging to 95% and stopping, the battery drained back below 75% triggering another run, then again — inflating annual hours 3-5× vs reality. Fix: add `(h - lastGenStopH >= 8)` refractory guard to the planning trigger — once the generator stops, it cannot be re-triggered for 8 hours (the approximate time for the battery to drain from 95% back to the planning threshold at typical overnight load).*
*MOD-06 browser UI (v0.4.102) — Root fix: rewrite `countAnnualGenHours` to use identical dispatch logic to `dispatchGenerator`. The fundamental problem was that the stress-window simulation (`dispatchGenerator`) and the annual simulation (`countAnnualGenHours`) used completely different rules — `dispatchGenerator` uses `shortageExpected(h)` lookahead, while `countAnnualGenHours` used a naive threshold trigger. This made the annual simulation far more aggressive than the stress-window simulation: a system that uses the generator only 3 times in the worst 10 days was being reported as needing it 2380 hr/yr. Fix: `countAnnualGenHours` now contains identical `shortageExpected` and `canStop` closures and the same `genByPlanning` flag, start/stop thresholds, and planning trigger guard. `lookaheadDays` is now passed through from `findOptimumGenerator`. The annual simulation now correctly identifies that good TMY solar seasons require minimal generator use.*
*MOD-06 browser UI (v0.4.103) — Annual dispatch chart. After the optimizer finds the winner, `countAnnualGenHours` is re-run once more with `returnTrace=true`, capturing per-hour `Float32Array` traces for battery kWh, generator on/off, solar kW, and load kW. These are stored in `_genOptResult.annualTrace`. A new "📅 Annual Generator Dispatch" card appears below the optimizer diagnostics showing: (1) a full-year overview canvas strip (HTML5 2D, 365 daily columns, blue=avg battery SOC, orange=generator hours/day) with click-to-navigate; (2) two Chart.js panels (power kW + battery kWh) for the selected zoom window, downsampled to max 720 points for performance; (3) scroll wheel zoom (mouse over the detail panels), ← → pan buttons, and a range slider. Zoom range: 2 days to full year.*
*MOD-06 browser UI (v0.4.104) — Post-window display extension (continuation of v0.4.88/v0.4.89 work, correctly versioned). All chart blocks (main result, EV impact, EV impact detail, generator dispatch) display 5 days beyond the 10-day worst window using data from the v2.2 NSRDB JSON (1,800 hours/cell). `isPostWindow` flag propagated through `dispatch()` trace. Hover sidebars show "Period: Worst window / Post-window / Spinup". CSV exports include PW column. `displayEnd` undefined reference in Block 1 generator overlay fixed. Requires `nsrdb_stress_window.json` regenerated with `nsrdb_aggregate_v2_2.py --post-window-days 5` (17.6 MB, 683 cells).*
*MOD-06 browser UI (v0.4.105) — Two bugs fixed + battery-only annual dispatch chart. (1) Selection algorithm inconsistency: `findOptimumGenerator` was using `annualGenHours=0` (batAlreadyPasses shortcut, v0.4.94) for selection, but then generating the annual trace WITH the generator present — producing 267 hr/yr in the chart while the selection assumed 0. Fix: `best` object now carries `batAlreadyPasses` flag; trace generation uses `genKw=0` when `batAlreadyPasses=true`, so chart is consistent with selection (generator not dispatched in typical year when battery alone covers the worst window). Annual generator dispatch chart title shows "(battery covers all load — generator not needed in typical year)" when applicable. (2) Battery-only annual dispatch chart: after `findOptimum` finds the battery-only optimum, a new 8760-hour dispatch (genKw=0) is run with `returnTrace=true` and stored in `res._annualTrace`. A "📅 Annual Battery Dispatch" card renders above the generator annual chart with the same overview strip + zoom panel UI (scroll wheel, ← → pan, range slider). Overview shows daily avg battery SOC in blue only (no generator bars). Battery-only annual chart state + refs: `annBatZoomH`, `annBatZoomW`, `annBatOverviewRef`, `annBatDetailContRef`, `annBatP1Ref`, `annBatP2Ref`, `annBatP1Inst`, `annBatP2Inst`.*
*MOD-06 browser UI (v0.4.107) — Annual dispatch chart UI: synchronized zoom/pan, center-of-window values panel, and vertical crosshair. (1) Battery-only and generator annual charts now share a single zoom state (`annZoomH`/`annZoomW`) — removed separate `annBatZoomH`/`annBatZoomW` state; both charts respond identically to slider, ← → buttons, and scroll wheel. (2) A shared "Annual Dispatch — Comparison" control card shows one slider controlling both charts plus a center-of-window values panel with two columns (Battery-only: Solar kW, Load kW, Battery kWh/%, Unserved kW; Generator: Solar kW, Load kW, Battery kWh/%, generator on/off). Values update as the window moves. (3) Thin dashed vertical center line drawn on all four annual detail panels (annP1, annP2, annBatP1, annBatP2) using Chart.js afterDraw plugins; also shown on both overview canvas strips. The two chart cards (Battery-Only Annual, Generator Annual) are now compact sub-sections without their own controls.*
*MOD-06 browser UI (v0.4.124) — Annual operating cost display in Phase 1 comparison cards. (1) `countAnnualGenHours` now returns `enrouteDcfcTrips` and `emergencyDcfcTrips` from the underlying `simulatePeriod` result. (2) `findOptimumGenerator` `best` object now carries `annualEnrouteDcfc` and `annualEmergencyDcfc`. (3) Both Battery-Only and Battery+Generator columns now show an "Annual operating costs" section above Total NPV: generator column shows hr/yr + fuel $/yr; battery-only column shows en-route DCFC trips/yr + cost/yr (when dcfcCostPerKwh set) and emergency DCFC trips/yr highlighted in red. DCFC electricity cost in battery-only column uses stress-window extrapolated values (`annualEnrouteDcfcCost`); generator DCFC shows trip counts only (no cost since dcfcCostPerKwh not currently threaded through generator optimizer). Redundant "Fuel" line removed from generator criteria checklist.*
*MOD-06 browser UI (v0.4.123) — Fix generator firing when battery+EV config already covers load. Root cause: the generator planning trigger (50%) and emergency floor trigger (20%) fired based solely on stationary battery SOC, without checking whether V2G EVs had energy available. Since the trigger runs at the TOP of the hour before V2G discharges in the energy balance, the generator would start and run for an hour while V2G was about to discharge anyway. Fix: before either trigger, compute `v2gAvailKwh` = sum of energy above safe floor for all canV2G EVs currently at home. If `v2gAvailKwh > 1.0` (`v2gCovering = true`), both triggers are suppressed. When V2G is exhausted or absent, triggers behave exactly as before. Mathematical guarantee: any (PV, battery, EV) config that passes battery+EV dispatch without a generator will also pass with a generator present but with `genKw` never firing — making generator path results directly comparable to battery-only results for the same hardware. `isTripDay` and `seqDayH` are reused to compute the correct V2G floor (includes round-trip reserve when trip tomorrow).*
*MOD-06 browser UI (v0.4.129) — Major architectural pivot to two-criteria system + display improvements. (1) BATTERY_LIBRARY extended to 10 units per family: 7x–10x Enphase 10C ($98k–$140k) and 7x–10x Powerwall 3 ($108.5k–$155k), both linear pricing. (2) `simulatePeriod` gains `traceEnrouteDcfc` and `traceEmergencyDcfc` (Uint8Array per hour); `enrouteDcfcThisHour` flag wired to all 4 en-route DCFC call sites; both arrays stored in `_annualTrace` and `genOptResult.annualTrace`. (3) DCFC visualization on annual P1 charts: teal dashed vertical lines = en-route DCFC; red solid lines from 50% height = emergency DCFC. (4) Center-of-window values panel expanded: solar, load, curtailed PV, unserved as checksum ("should be 0"), battery kWh+%, each EV with kWh/%/"Away", generator on/off. (5) Arrow key navigation on Annual Dispatch card (←/→ = ±1 hr, requires focus). (6) Stress-window charts removed: Battery-Only Dispatch, Generator Dispatch, EV Impact, EV Detail (643 lines). Annual charts are now the sole simulation display.*
*MOD-06 browser UI (v0.4.128) — EV away-state visualization in annual charts. `simulatePeriod` now populates `traceEvAway` (Uint8Array[] per EV, 1=away) alongside `traceEvE`; returned in both `_annualTrace` and `genOptResult.annualTrace` as `evAwayTraces`. Overview canvases (battery and generator): EV bar drawn in solid color (80% opacity) when home during solar hours (6–18), faded (25% opacity) when away for >50% of solar hours — communicates that the EV battery is not available to serve the building. Annual P2 detail charts (battery and generator): grey background shading (`rgba(100,100,100,0.13)`) during any hour when an EV is away, via `annBatEvAwayPlugin`/`annGenEvAwayPlugin`. Algorithm confirmation: `simulatePeriod` correctly excludes away EVs from all solar charging and V2H dispatch in both stress-window and annual runs; this change is visualization only.*
*MOD-06 browser UI (v0.4.127) — Add curtailed-solar tracking and visualization to annual dispatch charts. `simulatePeriod` now populates `traceCurtailed` (Float32Array) when `returnTrace: true`. Both `_annualTrace` and `genOptResult.annualTrace` include `curtailed`. Annual overview canvases (battery-only and generator) draw yellow bars from the top of the canvas proportional to daily curtailed kWh (normalized to annual max; max bar = 18% of canvas height). Annual detail P1 charts (battery-only and generator) show the olive/yellow bezier fill between the solar curve and `solar − curtailed` using the same `drawCurtainBezier` helper as the stress-window charts; `_curtBot` flag lookup replaces hardcoded dataset-index 2 for robustness. Legend entry "Curtailed solar" added when `hasCurt`. Curtailment appears in spring/summer when battery + EVs are full; the annual view is the primary place to observe this since the worst-window period is a winter slice where batteries rarely fill.*
*MOD-06 browser UI (v0.4.126) — Fix missing curtailed-solar overlay on EV impact P1 chart. The `evImpCurtailPlugin` was never wired into the EV impact panel's P1 chart even though `hasCurt`, `curtDs`, and `solarBotDs` (dataset index 2) were all already computed correctly. Added `evImpCurtailPlugin` (identical bezier fill logic to main result `curtailPlugin`) and updated the panel legend to show "Curtailed solar" entry when `hasCurt`. Also added `_curtBot: true` flag to the hidden bottom dataset for consistency with the `buildLegend` filter used in other panels.*
*MOD-06 browser UI (v0.4.125) — Fix generator annual chart: EV battery traces now appear in both the overview canvas and detail Chart.js panels. Root cause: `genOptResult.annualTrace` only stored `bat`, `gen`, `sol`, `ld`, `batKwh`, `genKw` — no EV fields. `countAnnualGenHours` return now includes `traceEvE`. `genOptResult.annualTrace` now stores `evTraces`, `evKwh`, `evLabels`, `evTrips`, `unserved` sorted ascending by tripsPerWeek (same structure as battery-only `_annualTrace`). Generator overview canvas `useEffect` and detail charts `useEffect` replaced with unified stacked versions identical to battery-only chart logic: P1 = solar + load + generator kW + unserved; P2 = stacked EV SOC (amber/green/teal ascending trips) + stationary battery (blue) on top. Without EVs both fall back to previous single-battery rendering.*
*MOD-06 browser UI (v0.4.122) — EV+generator co-simulation: EVs are now passed through to all generator model functions (`dispatchGenerator`, `countAnnualGenHours`, `sweepGenerators`, `findOptimumGenerator`). Phase 2a and Phase 2b now use `sweepFleetScen` and `erMinKwhSweep` so the generator optimizer sees the same EV fleet as the battery optimizer — the generator fires only when EVs are at their transport limit, not to make up for EV storage that is already covering load. Annual gen trace also includes fleet EVs so chart is consistent with selection. Added `emergencyDcfcThisHour` flag to `simulatePeriod` trace rows (`emergencyDcfcEvent` field) so emergency DCFC events are tracked separately from en-route DCFC. Red triangle markers at load×0.5 height indicate emergency DCFC hours on the main result chart. Phase 1 system design cards now show en-route and emergency DCFC trip counts per year (when EVs in sweep).*
*MOD-06 browser UI (v0.4.121) — Stacked SOC chart in annual dispatch. When EVs were co-designed in the sweep, the annual battery panel now shows a stacked area chart: least-used EV (lowest tripsPerWeek) at the bottom in amber, additional EVs in green/teal, stationary battery in blue on top. Y-axis max = sum of all capacities. Overview canvas draws stacked daily-average bars in the same layer order. `simulatePeriod` gains `traceEvE` (Float32Array[] per EV, populated when `returnTrace && nEv > 0`). `_annualTrace` stores `evTraces`, `evKwh`, `evLabels`, `evTrips` sorted ascending by tripsPerWeek. Without EVs the chart falls back to the previous single battery line with min-SOC reference.*
*MOD-06 browser UI (v0.4.120) — Fix annual trace to include EVs. Annual trace generation was still calling `countAnnualGenHours` (no EV support), making the chart inconsistent with the Criterion 2 annual check (which uses EVs since v0.4.119). Fix: trace now calls `simulatePeriod` with `sweepFleetScen` directly — same fleet used for optimization. The stationary battery SOC chart now shows actual behaviour with EVs helping, not false depletion during EV-covered hours. Removed stale "Stationary battery only — V2G EVs excluded for conservatism" note. Annual chart card header renamed from "Battery-Only Annual" to "Annual Dispatch" with EV co-design count shown when applicable. Center-of-window values panel column header updated to "Battery + N EV" when EVs were in sweep.*
*MOD-06 browser UI (v0.4.119) — Three changes: (1) Destination charging return-leg fix: EVs with free/paid L2 at destination now arrive home at `destL2TargetPct × kwh − oneWayKwh` (was missing the return drive energy deduction). (2) Annual sim (Criterion 2) now includes the full EV fleet (`evScenario` passed to `simulatePeriod`), enabling the optimizer to discover that a smaller stationary battery + EV storage satisfies the full-year coverage requirement. DCFC limits now use actual 8760-hr annual counts (no `annualScale` extrapolation). (3) UI labeling: Phase 1 header shows "Co-designed System (N EVs included in sizing)" when EVs were in the sweep, else "System Sizing (no EVs)". Phase 2 retrofit section now only renders when `evList.length > sweepEvList.length` (EVs added after sweep), and is labelled "Post-design EV Addition — Retrofit Impact".*
*MOD-06 browser UI (v0.4.118) — Generator planning trigger threshold lowered from 75% to 50% of battery capacity. Planning trigger now fires only when `batE < batMax × 0.50` (was 0.75), allowing the battery to discharge further before the generator is called in for a top-up. Emergency floor trigger (20%) and stop condition (95%) unchanged.*
*MOD-06 browser UI (v0.4.117) — Fix annual battery chart card never rendering when no annually-valid config exists. Root cause: annual battery chart condition `batTr && batOpt` where `batOpt = result.optimum` — when `result.optimum` is null (no config passes all 3 criteria), the entire chart card was hidden even though `result._annualTrace` was correctly generated. Fix: `batOpt` now falls back to `result._wwOnlyOptimum`, so the annual battery trace always renders. Added WW-only disclaimer label in chart title when fallback is active. Added V2G informational note when `result._sweepHasV2g` is set, explaining the trace is stationary-battery-only. Also fixes `!hasV2gAtSweep` gate that blocked `_annualTrace` generation for V2G runs (gate removed — annual trace always generated on stationary battery alone), and removes V2G inner-loop bypass that set `annualUnservedKwh=0` without running the simulation (all WW-passing configs now run the actual annual check).*
*MOD-06 browser UI (v0.4.116) — Integrate annual coverage check (Criterion 2) into `findOptimum` inner loop. Previously the check ran post-hoc on WW-passing configs in cost order, making it possible for small batteries to slip through if the loop short-circuited incorrectly. Now every (mount × pvKw × battery) combination is tested against all three criteria inside `findOptimum` before being added to `allPassing`: (1) WW pass, (2) annual full-year coverage via `simulatePeriod` with `initialSoc=1.0`, (3) DCFC limits. V2G designs skip the annual sim (trusts WW pass, same conservative assumption as before). New fields on each result row: `annualUnservedKwh` (null=WW failed; 0=passes; >0=fails), `annualUnservedHours`. `findOptimum` now returns both `optimum` (all-criteria) and `wwOnlyOptimum` (WW-only cheapest), `allPassingWwOnly`, and `_wwOnlyAnnualCheck`. Post-hoc annual check loop removed from `handleRunWithTrace`. Annual battery trace now always generated using `optForTrace = res.optimum || res._wwOnlyOptimum` — chart renders even when no annually-valid battery-only config exists, with red unserved-load bars showing why. Status bar shows both counts: "N of M pass all criteria (K pass WW)."*
*MOD-06 browser UI (v0.4.115) — Display/diagnostic/export fixes. (1) Battery-only comparison column now always shows the best available config: uses `result.optimum || result._wwOnlyOptimum` — when annual coverage fails, the WW-only optimum is shown with a ⚠ banner ("WW-only result — no battery-only config in selected range passes full-year coverage") plus best annual unserved hours/kWh from `_wwOnlyAnnualCheck`. (2) Criterion 2 for battery-only now shows actual annual coverage check results (✓ verified / ⚠ N hr / M kWh unserved) instead of the incorrect "N/A — WW sizing guarantees full-load coverage." (3) Battery optimizer diagnostics table removed from UI. (4) Auto CSV exports after every sweep — no button required. `triggerAutoExports(res, slug, hasEvs)` triggers four downloads (staggered 0/300/600/900 ms): `battery_sweep_{slug}.csv` (all PV × battery trials), `generator_sweep_{slug}.csv` (all mount × PV × battery × gen combinations), `annual_bat_trace_{slug}.csv` (8760-hr battery-only trace), `annual_gen_trace_{slug}.csv` (8760-hr generator trace). Annual traces include month/day/hour columns from `buildAnnualWeather()` for alignment.*
*MOD-06 browser UI (v0.4.114) — Architectural unification: merge `dispatch()`, `dispatchGenerator()`, and `countAnnualGenHours()` into a single `simulatePeriod(solarH, loadH, batKwh, batKw, genKw, evScenario, weather, opts)` function. All three previously duplicated `shortageExpected`/`canStop` closures with different hourOfDay sources, enabling the class of bugs where stress-window and annual sims applied different logic. The unified function uses `weather[h].hourOfDay` consistently — identical to `h%24` for annual runs because `buildAnnualWeather()` (new helper) sets `hourOfDay = h%24`. `opts.initialSoc` (default 0.5; annual wrapper passes 1.0) and `opts.wwExcludeStartH/wwExcludeLen` (ordinance window mask) cover the remaining per-caller differences. The three old functions become 5-line wrappers with unchanged call signatures, so all callers are unmodified. Generator + EV combined dispatch is now possible: `simulatePeriod` with both `genKw > 0` and `evScenario.length > 0` runs the full EV loop and the generator logic in the same hour — opening the path to future annual EV+generator co-simulation.*
*MOD-06 browser UI (v0.4.113) — Fix three v0.4.112 regressions caused by V2G-in-sweep. (1) Annual coverage check: when V2G EVs in sweep, skip the loop entirely (countAnnualGenHours cannot model EV dispatch; boosting batKwh was selecting an unrealistically small battery). Trust the stress-window pass: if the worst 70 days survive with V2G, lighter days do too. When no V2G EVs, use `candidate.batteryKwh` with no boost (original logic). (2) Stress-window trace: was hardcoded `[]` for evScenario — battery was sized with EVs but trace showed building load only, making a correctly-sized battery look oversized (never discharged). Fixed to use `sweepFleetScen` so trace is consistent with what was optimized. (3) Annual trace: when V2G EVs in sweep, skip generation. Boosting `annEffBatKwh = optBat.kwh + v2gEffKwh` (e.g. 20 + 77 = 97 kWh) caused `countAnnualGenHours` to show a 97 kWh battery that never discharged. When no V2G, use `optBat.kwh` directly (no boost).*
*MOD-06 browser UI (v0.4.112) — V2G-in-sweep design + eval-impact separation. Three concepts: (1) Criterion 1 (3-day no-solar) always evaluated on stationary battery only — this was already the case and is now explicitly labelled "stationary battery only." (2) If V2G EVs are present when Run Sweep is pressed, they are included in `findOptimum` as `evScenario` — their batteries contribute to criteria 2 (annual coverage) and 3 (worst-window pass) via the dispatch loop. Annual coverage check uses `effBatKwh = stationary + v2gEffKwh` approximation; `v2gEffKwh` = sum over V2G EVs of `(kwh × 0.9 − halfRange)`. Status bar and results display note when V2G is active. A `sweepEvList` state snapshot records which EVs were part of the original design. (3) "Eval Added EV Impact" button only appears when `evList.length > sweepEvList.length` (new EVs added after last sweep). If all current EVs were part of the sweep, the button is hidden — they are already in the design. Adding EVs BEFORE running sweep allows the optimizer to potentially select smaller stationary battery; adding AFTER and pressing eval keeps the baseline (no reduction) and shows impact of the additions.*
*MOD-06 browser UI (v0.4.111) — Explicit charge target settings + V2G floor improvement. (1) Two new per-EV UI settings: `dcfcTargetPct` (default 80 %) and `destL2TargetPct` (default 95 %), replacing all eight hardcoded 0.80/0.90/0.95 fractions in the dispatch loop. DCFC target applies to: road-trip pre-departure ceiling, en-route planned DCFC, emergency DCFC on commute return, emergency DCFC for home-based EVs. Dest L2 target applies to: road-trip destination L2 (hotel/family), daily commute work L2 arrival. (2) V2G discharge floor changed from `evMn` to `evMn + halfRangeKwh` (= min reserve + one-way trip miles ÷ 2 ÷ efficiency) in both daytime V2G→battery top-up and nighttime bidiOrder load-deficit discharge. This ensures V2G EVs always retain enough charge to reach a DCFC station, while making more of the EV battery available as effective storage when the car is home. The bidiOrder floor also preserves full round-trip reserve when there is a trip tomorrow.*
*MOD-06 browser UI (v0.4.110) — Fix destination L2 charging target: `rtDcfcTarget` changed from `ev.kwh * 0.80` to `ev.kwh * 0.95`. Destination L2 (hotel, family, destination charger) has a full overnight window and should charge to 95%, not 80%. The lower target was causing EVs to arrive home with less charge than expected.*
*MOD-06 browser UI (v0.4.109) — Fix Criterion 2 reporting 0 hr while chart shows generator running in August. Root cause: `batAlreadyPasses` shortcut in `findOptimumGenerator` inner loop (line ~1518) set `annualGenHours=0` whenever the battery alone passed the stress window, bypassing `countAnnualGenHours` entirely. Same wrong guarantee as v0.4.105/v0.4.108 trace bug: worst-window pass ≠ generator-free typical year. Fix: remove the shortcut; always call `countAnnualGenHours` with the real `genKw`. `batAlreadyPasses` is retained in diagnostics CSV only (comment updated to "diagnostic only").*
*MOD-06 browser UI (v0.4.108) — Four display and correctness fixes. (1) Generator annual trace always uses real `genKw` — removed `batAlreadyPasses ? 0 : genKw` shortcut that was making the generator show 0 kW when running and falsely labeling August nights as "load covered." Worst-window pass does not guarantee full-year coverage; the actual generator fires when needed. (2) Removed "battery covers all load — generator not needed in typical year" legend from generator chart. (3) Month labels removed from overview canvas `fillText` (obscured bars at bottom edge); replaced with proportional HTML `<div>` row of `<span>` elements below each overview canvas, positioned at `left: (d/365)*100%`. (4) Slider/controls row moved from above the values panel to below it, so it sits immediately above the chart cards it controls.*
*MOD-06 browser UI (v0.4.106) — Annual coverage as hard rejection criterion for battery-only path. The worst-10-day window sizing guarantee was found to be incorrect: a battery sized to survive the worst window may still shed load during extended low-solar periods in a full winter season (battery at min SOC, no solar, load present). Three changes: (1) `countAnnualGenHours` now tracks `unservedKwh`, `unservedHours`, and `traceUnserved` (Float32Array) even when `genKw=0` (pure battery dispatch). (2) After `findOptimum` returns, an annual coverage check iterates all WW-passing configs in cost order; the first with zero annual unserved load becomes `res.optimum`. Configs that shed any load are rejected regardless of WW pass status. `res._wwOnlyOptimum` saves the original WW-only optimum for Phase 2a fallback and UI notes. (3) Phase 2b (generator joint optimizer) moved outside the `if (res.optimum)` condition — it always runs, because the generator path is the recommended alternative when no battery-only annual-valid config exists. UI: "Annual Battery Dispatch" chart shows unserved hours as red bars on overview and "⚠ Unserved kW" red trace on detail panel. Battery-only column shows "No battery-only configuration covers the full year — generator required" when all WW-passing configs have annual unserved load.*

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
| `nsrdb_stress_window.json` | 17.6 MB | 75-day arrays (60 spinup + 10 WW + 5 post-window); generated by `nsrdb_aggregate_v2_2.py` |
| `sizing_sweep_v11.csv` | 283 KB | All PV × battery × EV scenario combinations for Valley Center site |
| `sizing_summary_v11.json` | 3.7 KB | Min-cost configs at 90/95/99% annual reliability |

NSRDB raw hourly CSVs (~270 MB) are local machine only — too large for GitHub or Claude project knowledge and not needed at runtime.

`nsrdb_stress_window.json` (17.6 MB) **is deployed to GitHub** alongside `island_dispatch.html` — MOD-06 fetches it at runtime and cannot function without it. It is too large for Claude project knowledge but is within GitHub's 25 MB web-upload limit. Do not treat it as local-only. Generated by `nsrdb_aggregate_v2_2.py --post-window-days 5`; older versions (v2.1 and earlier) produce 70-day arrays and will display without post-window shading.

`pvwatts_config.json` **must be deployed to GitHub** — MOD-06 and MOD-09 fetch it at startup to load the NREL API key. Without it, tools fall back to localStorage and show "key not set." ⚠️ This file contains the API key in plain text. JavaScript-based auth (auth.js) does not protect static files from direct URL access — the key is technically readable at `tools.cc-energy.org/pvwatts_config.json` without a password. Risk is low (NREL keys are free, rate-limited, easy to rotate) but the limitation is known.

---

## External APIs

- **NREL PVWatts v8:** `https://developer.nlr.gov/api/pvwatts/v8.json` — API key on file at CCE (admin@cc-energy.org)
- **NREL NSRDB:** `https://developer.nlr.gov/api/nsrdb/v2/solar/nsrdb-GOES-aggregated-v4-0-0-download.csv`
- **Nominatim geocoding:** free, no key required (used in MOD-09)
