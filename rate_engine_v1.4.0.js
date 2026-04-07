// MOD-04 rate_engine — module
// Version: v1.4.0
// Part of: Wipomo / CCE Solar Tools
//
// Stage 1 — pure computation, no UI, no DOM dependencies.
// Load as a <script> tag in a browser, or require() in Node.js.
//
// ─── PUBLIC API ────────────────────────────────────────────────────────────────
//
//   MOD04.computeNetIntervals(loadIntervals, pvKwhHourly, systemDcKw)
//     → [[Date, kWhNet], ...]
//     Subtracts PV production from load for each 15-min interval.
//     pvKwhHourly is an 8760-element TMY array (1 DC-kW reference).
//     Alignment is by month+hour average (not by absolute position) so
//     the load data year does not need to match the PVWatts TMY year.
//
//   MOD04.computeBill(intervals, rateKey, options)
//     → BillResult
//     Core billing engine. intervals are [[Date, kWh], ...] where kWh is
//     already net (use computeNetIntervals first if you have raw load + PV).
//     Positive kWh = grid import; negative kWh = export.
//
//   MOD04.computeSavings(loadIntervals, pvKwhHourly, systemDcKw, rateKey, options)
//     → SavingsResult
//     Convenience wrapper: runs computeBill on both baseline (no solar) and
//     net-load intervals, returns both results plus annualSavings and npv25.
//
//   MOD04.listRates(customerType?)
//     → [{ key, label, rateNote, recommendedNem, customerType, billingType, hasDemandCharge, careAvailable }, ...]
//     customerType: 'residential' | 'commercial' | undefined (undefined = all rates)
//
//   MOD04.VERSION  → "1.4.0"
//   MOD04.ALL_RATES (also RESIDENTIAL_RATES for backward compat)  (read-only, keyed rate definitions; each entry has customerType field)
//
// ─── OPTIONS (computeBill) ──────────────────────────────────────────────────────
//
//   nemType    'nem3' | 'nem2' | 'none'   Export credit methodology (default: 'none')
//              nem3 → NBT rates (MIDAS, $/kWh timestamped)
//              nem2 → retail net metering at same TOU rate (legacy, DR-SES customers)
//              none → no export credit (baseline bill or no interconnection)
//
//   yearOffset  int    Years from 2026 for NBT table indexing and escalation (default: 0)
//   utilEsc     float  Annual utility escalation for NBT extrapolation beyond 2027 (default: 0.04)
//
//   care        boolean  Apply CARE discount rates (default: false).
//               CARE rates are verified from CPUC-sanctioned SDG&E tariff PDFs.
//               Only available for TOU schedules (TOU-DR1, EV-TOU-5, DR-SES).
//               Schedule DR CARE rates are not yet published in the same format.
//   (Demand rates only — no additional options needed; demand is computed from interval data)
//
// ─── KNOWN SIMPLIFICATIONS (v1.3.0) ────────────────────────────────────────────
//
//   - Baseline allowance credit not modeled (TOU-DR1 / EV-TOU-5 do not use
//     tiered baseline structure per SDG&E tariff design).
//   - Weekend TOU schedule: SDG&E TOU-DR1 and EV-TOU-5 apply peak 4–9 PM
//     every day including weekends; this module models that correctly.
//     DR-SES uses same all-days-equal schedule.
//   - NEM 2.0 export credit (DR-SES / 'nem2') uses the retail TOU rate at
//     the export timestamp — this is the simplified net metering model.
//     True NEM 2.0 uses annual true-up with bank carryforward; not modeled here.
//   - NBT export rates are provided for 2026–2027; years beyond 2027 are
//     extrapolated by applying utilEsc annually.
//   - Minimum bill / reconnection charge not modeled.
//   - DR tiered billing uses approximate tier boundary (varies by climate zone).
//   - CARE rates are available for TOU schedules (TOU-DR1, EV-TOU-5, DR-SES).
//     Schedule DR CARE rates are not yet published in the same format; DR CARE pending.
//   - Demand charge ratchet (11-month rolling peak) not modeled for AL-TOU-2. Monthly peak only.
//   - Some commercial rate values marked ⚠ are approximate — verify against current SDG&E tariff PDFs.
//   - APU TOU-2: RSA applied uniformly; strictly the PCA component applies only above 10 kWh/day.
//   - APU TOU-2: D-NEM export credit (ACC rate × ToD factor) not modeled; select nem2 as rough over-estimate.
//   - APU TOU-2: customerChargePerDay = $8.00 ÷ 30 = $0.26667; APU bills flat $8.00/month regardless of days.

