#!/usr/bin/env python3
"""
Update FA_Logistics_Acquisition_Pricing_Master_NO_ID.csv:
1. Add PROD-XXXX IDs column (matched via image URL prefix)
2. Round sell_price up to psychologically attractive numbers
3. Recalculate profit = new_sell_price - cost_price
"""
import csv
import re
import os

INPUT_FILE = "FA_Logistics_Acquisition_Pricing_Master_NO_ID.csv"
OUTPUT_FILE = "FA_Logistics_Acquisition_Pricing_Master.csv"

def parse_naira(s):
    """Parse '₦52,752' → 52752"""
    s = s.strip().replace("₦", "").replace(",", "")
    return int(s)

def format_naira(n):
    """Format 52752 → '₦52,752'"""
    return f"₦{n:,}"

def round_to_attractive(price):
    """
    Round a price UP to the nearest psychologically attractive number.
    Uses a deliberate mix of ,000 / ,500 / ,900 / X9,900 endings.
    Max bump depends on price tier.
    """
    if price < 40000:
        max_add = 2500
    elif price < 60000:
        max_add = 3000
    elif price < 80000:
        max_add = 3500
    elif price < 120000:
        max_add = 5000
    elif price < 200000:
        max_add = 6000
    else:
        max_add = 7000

    base_k = (price // 1000) * 1000  # floor to nearest thousand

    candidates = []

    # X,000 options
    for offset in range(0, max_add + 1000, 1000):
        candidates.append(base_k + offset)

    # X,500 options
    for offset in range(500, max_add + 1000, 1000):
        candidates.append(base_k + offset)

    # X,900 options
    for offset in range(900, max_add + 1000, 1000):
        candidates.append(base_k + offset)

    # X9,900 options (49900, 59900, 69900...)
    tens_base = (price // 10000) * 10000
    for t_offset in [9900, 19900]:
        candidates.append(tens_base + t_offset)

    # Filter: must be strictly above price, within max_add
    valid = [c for c in candidates if c > price and (c - price) <= max_add]

    if not valid:
        # Fallback: just round to next ,900
        x900 = base_k + 900
        while x900 <= price:
            x900 += 1000
        return x900

    valid.sort()

    # Assign attractiveness scores
    def attractiveness(p):
        if p % 10000 == 9900:
            return 4  # e.g., 49,900, 69,900
        elif p % 1000 == 900:
            return 3
        elif p % 1000 == 500:
            return 2
        elif p % 1000 == 0:
            return 1
        return 0

    # Use the price's last digits to deterministically vary the ending choice.
    # This creates a natural-looking mix without being random.
    price_mod = (price % 10000) // 100  # 0-99 range based on hundreds digit

    # Group candidates by type
    by_type = {}
    for c in valid:
        t = attractiveness(c)
        by_type.setdefault(t, []).append(c)

    # For each type, keep only the closest (smallest bump)
    best_by_type = {}
    for t, cands in by_type.items():
        best_by_type[t] = min(cands)

    # Preference rotation based on price_mod to ensure mix
    if price_mod < 20:
        # Prefer ,500
        preference_order = [2, 1, 3, 4]
    elif price_mod < 45:
        # Prefer ,900
        preference_order = [3, 4, 2, 1]
    elif price_mod < 55:
        # Prefer ,000
        preference_order = [1, 2, 3, 4]
    elif price_mod < 75:
        # Prefer x9,900
        preference_order = [4, 3, 2, 1]
    else:
        # Prefer ,900
        preference_order = [3, 2, 4, 1]

    # But don't pick a number that's barely above (less than ₦200 bump) unless
    # that's the only option. A tiny bump looks weird.
    for pref in preference_order:
        if pref in best_by_type:
            candidate = best_by_type[pref]
            bump = candidate - price
            if bump >= 200 or len(best_by_type) == 1:
                return candidate

    # Fallback: pick the one with the largest bump that still fits within max_add
    # (makes the rounding feel intentional)
    all_best = sorted(best_by_type.values(), reverse=True)
    for c in all_best:
        if (c - price) >= 200:
            return c

    # Final fallback: just pick closest valid
    return valid[0]


def extract_image_number(image_url):
    """Extract the leading number from an image filename.
    Handles both patterns:
      - ibb.co: /0001-xxx.jpg  (slash + 4 digits + hyphen)
      - GitHub raw: images/0910_xxx  (images/ + 4 digits + underscore)
    """
    # Try ibb.co pattern first
    match = re.search(r'/(\d{4})-', image_url)
    if match:
        return match.group(1)
    # Try GitHub raw pattern: images/XXXX_
    match = re.search(r'/(\d{4})_', image_url)
    if match:
        return match.group(1)
    return None


def main():
    rows = []
    with open(INPUT_FILE, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames
        for row in reader:
            rows.append(row)

    print(f"Read {len(rows)} rows from {INPUT_FILE}")
    print(f"Original columns: {fieldnames}")

    # Process each row
    updated = 0
    id_mapped = 0
    price_samples = []

    for row in rows:
        # 1. Add PROD-XXXX from image URL
        img = row.get("image", "")
        img_num = extract_image_number(img)
        if img_num:
            prod_id = f"PROD-{img_num}"
            row["product_id"] = prod_id
            id_mapped += 1
        else:
            row["product_id"] = ""
            print(f"WARNING: No image number found for: {row.get('name', 'UNKNOWN')[:60]}")

        # 2. Round up sell_price
        sell_str = row.get("sell_price", "").strip()
        cost_str = row.get("cost_price", "").strip()

        if sell_str and cost_str and sell_str.startswith("₦") and cost_str.startswith("₦"):
            old_sell = parse_naira(sell_str)
            cost = parse_naira(cost_str)
            new_sell = round_to_attractive(old_sell)
            new_profit = new_sell - cost

            if len(price_samples) < 30:
                price_samples.append((row.get("name", "")[:50], old_sell, new_sell, new_sell - old_sell, new_profit))

            row["sell_price"] = format_naira(new_sell)
            row["profit"] = format_naira(new_profit)
            updated += 1

    # New field order: product_id first, then original columns
    new_fieldnames = ["product_id"] + list(fieldnames)

    with open(OUTPUT_FILE, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=new_fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    print(f"\nResults:")
    print(f"  Rows with PROD IDs: {id_mapped}/{len(rows)}")
    print(f"  Prices updated: {updated}/{len(rows)}")
    print(f"  Output written to: {OUTPUT_FILE}")

    print(f"\n{'='*100}")
    print(f"SAMPLE PRICE ADJUSTMENTS (first 30):")
    print(f"{'='*100}")
    print(f"{'Product':<52} {'Old Sell':>12} {'New Sell':>12} {'Bump':>8} {'New Profit':>12}")
    print(f"{'-'*52} {'-'*12} {'-'*12} {'-'*8} {'-'*12}")
    for name, old, new, bump, profit in price_samples:
        print(f"{name:<52} ₦{old:>10,} ₦{new:>10,} +₦{bump:>5,} ₦{profit:>10,}")

    # Show distribution of endings
    endings = {"x,000": 0, "x,500": 0, "x,900": 0, "x9,900": 0, "other": 0}
    for row in rows:
        sell_str = row.get("sell_price", "").strip()
        if sell_str.startswith("₦"):
            val = parse_naira(sell_str)
            if val % 10000 == 9900:
                endings["x9,900"] += 1
            elif val % 1000 == 900:
                endings["x,900"] += 1
            elif val % 1000 == 500:
                endings["x,500"] += 1
            elif val % 1000 == 0:
                endings["x,000"] += 1
            else:
                endings["other"] += 1

    print(f"\nPrice ending distribution:")
    for ending, count in endings.items():
        print(f"  {ending}: {count}")


if __name__ == "__main__":
    main()
