// 3-Digit ZIP Code to approximate geographic coordinates
// Maps ZIP3 prefix → state → approximate lat/lng with deterministic spread

const ZIP3GEO = (function() {

  // State centroids (approximate geographic center of each state)
  const STATE_CENTER = {
    'AL': [32.80, -86.79], 'AK': [64.00, -153.00], 'AZ': [34.05, -111.09],
    'AR': [34.80, -92.20], 'CA': [36.78, -119.42], 'CO': [39.55, -105.78],
    'CT': [41.60, -72.70], 'DE': [39.00, -75.50], 'DC': [38.90, -77.04],
    'FL': [28.10, -81.60], 'GA': [32.68, -83.22], 'HI': [20.80, -156.33],
    'ID': [44.07, -114.74], 'IL': [40.35, -89.00], 'IN': [39.85, -86.26],
    'IA': [42.01, -93.21], 'KS': [38.50, -98.27], 'KY': [37.67, -84.67],
    'LA': [30.98, -91.96], 'ME': [45.37, -69.24], 'MD': [39.05, -76.64],
    'MA': [42.23, -71.53], 'MI': [44.35, -85.41], 'MN': [46.28, -94.31],
    'MS': [32.74, -89.68], 'MO': [38.46, -92.30], 'MT': [46.80, -110.36],
    'NE': [41.12, -98.27], 'NV': [38.80, -116.42], 'NH': [43.45, -71.56],
    'NJ': [40.06, -74.41], 'NM': [34.52, -105.87], 'NY': [42.17, -74.95],
    'NC': [35.63, -79.81], 'ND': [47.53, -99.78], 'OH': [40.42, -82.91],
    'OK': [35.47, -97.52], 'OR': [43.80, -120.55], 'PA': [41.20, -77.19],
    'PR': [18.22, -66.59], 'RI': [41.58, -71.48], 'SC': [33.84, -81.16],
    'SD': [43.97, -99.90], 'TN': [35.52, -86.58], 'TX': [31.97, -99.90],
    'UT': [39.32, -111.09], 'VT': [44.07, -72.67], 'VA': [37.77, -78.17],
    'VI': [18.34, -64.93], 'WA': [47.40, -120.74], 'WV': [38.60, -80.45],
    'WI': [44.27, -89.62], 'WY': [43.08, -107.29]
  };

  // ZIP3 prefix → state mapping (range-based)
  // Source: USPS Publication 65
  const ZIP3_RANGES = [
    // [startZip3, endZip3, stateCode]
    [5, 5, 'NY'],       // IRS center
    [6, 9, 'PR'],       // Puerto Rico / Virgin Islands
    [10, 27, 'MA'],
    [28, 29, 'RI'],
    [30, 38, 'NH'],
    [39, 39, 'ME'],
    [40, 49, 'ME'],
    [50, 59, 'VT'],
    [60, 69, 'CT'],
    [70, 89, 'NJ'],
    [90, 99, 'NY'],     // Military APO (treat as NY)
    [100, 149, 'NY'],
    [150, 196, 'PA'],
    [197, 199, 'DE'],
    [200, 205, 'DC'],
    [206, 219, 'MD'],
    [220, 246, 'VA'],
    [247, 268, 'WV'],
    [270, 289, 'NC'],
    [290, 299, 'SC'],
    [300, 319, 'GA'],
    [320, 339, 'FL'],
    [340, 342, 'FL'],    // Military APO (treat as FL)
    [346, 347, 'FL'],
    [349, 349, 'FL'],
    [350, 369, 'AL'],
    [370, 385, 'TN'],
    [386, 397, 'MS'],
    [398, 399, 'GA'],
    [400, 427, 'KY'],
    [430, 458, 'OH'],
    [460, 479, 'IN'],
    [480, 499, 'MI'],
    [500, 528, 'IA'],
    [530, 549, 'WI'],
    [550, 567, 'MN'],
    [570, 577, 'SD'],
    [580, 588, 'ND'],
    [590, 599, 'MT'],
    [600, 629, 'IL'],
    [630, 658, 'MO'],
    [660, 679, 'KS'],
    [680, 693, 'NE'],
    [700, 714, 'LA'],
    [716, 729, 'AR'],
    [730, 749, 'OK'],
    [750, 799, 'TX'],
    [800, 816, 'CO'],
    [820, 831, 'WY'],
    [832, 838, 'ID'],
    [840, 847, 'UT'],
    [850, 865, 'AZ'],
    [870, 884, 'NM'],
    [889, 898, 'NV'],
    [900, 935, 'CA'],
    [936, 966, 'CA'],
    [967, 968, 'HI'],
    [970, 979, 'OR'],
    [980, 994, 'WA'],
    [995, 999, 'AK']
  ];

  function zip3ToState(zip3) {
    const z = parseInt(zip3);
    if (isNaN(z)) return null;
    for (const [lo, hi, st] of ZIP3_RANGES) {
      if (z >= lo && z <= hi) return st;
    }
    return null;
  }

  // Get approximate coordinates for a 3-digit zip
  // Uses state centroid + deterministic offset based on zip value
  function getCoords(zip3) {
    const state = zip3ToState(zip3);
    if (!state || !STATE_CENTER[state]) return null;

    const [baseLat, baseLng] = STATE_CENTER[state];
    const z = parseInt(zip3);

    // Find the range this zip belongs to within its state
    let rangeStart = z, rangeEnd = z;
    for (const [lo, hi, st] of ZIP3_RANGES) {
      if (st === state && z >= lo && z <= hi) {
        rangeStart = lo;
        rangeEnd = hi;
        break;
      }
    }

    // Spread within state based on position in range
    const rangeSize = Math.max(1, rangeEnd - rangeStart);
    const position = (z - rangeStart) / rangeSize; // 0 to 1

    // State size factors (rough degrees of lat/lng spread)
    const stateSpread = {
      'TX': [4.0, 5.0], 'CA': [5.0, 3.0], 'AK': [6.0, 10.0],
      'MT': [2.5, 4.0], 'NM': [2.0, 2.5], 'AZ': [2.5, 2.0],
      'NV': [3.0, 1.5], 'CO': [1.5, 2.5], 'OR': [2.0, 3.0],
      'WY': [1.5, 2.5], 'MI': [2.5, 2.0], 'UT': [2.5, 1.5],
      'ID': [3.0, 1.5], 'KS': [1.0, 3.0], 'NE': [1.0, 3.5],
      'SD': [1.0, 3.0], 'ND': [0.8, 2.5], 'WA': [1.5, 2.5],
      'MN': [2.5, 2.0], 'FL': [3.5, 2.0], 'NY': [2.0, 2.5],
      'PA': [1.0, 3.0], 'IL': [2.5, 1.5], 'IA': [1.5, 2.0],
      'MO': [2.0, 2.0], 'GA': [1.5, 1.5], 'NC': [1.0, 2.5],
      'VA': [1.5, 2.5], 'WI': [2.0, 2.0], 'OH': [1.5, 1.5],
      'AL': [1.5, 1.0], 'MS': [1.5, 1.0], 'LA': [1.5, 1.5],
      'AR': [1.0, 1.5], 'OK': [1.5, 2.0], 'TN': [1.0, 3.0],
      'KY': [1.0, 2.5], 'IN': [1.5, 1.0], 'SC': [1.0, 1.5],
      'WV': [1.0, 1.5], 'ME': [2.0, 1.5], 'NJ': [0.8, 0.5],
      'MA': [0.5, 1.0], 'CT': [0.3, 0.5], 'NH': [0.8, 0.5],
      'VT': [1.0, 0.5], 'MD': [0.5, 1.5], 'DE': [0.5, 0.3],
      'RI': [0.2, 0.2], 'HI': [1.0, 1.0], 'DC': [0.05, 0.05],
      'PR': [0.3, 0.5], 'VI': [0.1, 0.1]
    };

    const spread = stateSpread[state] || [1.0, 1.0];

    // Use a simple deterministic spread: south→north as zip increases within range
    // Add a sinusoidal east-west offset to avoid a straight line
    const latOffset = (position - 0.5) * spread[0];
    const lngOffset = Math.sin(position * Math.PI * 2.7) * spread[1] * 0.4;

    return [baseLat + latOffset, baseLng + lngOffset];
  }

  return { getCoords, zip3ToState, STATE_CENTER };
})();