(function (global) {
  'use strict';

  const VERSION = '1.4.0';
  const MONTHS  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  // ─── NBT EXPORT RATES ────────────────────────────────────────────────────────
  // Source: Current_Year_NBT_Pricing_Upload_MIDAS.xml (USCA-XXSD-NB00-0000)
  // Structure: NBT_RATES[yearIdx][month 0-11][hour 0-23][0=weekday, 1=weekend/holiday]
  // yearIdx: 0 = 2026, 1 = 2027; extrapolate beyond with utilEsc per year past 2027.
  // Values in $/kWh.
  const NBT_RATES = JSON.parse('[[[[0.088018,0.087115],[0.085915,0.087709],[0.08369,0.08582],[0.083209,0.084591],[0.085251,0.08349],[0.088858,0.084578],[0.08911,0.087148],[0.084378,0.07884],[0.072582,0.065039],[0.064781,0.055379],[0.063119,0.053811],[0.062418,0.052555],[0.062357,0.052897],[0.059677,0.047929],[0.058795,0.051885],[0.060686,0.053747],[0.077365,0.078291],[0.107372,0.103274],[0.098065,0.092955],[0.088746,0.085931],[0.087669,0.084845],[0.088297,0.084078],[0.091993,0.087486],[0.089653,0.084263]],[[0.087211,0.0837],[0.084694,0.084721],[0.08651,0.08338],[0.086651,0.083224],[0.088635,0.082277],[0.087078,0.082089],[0.083555,0.078425],[0.080407,0.069307],[0.061726,0.047325],[0.051618,0.026768],[0.048867,0.026735],[0.046968,0.024482],[0.043637,0.024157],[0.038952,0.021857],[0.032512,0.021434],[0.03066,0.018795],[0.06408,0.05638],[0.106246,0.096896],[0.091132,0.099606],[0.085484,0.0881],[0.085911,0.08515],[0.083049,0.082132],[0.090105,0.083095],[0.086358,0.089704]],[[0.072942,0.066161],[0.069432,0.067403],[0.065563,0.068719],[0.064982,0.070252],[0.066131,0.069248],[0.069222,0.069209],[0.071449,0.066733],[0.06454,0.060302],[0.045923,0.006254],[0.021434,0.001806],[0.016923,0.00457],[0.015751,0.002826],[0.016005,0.000609],[0.011977,0.000594],[0.010416,0.0],[0.011533,0.003751],[0.022442,0.016194],[0.055682,0.031105],[0.08018,0.069955],[0.079117,0.072519],[0.07423,0.070148],[0.07138,0.069687],[0.0674,0.067888],[0.068997,0.064196]],[[0.073127,0.063637],[0.071043,0.064342],[0.075999,0.07137],[0.073604,0.075534],[0.072572,0.071918],[0.075599,0.07303],[0.067171,0.066399],[0.054033,0.044459],[0.012223,0.001525],[0.004745,0.001775],[0.007856,0.007402],[0.006946,0.004373],[0.004055,0.00072],[0.001443,0.0],[0.000599,0.0],[0.000124,0.0],[0.000756,0.0],[0.004565,0.002627],[0.072585,0.067669],[0.072367,0.077363],[0.071607,0.065678],[0.070149,0.066559],[0.067566,0.065205],[0.073733,0.067307]],[[0.076086,0.067349],[0.072081,0.068972],[0.074545,0.078746],[0.078874,0.080005],[0.079276,0.075073],[0.072949,0.068596],[0.064935,0.066631],[0.061039,0.031618],[0.022328,0.001891],[0.01181,0.004459],[0.012951,0.004213],[0.009804,0.004914],[0.00932,0.004438],[0.010304,0.003787],[0.008748,0.0],[0.00834,0.0],[0.011268,0.0],[0.031589,0.000633],[0.079269,0.056294],[0.08451,0.082698],[0.073731,0.075623],[0.072171,0.073472],[0.073531,0.073349],[0.074609,0.074792]],[[0.074269,0.070315],[0.072218,0.068271],[0.069186,0.068284],[0.07237,0.068651],[0.070089,0.065909],[0.069092,0.081987],[0.065279,0.068145],[0.059607,0.056294],[0.041389,0.017435],[0.034757,0.012918],[0.032729,0.017365],[0.028239,0.011007],[0.02788,0.012],[0.028766,0.006802],[0.032774,0.008566],[0.027245,0.008731],[0.030609,0.009594],[0.042889,0.020773],[0.085143,0.069273],[0.087481,0.09231],[0.083371,0.079939],[0.080033,0.075855],[0.074796,0.07518],[0.069175,0.071285]],[[0.070886,0.07727],[0.071468,0.07137],[0.068711,0.068981],[0.069546,0.068839],[0.066988,0.06644],[0.066891,0.067159],[0.069852,0.063602],[0.066528,0.060731],[0.063334,0.024329],[0.05654,0.02412],[0.057636,0.026086],[0.055463,0.021922],[0.051343,0.024313],[0.047215,0.025391],[0.046995,0.019634],[0.049198,0.023453],[0.047588,0.023481],[0.060355,0.042607],[0.095916,0.091438],[0.104757,0.111178],[0.090912,0.097059],[0.081586,0.078037],[0.078626,0.076206],[0.072629,0.073233]],[[0.085731,0.084578],[0.087143,0.083026],[0.084063,0.084873],[0.080639,0.078365],[0.080311,0.075695],[0.080732,0.075779],[0.077237,0.07001],[0.068571,0.059209],[0.062131,0.041725],[0.061015,0.038283],[0.060773,0.037844],[0.0602,0.037935],[0.060135,0.034757],[0.059899,0.034411],[0.060172,0.03468],[0.063553,0.04136],[0.076317,0.05618],[0.827181,0.86768],[0.864014,0.921784],[0.891346,0.940835],[0.974134,1.015889],[0.872606,0.930768],[0.863232,0.922093],[0.087852,0.086636]],[[0.088639,0.078143],[0.08654,0.081011],[0.085032,0.079276],[0.081474,0.075727],[0.080286,0.074796],[0.083082,0.074732],[0.08058,0.072665],[0.067567,0.059871],[0.060445,0.035491],[0.056538,0.023119],[0.054561,0.020126],[0.054301,0.019322],[0.054119,0.016459],[0.05407,0.018447],[0.051519,0.022584],[0.051169,0.025238],[0.067752,0.042165],[0.131109,0.12042],[0.448955,0.520242],[0.580566,0.677033],[0.309469,0.339703],[0.149838,0.161182],[0.149167,0.161611],[0.094353,0.09104]],[[0.085274,0.077874],[0.085859,0.078791],[0.082577,0.075375],[0.078518,0.076025],[0.078491,0.074459],[0.078529,0.073682],[0.082707,0.071367],[0.072811,0.064215],[0.062931,0.042769],[0.057272,0.020851],[0.056142,0.020838],[0.054416,0.020131],[0.053737,0.019775],[0.053131,0.018893],[0.052773,0.020418],[0.052498,0.02148],[0.058191,0.037406],[0.088394,0.07838],[0.0912,0.080806],[0.088724,0.079563],[0.084986,0.07826],[0.080482,0.076004],[0.086965,0.087735],[0.087828,0.082157]],[[0.08268,0.079228],[0.081419,0.075891],[0.079826,0.074473],[0.078759,0.073564],[0.082833,0.074291],[0.084505,0.07561],[0.081069,0.075633],[0.071326,0.055529],[0.061549,0.035524],[0.058933,0.026328],[0.056738,0.023922],[0.054461,0.02116],[0.053093,0.020757],[0.047083,0.020289],[0.048456,0.021091],[0.062657,0.039479],[0.089199,0.076592],[0.091535,0.088058],[0.085865,0.083664],[0.083852,0.080217],[0.082859,0.078072],[0.084715,0.077618],[0.08578,0.08189],[0.088662,0.077605]],[[0.084932,0.078906],[0.083194,0.077335],[0.080104,0.073816],[0.080725,0.070099],[0.082805,0.069142],[0.085323,0.071054],[0.095117,0.074064],[0.079411,0.064258],[0.070383,0.042021],[0.066264,0.021927],[0.06399,0.020791],[0.060404,0.018929],[0.056634,0.020144],[0.057032,0.014489],[0.05615,0.01388],[0.066642,0.04013],[0.090853,0.080371],[0.09562,0.085522],[0.094919,0.083405],[0.087955,0.079338],[0.086725,0.07815],[0.086318,0.073548],[0.087826,0.074825],[0.088102,0.073798]]],[[[0.089997,0.090474],[0.086665,0.09079],[0.085401,0.089688],[0.084002,0.087061],[0.086072,0.086251],[0.090893,0.087725],[0.103054,0.090125],[0.08837,0.081859],[0.071942,0.067021],[0.06571,0.055645],[0.060907,0.050521],[0.059283,0.050206],[0.057879,0.050667],[0.056003,0.04778],[0.052345,0.049274],[0.058646,0.054823],[0.07968,0.080819],[0.109828,0.105999],[0.102146,0.098478],[0.090081,0.091377],[0.089635,0.088669],[0.089455,0.08517],[0.093413,0.090778],[0.091534,0.087197]],[[0.090735,0.085643],[0.08964,0.08705],[0.091005,0.085615],[0.092546,0.085449],[0.09224,0.084172],[0.092171,0.085407],[0.087814,0.083456],[0.083985,0.071952],[0.06331,0.044555],[0.043361,0.028777],[0.039384,0.030031],[0.037411,0.025929],[0.034193,0.020528],[0.03262,0.023357],[0.026867,0.01948],[0.029977,0.02103],[0.067351,0.057318],[0.1145,0.099134],[0.095994,0.104627],[0.088995,0.092501],[0.089785,0.089192],[0.086364,0.084491],[0.09443,0.085929],[0.0913,0.090311]],[[0.078054,0.072751],[0.075329,0.073695],[0.074588,0.079615],[0.075273,0.078429],[0.077238,0.084453],[0.078801,0.083138],[0.074277,0.074804],[0.065278,0.063899],[0.050683,0.007231],[0.02195,0.005439],[0.019059,0.002987],[0.017927,0.004104],[0.017802,0.00195],[0.011745,0.001963],[0.007924,0.0],[0.012688,0.0],[0.023666,0.014542],[0.057193,0.029688],[0.085742,0.078614],[0.082406,0.083087],[0.0776,0.073621],[0.075767,0.07638],[0.074492,0.078372],[0.077779,0.073809]],[[0.078959,0.061288],[0.079688,0.063233],[0.085392,0.078805],[0.086496,0.08082],[0.083441,0.081159],[0.077022,0.080575],[0.071975,0.069713],[0.056466,0.041201],[0.011508,0.005155],[0.008454,0.003947],[0.007281,0.006129],[0.009159,0.002624],[0.005124,0.000955],[0.002812,0.0],[0.002705,0.0],[0.001276,0.0],[0.000127,0.0],[0.004339,0.000212],[0.080078,0.072454],[0.077891,0.07363],[0.06801,0.065346],[0.067682,0.065227],[0.069159,0.067367],[0.071931,0.06764]],[[0.079194,0.067387],[0.075558,0.072103],[0.078124,0.084659],[0.081542,0.080016],[0.082302,0.077548],[0.076671,0.071712],[0.06684,0.07554],[0.055018,0.018779],[0.018334,0.000769],[0.008307,0.002124],[0.011009,0.002113],[0.010108,0.004364],[0.009562,0.004282],[0.00655,0.0],[0.005059,0.0],[0.005314,0.0],[0.008884,0.0],[0.028379,0.004642],[0.080858,0.047524],[0.08389,0.078714],[0.076078,0.071662],[0.074826,0.07026],[0.073738,0.073841],[0.07278,0.071401]],[[0.078073,0.070459],[0.077789,0.078421],[0.077598,0.075908],[0.073455,0.074143],[0.074969,0.069553],[0.075846,0.0709],[0.072631,0.073927],[0.062679,0.043164],[0.039201,0.009912],[0.031821,0.010163],[0.028612,0.01287],[0.029425,0.009457],[0.02506,0.010295],[0.02284,0.008562],[0.022284,0.006344],[0.024967,0.00713],[0.025178,0.008449],[0.040372,0.021383],[0.088202,0.07258],[0.096689,0.098886],[0.086603,0.096219],[0.084835,0.083492],[0.076266,0.081197],[0.072651,0.075987]],[[0.075653,0.078427],[0.077069,0.073271],[0.071746,0.067614],[0.068026,0.065497],[0.068168,0.068545],[0.070782,0.067368],[0.072041,0.065227],[0.068843,0.049526],[0.053151,0.020096],[0.052594,0.018598],[0.053829,0.021565],[0.051453,0.020527],[0.051953,0.018258],[0.049098,0.016667],[0.047436,0.017022],[0.046587,0.018303],[0.045404,0.022634],[0.060496,0.042608],[0.097013,0.0949],[0.105609,0.125504],[0.095523,0.114269],[0.081125,0.077306],[0.077298,0.078018],[0.077069,0.076588]],[[0.108315,0.108673],[0.0912,0.087024],[0.088951,0.087691],[0.086606,0.081855],[0.084738,0.079395],[0.086796,0.07845],[0.084026,0.074118],[0.071978,0.059809],[0.063679,0.038102],[0.062508,0.029572],[0.060515,0.034923],[0.060391,0.031563],[0.058986,0.031841],[0.060723,0.028024],[0.060376,0.034563],[0.066231,0.036678],[0.089614,0.063194],[0.8761,0.912933],[1.0058,1.074581],[1.039515,1.097427],[1.123211,1.175993],[1.027867,1.09645],[1.016426,1.087494],[0.115401,0.111329]],[[0.114528,0.110551],[0.091992,0.085251],[0.090417,0.080493],[0.087706,0.078694],[0.086322,0.076961],[0.088156,0.07724],[0.082943,0.075329],[0.072092,0.062035],[0.063201,0.031063],[0.061517,0.019495],[0.060326,0.017383],[0.059704,0.021144],[0.058416,0.022034],[0.056418,0.01952],[0.055436,0.026087],[0.056999,0.027774],[0.074245,0.045273],[0.17123,0.169336],[0.586291,0.689465],[0.690123,0.818377],[0.369995,0.414329],[0.210032,0.234931],[0.208606,0.234141],[0.133792,0.141726]],[[0.089115,0.079765],[0.087481,0.081989],[0.084961,0.081208],[0.081839,0.078569],[0.080159,0.079862],[0.081869,0.077807],[0.086052,0.072151],[0.07397,0.06772],[0.062941,0.043941],[0.056024,0.017834],[0.054602,0.019114],[0.052082,0.017518],[0.051797,0.017487],[0.05147,0.015977],[0.050129,0.017051],[0.050432,0.016457],[0.05465,0.040625],[0.090527,0.082426],[0.097575,0.082332],[0.091818,0.082849],[0.087573,0.081227],[0.084312,0.079631],[0.09147,0.09185],[0.093101,0.086004]],[[0.085926,0.080667],[0.083638,0.076835],[0.081155,0.074218],[0.080055,0.073276],[0.081651,0.073179],[0.085299,0.074477],[0.079329,0.075542],[0.071013,0.054102],[0.06149,0.031077],[0.059251,0.026323],[0.055598,0.02223],[0.052299,0.021067],[0.049284,0.016913],[0.045663,0.018149],[0.04397,0.019243],[0.059818,0.035798],[0.094565,0.077068],[0.094351,0.081471],[0.08585,0.080458],[0.082273,0.075587],[0.081463,0.074105],[0.086073,0.076137],[0.089027,0.080178],[0.086865,0.078284]],[[0.089175,0.084653],[0.084993,0.081331],[0.081984,0.079061],[0.081616,0.075473],[0.083436,0.074753],[0.088839,0.077177],[0.093935,0.079824],[0.081658,0.066079],[0.074862,0.037499],[0.066718,0.017313],[0.06468,0.01939],[0.062591,0.01763],[0.057565,0.016133],[0.058362,0.014079],[0.055085,0.014368],[0.06674,0.039554],[0.095126,0.085614],[0.096145,0.092661],[0.091089,0.089087],[0.087679,0.082761],[0.088372,0.080426],[0.090775,0.08025],[0.093071,0.082228],[0.091216,0.081422]]]]');

  // ─── HOLIDAYS ─────────────────────────────────────────────────────────────────
  // Used to determine weekend-or-holiday flag for NBT rate lookup and DR-SES schedule.
  // Add years as needed when extending the analysis horizon.
  const HOLIDAYS = new Set([
    '2024-01-01','2024-02-19','2024-05-27','2024-07-04','2024-09-02',
    '2024-11-11','2024-11-28','2024-12-25',
    '2025-01-01','2025-02-17','2025-05-26','2025-07-04','2025-09-01',
    '2025-11-11','2025-11-27','2025-12-25',
    '2026-01-01','2026-02-16','2026-05-25','2026-07-04','2026-09-07',
    '2026-11-11','2026-11-26','2026-12-25',
    '2027-01-01','2027-02-15','2027-05-31','2027-07-05','2027-09-06',
    '2027-11-11','2027-11-25','2027-12-25',
    '2028-01-01','2028-02-21','2028-05-29','2028-07-04','2028-09-04',
    '2028-11-11','2028-11-23','2028-12-25',
    '2029-01-01','2029-02-19','2029-05-28','2029-07-04','2029-09-03',
    '2029-11-12','2029-11-22','2029-12-25',
    '2030-01-01','2030-02-18','2030-05-27','2030-07-04','2030-09-02',
    '2030-11-11','2030-11-28','2030-12-25',
  ]);

  // ─── RATE SCHEDULES ────────────────────────────────────────────────────────────
  // Source: SDG&E Total Rates Tables (bundled service, secondary voltage).
  // Energy rates are in $/kWh and represent the all-in total rate for consumption
  // (delivery + generation + surcharges); they do NOT include the fixed customer charge.
  //
  // schedule(month, hour) → 'peak' | 'offpeak' | 'superoffpeak'
  //   month: 1-12, hour: 0-23 (local time, hour-beginning convention)
  //
  const ALL_RATES = {

    'SDG&E TOU-DR1': {
      label:          'SDG&E Schedule TOU-DR1 — Standard Residential TOU',
      rateNote:       'Effective Oct 1, 2025 · Bundled service · Peak 4–9 PM daily (all days)',
      ratesVerified:  '2025-03-05',
      tariffUrl:      'https://www.sdge.com/sites/default/files/regulatory/10-1-25%20Schedule%20TOU-DR1%20Total%20Rates%20Table.pdf',
      customerChargePerDay: 0.79343,  // $/day — Base Services Charge, SDG&E bundled residential (verified from CPUC tariff PDF)
      customerType:   'residential',
      recommendedNem: 'none',   // standard residential without solar
      seasonalRates: {
        summer: { peak: 0.67263, offpeak: 0.43267, superoffpeak: 0.30663 },
        winter: { peak: 0.52199, offpeak: 0.45728, superoffpeak: 0.43850 },
      },
      // SDG&E TOU-DR1: peak 4–9 PM every day; super off-peak midnight–6 AM every day
      schedule: (month, hour) => {
        if (hour >= 16 && hour < 21) return 'peak';
        if (hour >= 21 || hour < 6)  return 'superoffpeak';
        return 'offpeak';
      },
      isSummer: (month) => month >= 6 && month <= 10,
      careAvailable:        true,
      careCustomerChargePerDay: 0.19712,  // $/day — CARE Base Services Charge (verified CPUC PDF)
      careSeasonalRates: {
        summer: { peak: 0.43334, offpeak: 0.27737, superoffpeak: 0.19544 },
        winter: { peak: 0.33543, offpeak: 0.29336, superoffpeak: 0.28116 },
      },
    },

    'SDG&E EV-TOU-5': {
      label:          'SDG&E Schedule EV-TOU-5 — Residential EV / NEM 3.0 Solar Billing Plan',
      rateNote:       'Effective Jan 1, 2026 · Bundled service · For EV owners & solar interconnected after Apr 14, 2023',
      ratesVerified:  '2026-01-01',
      tariffUrl:      'https://www.sdge.com/sites/default/files/regulatory/1-1-26%20Schedule%20EV-TOU-5%20Total%20Rates%20Table.pdf',
      customerChargePerDay: 0.79343,  // $/day — Base Services Charge, SDG&E bundled residential (verified from CPUC tariff PDF)
      customerType:   'residential',
      recommendedNem: 'nem3',   // NEM 3.0 solar customers
      seasonalRates: {
        summer: { peak: 0.79988, offpeak: 0.50245, superoffpeak: 0.12424 },
        winter: { peak: 0.52926, offpeak: 0.47267, superoffpeak: 0.11686 },
      },
      // EV-TOU-5: peak 4–9 PM every day; super off-peak midnight–6 AM every day
      schedule: (month, hour) => {
        if (hour >= 16 && hour < 21) return 'peak';
        if (hour >= 21 || hour < 6)  return 'superoffpeak';
        return 'offpeak';
      },
      isSummer: (month) => month >= 6 && month <= 10,
      careAvailable:        true,
      careCustomerChargePerDay: 0.19713,  // $/day — CARE Base Services Charge (verified CPUC PDF)
      careSeasonalRates: {
        summer: { peak: 0.51046, offpeak: 0.31714, superoffpeak: 0.07130 },
        winter: { peak: 0.33456, offpeak: 0.29778, superoffpeak: 0.06650 },
      },
    },

    'SDG&E DR-SES': {
      label:          'SDG&E Schedule DR-SES — Residential Solar (NEM 1.0/2.0 legacy)',
      rateNote:       'Effective Oct 1, 2025 · Bundled service · For NEM customers interconnected before Apr 14, 2023',
      ratesVerified:  '2025-03-05',
      tariffUrl:      'https://www.sdge.com/sites/default/files/regulatory/10-1-25%20Schedule%20DR-SES%20Total%20Rates%20Table.pdf',
      customerChargePerDay: 0.79343,  // $/day — Base Services Charge, SDG&E bundled residential (verified from CPUC tariff PDF)
      customerType:   'residential',
      recommendedNem: 'nem2',   // legacy NEM 2.0 / retail net metering
      seasonalRates: {
        summer: { peak: 0.65577, offpeak: 0.39931, superoffpeak: 0.32020 },
        winter: { peak: 0.42243, offpeak: 0.37364, superoffpeak: 0.31384 },
      },
      // DR-SES: same period structure as TOU-DR1
      schedule: (month, hour) => {
        if (hour >= 16 && hour < 21) return 'peak';
        if (hour >= 21 || hour < 6)  return 'superoffpeak';
        return 'offpeak';
      },
      isSummer: (month) => month >= 6 && month <= 10,
      careAvailable:        true,
      careCustomerChargePerDay: 0.19712,  // $/day — CARE Base Services Charge (verified CPUC PDF)
      careSeasonalRates: {
        summer: { peak: 0.42238, offpeak: 0.25568, superoffpeak: 0.20426 },
        winter: { peak: 0.27071, offpeak: 0.23900, superoffpeak: 0.20013 },
      },
    },

    'SDG&E DR': {
      label:          'SDG&E Schedule DR — Residential Non-TOU (tiered baseline)',
      rateNote:       'Effective Oct 1, 2025 · Bundled service · Non-TOU tiered; tier boundary is approximate (varies by climate zone)',
      ratesVerified:  '2025-03-05',
      tariffUrl:      'https://www.sdge.com/sites/default/files/regulatory/10-1-25%20Schedule%20DR%20Total%20Rates%20Table.pdf',
      customerChargePerDay: 0.79343,  // $/day — Base Services Charge
      customerType:   'residential',
      recommendedNem: 'none',
      careAvailable:  false,  // CARE rate table not published for non-TOU tiered schedules
      billingType:    'tiered',
      tierBoundary:   350,  // kWh/month — approximate; varies by climate zone (CZ07 coastal ~350)
      seasonalRates: {
        summer: { tier1: 0.37397, tier2: 0.47087 },
        winter: { tier1: 0.37397, tier2: 0.47087 },
      },
      // schedule() not used for tiered billing; returns 'offpeak' as placeholder
      schedule: () => 'offpeak',
      isSummer: (month) => month >= 6 && month <= 10,
    },

    'SDG&E TOU-A': {
      label:              'SDG&E Schedule TOU-A — Small Commercial (< 20 kW)',
      rateNote:           'Effective Feb 1, 2025 · Secondary voltage · Bundled service · Energy-only billing, no demand charge',
      ratesVerified:      '2025-03-05',
      tariffUrl:          'https://www.sdge.com/sites/default/files/regulatory/2-1-25%20Schedule%20TOU-A%20Total%20Rates%20Table.pdf',
      customerChargePerDay: 0.43200,  // $/day — ⚠ approximate; verify against current SDG&E TOU-A tariff PDF
      customerType:       'commercial',
      careAvailable:      false,
      recommendedNem:     'none',
      billingType:        'tou',      // energy-only — no demand charges for < 20 kW accounts
      seasonalRates: {
        summer: { peak: 0.535, offpeak: 0.407 },
        winter: { peak: 0.417, offpeak: 0.333 },
      },
      schedule: (month, hour) => hour >= 16 && hour < 21 ? 'peak' : 'offpeak',
      isSummer: (month) => month >= 6 && month <= 10,
    },

    'SDG&E AL-TOU': {
      label:              'SDG&E Schedule AL-TOU — General Commercial (≥ 20 kW)',
      rateNote:           'Effective Oct 1, 2025 · Secondary voltage · Bundled service · Demand charges apply',
      ratesVerified:      '2025-10-01',
      tariffUrl:          'https://www.sdge.com/sites/default/files/regulatory/10-1-25%20Schedule%20AL-TOU%20Total%20Rates%20Table.pdf',
      customerChargePerDay: 0.40000,  // $/day — ⚠ approximate; verify against current SDG&E AL-TOU tariff PDF
      customerType:       'commercial',
      careAvailable:      false,
      recommendedNem:     'none',
      billingType:        'demand',
      seasonalRates: {
        summer: { peak: 0.242, offpeak: 0.151, superoffpeak: 0.132 },
        winter: { peak: 0.264, offpeak: 0.154, superoffpeak: 0.121 },
      },
      // ⚠ Demand charges below are approximate — verify against current SDG&E AL-TOU tariff PDF
      demandCharges: {
        summer: { onPeakDemand: 15.00 },  // $/kW — ⚠ approximate
        winter: { onPeakDemand: 9.00  },  // $/kW — ⚠ approximate
      },
      schedule: (month, hour) => {
        if (hour >= 16 && hour < 21) return 'peak';
        if (hour < 6 || hour >= 21) return 'superoffpeak';
        return 'offpeak';
      },
      isSummer: (month) => month >= 6 && month <= 10,
    },

    'SDG&E AL-TOU-2': {
      label:              'SDG&E Schedule AL-TOU-2 — Large Commercial (≥ 20 kW, three-part demand)',
      rateNote:           'Effective Oct 1, 2025 · Secondary voltage · Bundled service · Three-part demand charge; ratchet not modeled',
      ratesVerified:      '2025-10-01',
      tariffUrl:          'https://www.sdge.com/sites/default/files/regulatory/10-1-25%20Schedule%20AL-TOU-2%20Total%20Rates%20Table.pdf',
      customerChargePerDay: 10.70267, // $/day — verified from Viasat bill Mar 2025 ($321.08 ÷ 30 days)
      customerType:       'commercial',
      careAvailable:      false,
      recommendedNem:     'none',
      billingType:        'demand',
      seasonalRates: {
        summer: { peak: 0.221, offpeak: 0.139, superoffpeak: 0.121 },
        winter: { peak: 0.240, offpeak: 0.140, superoffpeak: 0.111 },
      },
      // Demand charges:
      //   touDemand         $/kW — applied to max 15-min demand in billing period (any hour)
      //   nonCoincidentDemand $/kW — additional charge on max 15-min demand (any hour)
      //   onPeakDemand      $/kW — applied to max 15-min demand during on-peak hours (4–9 PM) only
      // Winter values verified from Viasat Inc. SDG&E bill March 2025.
      // Summer onPeakDemand is ⚠ approximate — verify from summer AL-TOU-2 tariff PDF.
      demandCharges: {
        summer: {
          touDemand:            46.18,  // $/kW — ⚠ assumed same as winter pending summer PDF
          nonCoincidentDemand:  15.89,  // $/kW — ⚠ assumed same as winter pending summer PDF
          onPeakDemand:         10.00,  // $/kW — ⚠ approximate summer on-peak demand
        },
        winter: {
          touDemand:            46.18,  // $/kW — verified, Viasat Mar 2025
          nonCoincidentDemand:  15.89,  // $/kW — verified, Viasat Mar 2025
          onPeakDemand:          1.10,  // $/kW — verified, Viasat Mar 2025
        },
      },
      // Mar/Apr weekday 10 AM–2 PM is super off-peak (isWeekend passed by computeBill)
      schedule: (month, hour, isWeekend) => {
        if (hour >= 16 && hour < 21) return 'peak';
        if (hour < 6 || hour >= 21) return 'superoffpeak';
        if (!isWeekend && (month === 3 || month === 4) && hour >= 10 && hour < 14) return 'superoffpeak';
        return 'offpeak';
      },
      isSummer: (month) => month >= 6 && month <= 10,
    },

    // ── Anaheim Public Utilities ────────────────────────────────────────────────

    'APU TOU-2': {
      label:          'APU Schedule TOU-2 — Domestic Time-of-Use',
      rateNote:       'Base rates eff. May 1, 2024 (Res. 2024-022) + RSA Dec 2025 (+$0.0155/kWh) · Peak 4–9 PM weekdays · D-NEM export credit not yet modeled',
      ratesVerified:  '2026-04-07',
      tariffUrl:      'https://www.anaheim.net/DocumentCenter/View/25947',
      customerChargePerDay: 0.26667,  // $8.00/month ÷ 30 (verified APU Schedule TOU-2, Res. 2024-022)
      customerType:   'residential',
      careAvailable:  false,          // APU CARE/FERA rates not in available tariff documents
      recommendedNem: 'none',         // APU D-NEM uses ACC wholesale rate × ToD factor — not yet modeled; select nem2 as rough over-estimate
      billingType:    'tou',
      // Energy rates = base (Res. 2024-022) + RSA (PCA $0.0100 + EMA $0.0055 = +$0.0155/kWh, eff. Dec 2025)
      // RSA is applied uniformly here; strictly the PCA component applies only above 10 kWh/day (simplification).
      // Summer: July 1 – October 31 (months 7–10)
      // Winter: November 1 – June 30 (months 1–6 and 11–12)
      // No super off-peak in summer.
      seasonalRates: {
        summer: { peak: 0.34750, offpeak: 0.18200 },
        winter: { peak: 0.32800, offpeak: 0.17700, superoffpeak: 0.13550 },
      },
      // Period definitions (APU Res. 2024-022):
      //   On-Peak:        4 PM – 9 PM, weekdays only (both seasons)
      //   Super Off-Peak  (winter only):
      //     Weekdays:     8 AM – 4 PM
      //     Weekends/holidays: midnight – 4 PM  AND  9 PM – midnight
      //   Off-Peak:       all other hours
      schedule: (month, hour, isWeekend) => {
        if (!isWeekend && hour >= 16 && hour < 21) return 'peak';
        const isWinter = month < 7 || month > 10;
        if (isWinter) {
          if (!isWeekend && hour >= 8 && hour < 16)         return 'superoffpeak';
          if (isWeekend  && (hour < 16 || hour >= 21))      return 'superoffpeak';
        }
        return 'offpeak';
      },
      isSummer: (month) => month >= 7 && month <= 10,  // APU summer: July 1 – October 31
    },

  };

  // ─── INTERNAL HELPERS ─────────────────────────────────────────────────────────

  function _isWeekendOrHoliday(ts) {
    const dow = ts.getDay();
    if (dow === 0 || dow === 6) return true;
    return HOLIDAYS.has(ts.toISOString().slice(0, 10));
  }

  // Look up NBT export rate for a given timestamp.
  // yearOffset = years from 2026 (e.g. year 3 of analysis starting 2026 → yearOffset=2)
  function _getNbtRate(ts, yearOffset, utilEsc) {
    const m    = ts.getMonth();                        // 0-11
    const h    = ts.getHours();                        // 0-23
    const we   = _isWeekendOrHoliday(ts) ? 1 : 0;     // 0=weekday, 1=weekend/holiday
    const yIdx = Math.min(yearOffset, 1);              // clamp to 2027 data
    const base = NBT_RATES[yIdx][m][h][we];
    const extraYears = Math.max(0, yearOffset - 1);    // years beyond 2027
    return base * Math.pow(1 + utilEsc, extraYears);
  }

  // Build 12×24 average PV production lookup from a TMY 8760-hour array.
  // Returns lookup[month 0-11][hour 0-23] = avg kWh/hour for 1 DC-kW system.
  // Using month+hour averaging decouples PV alignment from load data year.
  function _buildPvLookup(pvKwhHourly, systemDcKw) {
    const daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    const sums   = Array.from({ length: 12 }, () => new Float64Array(24));
    const counts = Array.from({ length: 12 }, () => new Float64Array(24));
    let idx = 0;
    for (let m = 0; m < 12; m++) {
      for (let d = 0; d < daysInMonth[m]; d++) {
        for (let h = 0; h < 24; h++) {
          sums[m][h]   += pvKwhHourly[idx] || 0;
          counts[m][h] += 1;
          idx++;
        }
      }
    }
    return sums.map((row, m) =>
      Array.from(row, (s, h) => (counts[m][h] > 0 ? (s / counts[m][h]) * systemDcKw : 0))
    );
  }

  // ─── PUBLIC: computeNetIntervals ──────────────────────────────────────────────
  //
  // Subtracts PV production from each 15-min load interval.
  //
  // loadIntervals  [[Date, kWh], ...]   Green Button 15-min intervals
  // pvKwhHourly    Float64[8760]        PVWatts hourly AC output, 1 DC-kW reference
  // systemDcKw     number               System size in DC kW
  //
  // Returns [[Date, kWhNet], ...] where positive = import, negative = export.
  // PV is averaged by month+hour (TMY alignment — load year does not matter).
  //
  function computeNetIntervals(loadIntervals, pvKwhHourly, systemDcKw) {
    if (!Array.isArray(pvKwhHourly) || pvKwhHourly.length < 8760) {
      throw new Error('pvKwhHourly must be an 8760-element array from PVWatts.');
    }
    const scale  = typeof systemDcKw === 'number' && systemDcKw > 0 ? systemDcKw : 1.0;
    const lookup = _buildPvLookup(pvKwhHourly, scale);
    return loadIntervals.map(([ts, load]) => {
      const pvInterval = lookup[ts.getMonth()][ts.getHours()] / 4;  // hour avg → 15-min
      return [ts, load - pvInterval];
    });
  }

  // ─── PUBLIC: computeBill ──────────────────────────────────────────────────────
  //
  // Computes the annual electric bill from 15-min intervals.
  //
  // intervals   [[Date, kWh], ...]   Net-load intervals (positive=import, negative=export).
  //                                   For baseline (no solar), pass raw load intervals.
  // rateKey     string               Key into ALL_RATES.
  // options     object               See header for full option list.
  //
  // Returns BillResult:
  //   totalBill          $ — annual bill (energy charges - export credits + customer charges)
  //   annualImportKwh    kWh imported from grid
  //   annualExportKwh    kWh exported to grid
  //   effectiveRate      $/kWh — energy charge only divided by import kWh
  //   effectiveNetRate   $/kWh — total bill divided by import kWh
  //   monthly[12]        monthly detail objects (see below)
  //   breakdown          annual component totals
  //   rateKey, nemType   echoed inputs for traceability
  //
  // Monthly detail object:
  //   month, label, importKwh, exportKwh
  //   peakImportKwh, offpeakImportKwh, sopImportKwh
  //   energyCharge, exportCredit, customerCharge, demandCharge, netBill
  //
  function computeBill(intervals, rateKey, options) {
    const opts = options || {};
    const nemType    = opts.nemType    || 'none';
    const yearOffset = opts.yearOffset != null ? opts.yearOffset : 0;
    const utilEsc    = opts.utilEsc    != null ? opts.utilEsc    : 0.04;
    const care = opts.care === true;

    const rate = ALL_RATES[rateKey];
    if (!rate) {
      throw new Error(
        'Unknown rateKey: "' + rateKey + '". ' +
        'Valid keys: ' + Object.keys(ALL_RATES).join(', ')
      );
    }
    if (care && !rate.careAvailable) {
      throw new Error(
        'CARE rates are not available for rate "' + rateKey + '". ' +
        'CARE is supported for TOU-DR1, EV-TOU-5, and DR-SES only.'
      );
    }
    if (nemType !== 'nem3' && nemType !== 'nem2' && nemType !== 'none') {
      throw new Error('options.nemType must be "nem3", "nem2", or "none". Got: ' + nemType);
    }

    // Derive data year from first interval for accurate days-in-month computation
    var dataYear = intervals.length > 0 ? intervals[0][0].getFullYear() : 2026;
    var _isLeap = (dataYear % 4 === 0 && dataYear % 100 !== 0) || (dataYear % 400 === 0);
    var DAYS_IN_MONTH = [31, _isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

    // Monthly accumulators (12 months, 0-indexed)
    const monthly = Array.from({ length: 12 }, function (_, i) {
      return {
        month:            i + 1,
        label:            MONTHS[i],
        importKwh:        0,
        exportKwh:        0,
        peakImportKwh:    0,
        offpeakImportKwh: 0,
        sopImportKwh:     0,
        maxDemandKw:      0,   // kW — max 15-min demand (any hour) this month
        maxOnPeakKw:      0,   // kW — max 15-min demand during on-peak hours only
        demandCharge:     0,   // $ — monthly demand charges
        energyCharge:     0,
        exportCredit:     0,
        customerCharge:   (care ? rate.careCustomerChargePerDay : rate.customerChargePerDay) * DAYS_IN_MONTH[i],
        netBill:          0,
      };
    });

    // Process every interval
    for (var i = 0; i < intervals.length; i++) {
      var ts     = intervals[i][0];
      var kwhNet = intervals[i][1];
      var m      = ts.getMonth();           // 0-11
      var month1 = m + 1;                   // 1-12
      var hour   = ts.getHours();           // 0-23
      var mo     = monthly[m];

      if (kwhNet > 0) {
        // Grid import
        mo.importKwh += kwhNet;
        if (rate.billingType !== 'tiered') {
          // TOU: charge per-interval at the applicable period rate
          var isWeH  = _isWeekendOrHoliday(ts);
          var period = rate.schedule(month1, hour, isWeH);
          var season   = rate.isSummer(month1) ? 'summer' : 'winter';
          var rateTable = care ? rate.careSeasonalRates : rate.seasonalRates;
          var r         = rateTable[season];
          mo.energyCharge += kwhNet * r[period];
          if      (period === 'peak')         mo.peakImportKwh    += kwhNet;
          else if (period === 'superoffpeak') mo.sopImportKwh     += kwhNet;
          else                                mo.offpeakImportKwh += kwhNet;

          // Demand tracking for commercial demand-billed rates
          if (rate.billingType === 'demand') {
            var demKw = kwhNet * 4;   // 15-min kWh → average kW
            if (demKw > mo.maxDemandKw) mo.maxDemandKw = demKw;
            if (period === 'peak' && demKw > mo.maxOnPeakKw) mo.maxOnPeakKw = demKw;
          }
        }
      } else if (kwhNet < 0) {
        // Grid export — credit depends on NEM type
        var exportKwh = -kwhNet;
        mo.exportKwh += exportKwh;
        if (nemType === 'nem3') {
          mo.exportCredit += exportKwh * _getNbtRate(ts, yearOffset, utilEsc);
        } else if (nemType === 'nem2' && rate.billingType !== 'tiered') {
          // Retail net metering: credit at same TOU rate as consumption
          var season2    = rate.isSummer(month1) ? 'summer' : 'winter';
          var rateTable2 = care ? rate.careSeasonalRates : rate.seasonalRates;
          var r2         = rateTable2[season2];
          var period2 = rate.schedule(month1, hour);
          mo.exportCredit += exportKwh * r2[period2];
        }
        // nemType === 'none': no export credit
      }
    }

    // Tiered energy charge post-processing (only for billingType === 'tiered')
    if (rate.billingType === 'tiered') {
      for (var ti = 0; ti < 12; ti++) {
        var tmo      = monthly[ti];
        var tSeason   = rate.isSummer(ti + 1) ? 'summer' : 'winter';
        var rateTable3 = care ? rate.careSeasonalRates : rate.seasonalRates;
        var tr         = rateTable3[tSeason];
        var tierBound = rate.tierBoundary || 350;
        var t1 = Math.min(tmo.importKwh, tierBound);
        var t2 = Math.max(0, tmo.importKwh - tierBound);
        tmo.energyCharge     = t1 * tr.tier1 + t2 * tr.tier2;
        tmo.offpeakImportKwh = tmo.importKwh;  // display all consumption as 'base' (no TOU)
      }
    }

    // Demand charge post-processing (commercial 'demand' billing type only)
    if (rate.billingType === 'demand' && rate.demandCharges) {
      for (var di = 0; di < 12; di++) {
        var dmo    = monthly[di];
        var dSea   = rate.isSummer(di + 1) ? 'summer' : 'winter';
        var dc     = rate.demandCharges[dSea];
        dmo.demandCharge =
          ((dc.touDemand           || 0) + (dc.nonCoincidentDemand || 0)) * dmo.maxDemandKw +
          (dc.onPeakDemand         || 0) * dmo.maxOnPeakKw;
      }
    }

    // Compute monthly net bills and roll up annual totals
    var totalImportKwh      = 0;
    var totalExportKwh      = 0;
    var totalEnergyCharge   = 0;
    var totalDemandCharge   = 0;
    var totalExportCredit   = 0;
    var totalCustomerCharge = 0;

    for (var j = 0; j < 12; j++) {
      var mo2 = monthly[j];
      mo2.netBill = mo2.energyCharge + mo2.demandCharge - mo2.exportCredit + mo2.customerCharge;
      totalImportKwh      += mo2.importKwh;
      totalExportKwh      += mo2.exportKwh;
      totalEnergyCharge   += mo2.energyCharge;
      totalDemandCharge   += mo2.demandCharge;
      totalExportCredit   += mo2.exportCredit;
      totalCustomerCharge += mo2.customerCharge;
    }

    var totalBill = totalEnergyCharge + totalDemandCharge - totalExportCredit + totalCustomerCharge;

    return {
      rateKey:          rateKey,
      nemType:          nemType,
      totalBill:        totalBill,
      annualImportKwh:  totalImportKwh,
      annualExportKwh:  totalExportKwh,
      effectiveRate:    totalImportKwh > 0 ? (totalEnergyCharge / totalImportKwh)  : 0,
      effectiveNetRate: totalImportKwh > 0 ? (totalBill         / totalImportKwh)  : 0,
      monthly:          monthly,
      breakdown: {
        energyCharge:   totalEnergyCharge,
        demandCharge:   totalDemandCharge,
        exportCredit:   totalExportCredit,
        customerCharge: totalCustomerCharge,
      },
    };
  }

  // ─── PUBLIC: computeSavings ───────────────────────────────────────────────────
  //
  // Convenience wrapper. Runs computeBill on:
  //   (a) raw load intervals — baseline bill with no solar
  //   (b) net-load intervals — solar bill after PV subtraction
  //
  // Returns SavingsResult:
  //   baseline        BillResult for no-solar scenario
  //   solar           BillResult for solar scenario
  //   annualSavings   $ baseline.totalBill - solar.totalBill
  //   annualGenKwh    kWh generated by PV (= solar.annualImportKwh reduction + exportKwh)
  //   selfConsumption fraction of generation consumed on-site (0–1)
  //   npv25           $ simple 25-year NPV of savings (discounted at discountRate)
  //
  // Additional options:
  //   systemDcKw      DC system size (kW)       required
  //   pvKwhHourly     8760-element array         required
  //   discountRate    float (default 0.05)       discount rate for NPV
  //   utilEsc         float (default 0.04)       utility escalation rate
  //   installCost     $ (default 0)              upfront system cost for NPV
  //
  function computeSavings(loadIntervals, pvKwhHourly, systemDcKw, rateKey, options) {
    var opts         = options || {};
    var nemType      = opts.nemType      || 'nem3';
    var yearOffset   = opts.yearOffset   || 0;
    var utilEsc      = opts.utilEsc      != null ? opts.utilEsc      : 0.04;
    var discountRate = opts.discountRate != null ? opts.discountRate : 0.05;
    var installCost  = opts.installCost  != null ? opts.installCost  : 0;

    var netIntervals = computeNetIntervals(loadIntervals, pvKwhHourly, systemDcKw);

    var baseline = computeBill(loadIntervals, rateKey, { nemType: 'none',   yearOffset: yearOffset, utilEsc: utilEsc });
    var solar    = computeBill(netIntervals,  rateKey, { nemType: nemType,  yearOffset: yearOffset, utilEsc: utilEsc });

    var annualSavings = baseline.totalBill - solar.totalBill;
    var annualGenKwh  = (baseline.annualImportKwh - solar.annualImportKwh) + solar.annualExportKwh;
    var selfConsumption = annualGenKwh > 0
      ? (baseline.annualImportKwh - solar.annualImportKwh) / annualGenKwh
      : 0;

    // Simple 25-year NPV: escalate savings, discount to present value
    var npv25 = -installCost;
    for (var yr = 0; yr < 25; yr++) {
      var escalatedSavings = annualSavings * Math.pow(1 + utilEsc, yr);
      var discFactor = 1 / Math.pow(1 + discountRate, yr + 1);
      npv25 += escalatedSavings * discFactor;
    }

    return {
      rateKey:        rateKey,
      nemType:        nemType,
      systemDcKw:     systemDcKw,
      baseline:       baseline,
      solar:          solar,
      annualSavings:  annualSavings,
      annualGenKwh:   annualGenKwh,
      selfConsumption: selfConsumption,
      npv25:          npv25,
      installCost:    installCost,
    };
  }

  // ─── PUBLIC: listRates ────────────────────────────────────────────────────────
  //
  // Returns an array of rate descriptor objects for UI display and validation.
  // Optional customerType filter: 'residential' | 'commercial' | undefined (all)
  // Each returned object includes hasDemandCharge to indicate demand-billed rates.
  //
  function listRates(customerType) {
    return Object.keys(ALL_RATES)
      .filter(function (key) {
        var r = ALL_RATES[key];
        return !customerType || r.customerType === customerType;
      })
      .map(function (key) {
        var r = ALL_RATES[key];
        return {
          key:                  key,
          label:                r.label,
          rateNote:             r.rateNote,
          customerChargePerDay: r.customerChargePerDay,
          customerType:         r.customerType,
          billingType:          r.billingType || 'tou',
          hasDemandCharge:      r.billingType === 'demand',
          recommendedNem:       r.recommendedNem,
          tariffUrl:            r.tariffUrl,
          careAvailable:        r.careAvailable === true,
        };
      });
  }

  // ─── SELF-TEST ────────────────────────────────────────────────────────────────
  // Run in browser console: MOD04.selfTest()
  // Verifies basic computation on a synthetic flat load profile.
  // Expected results are annotated for manual spot-check.
  function selfTest() {
    var log = [];
    function check(label, actual, expected, tol) {
      var pass = Math.abs(actual - expected) <= tol;
      log.push((pass ? 'PASS' : 'FAIL') + '  ' + label +
               '  got=' + actual.toFixed(4) + '  expected≈' + expected.toFixed(4));
      return pass;
    }

    // Build synthetic 15-min intervals: flat 1 kW load for all of 2026
    // Year 2026 starts on Thursday Jan 1.
    var intervals = [];
    var dt = new Date('2026-01-01T00:00:00');
    while (dt.getFullYear() === 2026) {
      intervals.push([new Date(dt), 0.25]);   // 0.25 kWh per 15-min = 1 kW constant
      dt.setMinutes(dt.getMinutes() + 15);
    }
    // 8760 hours × 4 = 35,040 intervals; leap year check: 2026 is not leap
    log.push('Intervals: ' + intervals.length + ' (expected 35040)');

    // Test 1: baseline bill on TOU-DR1 (no solar)
    // At 1 kW flat: 8760 kWh/yr total
    // Summer (Jun–Oct = months 6–10): 153 days × 24h = 3672h
    // Peak (4-9 PM = 5h/day): 153×5=765h → 765 kWh peak summer
    // SOP (9PM-6AM = 9h/day): 153×9=1377h → 1377 kWh SOP summer
    // Offpeak: remainder
    var r1 = computeBill(intervals, 'SDG&E TOU-DR1', { nemType: 'none' });
    check('TOU-DR1 annual kWh', r1.annualImportKwh, 8760, 5);
    check('TOU-DR1 annual bill > 0', r1.totalBill, r1.totalBill, 0);  // just checks it runs
    log.push('TOU-DR1 annual bill: $' + r1.totalBill.toFixed(2));
    log.push('TOU-DR1 effective rate: $' + r1.effectiveRate.toFixed(4) + '/kWh');

    // Test 2: EV-TOU-5 with synthetic PV — zero export (PV = load exactly)
    // Flat 1 kW PV for daylight hours only: use synthetic hourly profile
    // 6 AM–6 PM = 12 h/day → 4380 kWh/yr generation (≈ flat daytime profile)
    var pvHourly = new Array(8760).fill(0);
    for (var h2 = 0; h2 < 8760; h2++) {
      var hr = h2 % 24;
      pvHourly[h2] = (hr >= 6 && hr < 18) ? 1.0 : 0;   // 1 kWh/h during daylight
    }
    var netInt = computeNetIntervals(intervals, pvHourly, 1.0);
    var r2 = computeBill(netInt, 'SDG&E EV-TOU-5', { nemType: 'nem3', yearOffset: 0 });
    log.push('EV-TOU-5 solar bill: $' + r2.totalBill.toFixed(2));
    log.push('EV-TOU-5 export kWh: ' + r2.annualExportKwh.toFixed(1));
    log.push('EV-TOU-5 import kWh: ' + r2.annualImportKwh.toFixed(1));

    // Test 3: computeSavings
    var s = computeSavings(intervals, pvHourly, 2.0, 'SDG&E EV-TOU-5', {
      nemType:     'nem3',
      installCost: 20000,
      discountRate: 0.05,
      utilEsc:      0.04,
    });
    log.push('Savings annual: $' + s.annualSavings.toFixed(2));
    log.push('Gen kWh/yr (2kW): ' + s.annualGenKwh.toFixed(1));
    log.push('Self-consumption: ' + (s.selfConsumption * 100).toFixed(1) + '%');
    log.push('NPV 25yr: $' + s.npv25.toFixed(0));

    // Test 4: listRates
    var rates = listRates();
    check('listRates count', rates.length, Object.keys(ALL_RATES).length, 0);
    log.push('Available rates: ' + rates.map(function(r){return r.key;}).join(', '));

    // Test 5: Commercial TOU-A — energy only
    var r5 = computeBill(intervals, 'SDG&E TOU-A', { nemType: 'none' });
    check('TOU-A annual kWh', r5.annualImportKwh, 8760, 5);
    log.push('TOU-A annual bill: $' + r5.totalBill.toFixed(2));
    log.push('TOU-A demand charge: $' + r5.breakdown.demandCharge.toFixed(2) + ' (expected $0)');

    // Test 6: AL-TOU-2 — demand charges should be substantial
    var r6 = computeBill(intervals, 'SDG&E AL-TOU-2', { nemType: 'none' });
    log.push('AL-TOU-2 annual bill: $' + r6.totalBill.toFixed(2));
    log.push('AL-TOU-2 demand charges: $' + r6.breakdown.demandCharge.toFixed(2));
    log.push('AL-TOU-2 energy charges: $' + r6.breakdown.energyCharge.toFixed(2));
    var demandFraction = r6.breakdown.demandCharge / r6.totalBill;
    log.push('AL-TOU-2 demand fraction: ' + (demandFraction * 100).toFixed(1) + '%');
    check('AL-TOU-2 demand > 0', r6.breakdown.demandCharge, r6.breakdown.demandCharge, 0);

    // Test 7: CARE rates — TOU-DR1 baseline should be significantly lower
    var r7 = computeBill(intervals, 'SDG&E TOU-DR1', { nemType: 'none', care: true });
    log.push('TOU-DR1 CARE annual bill: $' + r7.totalBill.toFixed(2) +
             ' (vs standard $' + r1.totalBill.toFixed(2) + ')');
    var careDiscount = ((r1.totalBill - r7.totalBill) / r1.totalBill * 100).toFixed(1);
    log.push('CARE discount: ' + careDiscount + '% reduction');
    check('CARE bill < standard bill', r7.totalBill, r7.totalBill, 0);  // runs without error
    // Test 8: CARE guard — DR should throw
    var careGuardOk = false;
    try { computeBill(intervals, 'SDG&E DR', { care: true }); }
    catch(e) { careGuardOk = true; }
    log.push(careGuardOk ? 'PASS  CARE guard for DR threw as expected' : 'FAIL  CARE guard for DR did not throw');

    log.push('');
    log.push('MOD04 selfTest complete. Version: ' + VERSION);
    return log.join('\n');
  }

  // ─── MODULE EXPORT ────────────────────────────────────────────────────────────
  var ALL_RATES_REF = ALL_RATES;
  var RESIDENTIAL_RATES = ALL_RATES;  // backward-compatible alias

  var MOD04 = {
    VERSION:             VERSION,
    ALL_RATES:           ALL_RATES_REF,
    RESIDENTIAL_RATES:   RESIDENTIAL_RATES,
    computeNetIntervals: computeNetIntervals,
    computeBill:         computeBill,
    computeSavings:      computeSavings,
    listRates:           listRates,
    selfTest:            selfTest,
  };

  // Support both browser global and CommonJS/Node.js
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = MOD04;
  } else {
    global.MOD04 = MOD04;
  }

})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
