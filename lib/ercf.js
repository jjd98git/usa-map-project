// ERCF (Enterprise Regulatory Capital Framework) Calculator
// Based on 12 CFR 1240.33 — FHFA Final Rule (Dec 2020, codified 2025)
// Applies to Freddie Mac / Fannie Mae single-family performing loans

const ERCF = (function() {

  // Table 2: Base Risk Weights — Performing Loans
  // Rows: FICO buckets, Cols: Adjusted MTMLTV buckets
  // FICO: <620, 620-639, 640-659, 660-679, 680-699, 700-719, 720-739, 740-759, 760-779, >=780
  // LTV:  <=30, >30-40, >40-50, >50-60, >60-70, >70-75, >75-80, >80-85, >85-90, >90-95, >95-100, >100-110, >110-120, >120
  const BASE_RW = [
    [0.02,0.10,0.18,0.34,0.49,0.72,1.05,1.29,1.59,1.88,2.18,2.47,2.75,3.17], // <620
    [0.02,0.08,0.14,0.27,0.39,0.58,0.84,1.02,1.27,1.51,1.78,2.08,2.37,2.82], // 620-639
    [0.02,0.07,0.12,0.23,0.34,0.51,0.73,0.89,1.11,1.33,1.59,1.86,2.14,2.58], // 640-659
    [0.02,0.06,0.10,0.20,0.29,0.44,0.63,0.78,0.98,1.19,1.41,1.68,1.94,2.36], // 660-679
    [0.02,0.06,0.09,0.18,0.26,0.38,0.55,0.67,0.88,1.09,1.25,1.50,1.76,2.15], // 680-699
    [0.02,0.05,0.08,0.15,0.22,0.33,0.47,0.57,0.75,0.94,1.10,1.34,1.58,1.94], // 700-719
    [0.02,0.04,0.06,0.13,0.19,0.28,0.41,0.50,0.66,0.84,0.96,1.18,1.40,1.72], // 720-739
    [0.02,0.04,0.05,0.11,0.16,0.23,0.33,0.40,0.54,0.69,0.80,0.99,1.19,1.47], // 740-759
    [0.02,0.03,0.04,0.09,0.13,0.19,0.27,0.32,0.43,0.56,0.65,0.82,0.99,1.22], // 760-779
    [0.02,0.03,0.03,0.07,0.10,0.14,0.21,0.25,0.33,0.43,0.50,0.63,0.77,0.96], // >=780
  ];

  const FICO_BREAKS = [620, 640, 660, 680, 700, 720, 740, 760, 780];
  const LTV_BREAKS  = [30, 40, 50, 60, 70, 75, 80, 85, 90, 95, 100, 110, 120];

  function ficoIdx(fico) {
    for (let i = 0; i < FICO_BREAKS.length; i++) {
      if (fico < FICO_BREAKS[i]) return i;
    }
    return FICO_BREAKS.length; // >=780
  }

  function ltvIdx(ltv) {
    for (let i = 0; i < LTV_BREAKS.length; i++) {
      if (ltv <= LTV_BREAKS[i]) return i;
    }
    return LTV_BREAKS.length; // >120
  }

  function baseRiskWeight(fico, ltv) {
    const fi = ficoIdx(fico);
    const li = ltvIdx(ltv);
    return BASE_RW[fi][li];
  }

  // Table 6: Risk Multipliers (Performing Loans)

  function purposeMultiplier(purpose) {
    // P=Purchase, C=Cash-out refi, N/R=Rate-term refi
    switch ((purpose || '').toUpperCase().charAt(0)) {
      case 'C': return 1.4;
      case 'N': case 'R': return 1.3;
      default: return 1.0; // Purchase or unknown-as-purchase
    }
  }

  function occupancyMultiplier(occ) {
    // O=Owner, S=Second home, I=Investment
    return (occ || '').toUpperCase().charAt(0) === 'I' ? 1.2 : 1.0;
  }

  function propertyTypeMultiplier(propType, numUnits) {
    const pt = (propType || '').toUpperCase();
    const units = parseInt(numUnits) || 1;
    if (pt === 'MH') return 1.3; // Manufactured housing
    if (pt === 'CO' || pt === 'CP') return 1.1; // Condo
    if (units >= 2 && units <= 4) return 1.4; // 2-4 unit
    if (pt === 'PU' || pt === 'SF') return 1.0; // PUD or single-family
    return 1.0;
  }

  function channelMultiplier(channel) {
    // R=Retail, B=Broker, C=Correspondent, T=TPO
    const ch = (channel || '').toUpperCase().charAt(0);
    return (ch === 'B' || ch === 'C' || ch === 'T') ? 1.1 : 1.0;
  }

  function dtiMultiplier(dti) {
    if (!dti || dti <= 0) return 1.0; // Unknown → neutral
    if (dti <= 25) return 0.8;
    if (dti <= 40) return 1.0;
    return 1.2;
  }

  function productMultiplier(amortType, origTerm) {
    const term = parseInt(origTerm) || 360;
    const isARM = (amortType || '').toUpperCase().includes('ARM');
    if (isARM) return 1.7;
    if (term <= 180) return 0.3;  // FRM15
    if (term <= 240) return 0.6;  // FRM20
    return 1.0; // FRM30
  }

  function loanAgeMultiplier(ageMonths) {
    const age = parseInt(ageMonths) || 0;
    if (age <= 24) return 1.0;
    if (age <= 36) return 0.95;
    if (age <= 60) return 0.80;
    return 0.75;
  }

  // Main calculation
  function calculate(loan) {
    // loan = { fico, ltv, upb, purpose, occ, propType, numUnits, channel, dti, amortType, origTerm, loanAge }

    const fico = loan.fico || 600;   // Default to conservative if missing
    const ltv  = loan.ltv  || 80;
    const upb  = loan.upb  || 0;

    // Base risk weight from grid
    const brw = baseRiskWeight(fico, ltv);

    // Combined risk multiplier (product of all, capped at 3.0)
    const multipliers = [
      purposeMultiplier(loan.purpose),
      occupancyMultiplier(loan.occ),
      propertyTypeMultiplier(loan.propType, loan.numUnits),
      channelMultiplier(loan.channel),
      dtiMultiplier(loan.dti),
      productMultiplier(loan.amortType, loan.origTerm),
      loanAgeMultiplier(loan.loanAge)
    ];
    const combinedMult = Math.min(3.0, multipliers.reduce((a, b) => a * b, 1.0));

    // No MI adjustment for simplicity (would need insurer rating data)
    const creditEnhMult = 1.0;

    // Risk weight = base × combined × CE, floored at 20%
    const riskWeight = Math.max(0.20, brw * combinedMult * creditEnhMult);

    // Capital requirement (CET1 = 4.5%)
    const capitalCET1 = upb * riskWeight * 0.045;
    // Total capital (8.0%)
    const capitalTotal = upb * riskWeight * 0.08;
    // Risk-weighted assets
    const rwa = upb * riskWeight;

    return {
      riskWeight,       // e.g. 0.33 = 33%
      rwa,              // risk-weighted assets in $
      capitalCET1,      // CET1 capital requirement in $
      capitalTotal,     // Total capital requirement in $
      baseRW: brw,
      combinedMult,
      multipliers: {
        purpose: multipliers[0],
        occupancy: multipliers[1],
        propertyType: multipliers[2],
        channel: multipliers[3],
        dti: multipliers[4],
        product: multipliers[5],
        loanAge: multipliers[6]
      }
    };
  }

  return { calculate, baseRiskWeight, ficoIdx, ltvIdx };
})();
