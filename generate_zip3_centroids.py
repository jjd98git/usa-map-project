"""
Aggregate 5-digit ZCTA centroids from the US Census Bureau Gazetteer
into 3-digit ZIP prefix (ZIP3) centroids by averaging lat/lng coordinates.

Source: 2024_Gaz_zcta_national.txt from
https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_Gaz_zcta_national.zip

The gazetteer file is tab-delimited with columns:
  GEOID, ALAND, AWATER, ALAND_SQMI, AWATER_SQMI, INTPTLAT, INTPTLONG

We compute an area-weighted centroid for each 3-digit prefix using ALAND (land area)
as the weight, which gives a more representative centroid than a simple average.
"""

import csv
from collections import defaultdict

INPUT_FILE = "2024_Gaz_zcta_national.txt"
OUTPUT_FILE = "zip3_centroids.csv"


def main():
    # Accumulate weighted sums per ZIP3 prefix
    zip3_data = defaultdict(lambda: {"weight_sum": 0.0, "lat_wsum": 0.0, "lng_wsum": 0.0, "count": 0})

    with open(INPUT_FILE, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f, delimiter="\t")
        # Strip whitespace from field names (gazetteer has trailing spaces)
        reader.fieldnames = [name.strip() for name in reader.fieldnames]

        for row in reader:
            geoid = row["GEOID"].strip()
            if len(geoid) < 3:
                continue

            zip3 = geoid[:3]
            lat = float(row["INTPTLAT"].strip())
            lng = float(row["INTPTLONG"].strip())
            land_area = float(row["ALAND"].strip())

            # Use land area as weight (fallback to 1 if zero)
            weight = land_area if land_area > 0 else 1.0

            zip3_data[zip3]["weight_sum"] += weight
            zip3_data[zip3]["lat_wsum"] += lat * weight
            zip3_data[zip3]["lng_wsum"] += lng * weight
            zip3_data[zip3]["count"] += 1

    # Write output CSV
    with open(OUTPUT_FILE, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["zip3", "latitude", "longitude", "zcta_count"])

        for zip3 in sorted(zip3_data.keys()):
            d = zip3_data[zip3]
            lat = d["lat_wsum"] / d["weight_sum"]
            lng = d["lng_wsum"] / d["weight_sum"]
            writer.writerow([zip3, f"{lat:.6f}", f"{lng:.6f}", d["count"]])

    print(f"Wrote {len(zip3_data)} ZIP3 centroids to {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
