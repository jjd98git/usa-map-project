// ERCF (Enterprise Regulatory Capital Framework) Calculator
// Based on 12 CFR 1240.33 — FHFA Final Rule (Dec 2020, amended Sep 2024)
// Single-family performing loan credit risk capital

const ERCF = (function() {

  // ============================================================
  // Table 1: Conservative defaults for unknown/missing fields
  // ============================================================
  const DEFAULTS = {
    fico: 600, ltv: 300, dti: 42, purpose: 'C', occ: 'I',
    propType: '2-4', channel: 'T', amortType: 'ARM', origTerm: 12,
    loanAge: 500, doc: 'N', io: true, burnout: 'H', numUnits: '2'
  };

  // ============================================================
  // Table 2: Base Risk Weights — Performing Loans
  // Rows: FICO  <620,620-639,640-659,660-679,680-699,700-719,720-739,740-759,760-779,>=780
  // Cols: AdjMTMLTV <=30,>30-40,>40-50,>50-60,>60-70,>70-75,>75-80,>80-85,>85-90,>90-95,>95-100,>100-110,>110-120,>120
  // ============================================================
  const BASE_RW = [
    [.02,.10,.18,.34,.49,.72,1.05,1.29,1.59,1.88,2.18,2.47,2.75,3.17],
    [.02,.08,.14,.27,.39,.58,.84,1.02,1.27,1.51,1.78,2.08,2.37,2.82],
    [.02,.07,.12,.23,.34,.51,.73,.89,1.11,1.33,1.59,1.86,2.14,2.58],
    [.02,.06,.10,.20,.29,.44,.63,.78,.98,1.19,1.41,1.68,1.94,2.36],
    [.02,.06,.09,.18,.26,.38,.55,.67,.88,1.09,1.25,1.50,1.76,2.15],
    [.02,.05,.08,.15,.22,.33,.47,.57,.75,.94,1.10,1.34,1.58,1.94],
    [.02,.04,.06,.13,.19,.28,.41,.50,.66,.84,.96,1.18,1.40,1.72],
    [.02,.04,.05,.11,.16,.23,.33,.40,.54,.69,.80,.99,1.19,1.47],
    [.02,.03,.04,.09,.13,.19,.27,.32,.43,.56,.65,.82,.99,1.22],
    [.02,.03,.03,.07,.10,.14,.21,.25,.33,.43,.50,.63,.77,.96],
  ];

  const FICO_BREAKS = [620,640,660,680,700,720,740,760,780];
  const LTV_BREAKS  = [30,40,50,60,70,75,80,85,90,95,100,110,120];

  function ficoIdx(f) { for(let i=0;i<FICO_BREAKS.length;i++) if(f<FICO_BREAKS[i]) return i; return 9; }
  function ltvIdx(l)  { for(let i=0;i<LTV_BREAKS.length;i++) if(l<=LTV_BREAKS[i]) return i; return 13; }

  function baseRiskWeight(fico, ltv) {
    return BASE_RW[ficoIdx(fico)][ltvIdx(ltv)];
  }

  // ============================================================
  // Table 6: Risk Multipliers — Performing Loans
  // ============================================================

  function purposeMult(p) {
    const v = (p||'').toUpperCase();
    if (v.startsWith('C') || v.includes('CASH')) return 1.4;
    if (v.startsWith('N') || v.startsWith('R') || v.includes('RATE') || v.includes('NO CASH')) return 1.3;
    if (v.startsWith('P') || v.includes('PURCHASE')) return 1.0;
    return DEFAULTS.purpose === 'C' ? 1.4 : 1.0; // default to cash-out
  }

  function occMult(o) {
    const v = (o||'').toUpperCase();
    if (v.startsWith('I') || v.includes('INVEST')) return 1.2;
    return 1.0; // Owner + Second home
  }

  function propTypeMult(pt, units) {
    const v = (pt||'').toUpperCase();
    const u = parseInt(units) || 1;
    if (v === 'MH' || v.includes('MANUFACT')) return 1.3;
    if (v === 'CO' || v === 'CP' || v.includes('CONDO') || v.includes('COOP')) return 1.1;
    if (u >= 2 && u <= 4) return 1.4;
    return 1.0;
  }

  function channelMult(ch) {
    const v = (ch||'').toUpperCase().charAt(0);
    return (v==='B'||v==='C'||v==='T') ? 1.1 : 1.0;
  }

  function dtiMult(dti) {
    if (dti === null || dti === undefined || dti <= 0) return 1.2; // default 42% → >40% bucket
    if (dti <= 25) return 0.8;
    if (dti <= 40) return 1.0;
    return 1.2;
  }

  function productMult(amort, term) {
    const t = parseInt(term) || 360;
    const isARM = (amort||'').toUpperCase().includes('ARM');
    if (isARM) return 1.7;
    if (t <= 180) return 0.3;  // FRM15
    if (t <= 240) return 0.6;  // FRM20
    return 1.0; // FRM30
  }

  function loanAgeMult(age) {
    const a = parseInt(age) || 0;
    if (a <= 24) return 1.0;
    if (a <= 36) return 0.95;
    if (a <= 60) return 0.80;
    return 0.75;
  }

  function ioMult(io) {
    const v = (io||'').toUpperCase();
    return (v === 'Y' || v === 'TRUE' || v === true) ? 1.6 : 1.0;
  }

  function docMult(doc) {
    const v = (doc||'').toUpperCase().charAt(0);
    return (v === 'N' || v === 'L') ? 1.3 : 1.0; // None or Low
  }

  // ============================================================
  // Tables 7-11: MI Credit Enhancement Multipliers
  // ============================================================
  // Simplified: based on OLTV bucket and coverage level
  // For performing loans with non-cancelable MI (Table 7, most common)
  // Guide-level coverage (standard GSE requirements)
  function miCreditEnhancementMult(oltv, miPct, cancelable) {
    if (!miPct || miPct <= 0) return 1.0; // No MI

    // Determine OLTV bucket: 0=<=80, 1=80-85, 2=85-90, 3=90-95, 4=95-97, 5=>97
    // Non-cancelable, Guide-level (Table 7, 30-yr)
    const nonCancelGuide30 = {
      85: 0.706, 90: 0.407, 95: 0.312, 97: 0.230, 999: 0.188
    };
    // Non-cancelable, Charter-level (Table 7, 30-yr)
    const nonCancelCharter30 = {
      85: 0.850, 90: 0.713, 95: 0.627, 97: 0.590, 999: 0.558
    };
    // Cancelable, Guide-level (Table 8, 30-yr, age<=5mo representative)
    const cancelGuide30 = {
      85: 0.867, 90: 0.551, 95: 0.412, 97: 0.322, 999: 0.272
    };

    if (oltv <= 80) return 1.0; // No MI benefit below 80% LTV

    // Determine coverage level: guide if MI% meets/exceeds standard thresholds
    let isGuide = false;
    if (oltv <= 85 && miPct >= 12) isGuide = true;
    else if (oltv <= 90 && miPct >= 25) isGuide = true;
    else if (oltv <= 95 && miPct >= 30) isGuide = true;
    else if (oltv <= 97 && miPct >= 35) isGuide = true;
    else if (oltv > 97 && miPct >= 35) isGuide = true;

    const table = cancelable
      ? (isGuide ? cancelGuide30 : nonCancelCharter30)
      : (isGuide ? nonCancelGuide30 : nonCancelCharter30);

    const key = oltv <= 85 ? 85 : oltv <= 90 ? 90 : oltv <= 95 ? 95 : oltv <= 97 ? 97 : 999;
    return table[key] || 1.0;
  }

  // ============================================================
  // Table 12: Counterparty Haircut (MI insurer credit quality)
  // ============================================================
  function counterpartyHaircut(rating) {
    const haircuts = [0, 0, 0.02, 0.05, 0.10, 0.15, 0.20, 0.25, 1.00];
    return haircuts[Math.min(Math.max(rating||2, 1), 8)]; // Default rating 2 (most MI cos)
  }

  // Adjusted Credit Enhancement Multiplier
  function adjustedCEM(ceMultiplier, cpHaircut) {
    return 1.0 - ((1.0 - ceMultiplier) * (1.0 - cpHaircut));
  }

  // ============================================================
  // Main Calculation
  // ============================================================
  function calculate(loan) {
    // Apply conservative defaults for missing fields
    const fico = (loan.fico >= 300 && loan.fico <= 850) ? loan.fico : DEFAULTS.fico;
    const upb  = loan.upb || 0;
    const oltv = (loan.ltv > 0 && loan.ltv <= 300) ? loan.ltv : DEFAULTS.ltv;
    const dti  = (loan.dti > 0 && loan.dti <= 100) ? loan.dti : null; // null → use default mult
    const age  = parseInt(loan.loanAge) || 0;

    // Use ELTV (estimated/mark-to-market LTV) if available and loan age >= 6 months
    let effectiveLTV = oltv;
    if (age >= 6 && loan.eltv > 0 && loan.eltv <= 300) {
      effectiveLTV = loan.eltv;
    }

    // Base risk weight from Table 2
    const brw = baseRiskWeight(fico, effectiveLTV);

    // Risk multipliers from Table 6 (product, capped at 3.0)
    const mults = {
      purpose:  purposeMult(loan.purpose),
      occ:      occMult(loan.occ),
      propType: propTypeMult(loan.propType, loan.numUnits),
      channel:  channelMult(loan.channel),
      dti:      dtiMult(dti),
      product:  productMult(loan.amortType, loan.origTerm),
      loanAge:  loanAgeMult(age),
      io:       ioMult(loan.io),
      doc:      docMult(loan.doc)
    };
    const combinedMult = Math.min(3.0, Object.values(mults).reduce((a,b) => a*b, 1.0));

    // MI credit enhancement
    const miPct = parseFloat(loan.miPct) || 0;
    const cancelable = true; // Conservative: assume cancelable unless known otherwise
    const ceMult = miCreditEnhancementMult(oltv, miPct, cancelable);
    const cpHaircut = counterpartyHaircut(loan.miRating || 2);
    const acem = adjustedCEM(ceMult, cpHaircut);

    // Final risk weight: base × combined × ACEM, floored at 20%
    const riskWeight = Math.max(0.20, brw * combinedMult * acem);

    // Capital requirements
    const rwa         = upb * riskWeight;
    const capitalCET1 = rwa * 0.045;  // 4.5% CET1
    const capitalT1   = rwa * 0.06;   // 6.0% Tier 1
    const capitalTotal= rwa * 0.08;   // 8.0% Total capital

    return {
      riskWeight, rwa, capitalCET1, capitalT1, capitalTotal,
      baseRW: brw, combinedMult, acem,
      multipliers: mults,
      effectiveLTV, miCEM: ceMult
    };
  }

  return { calculate, baseRiskWeight, DEFAULTS, ficoIdx, ltvIdx };
})();
