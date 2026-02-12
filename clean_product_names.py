#!/usr/bin/env python3
"""
Clean product names in products.csv to short, descriptive format.
Style: Short & Descriptive (under ~50 chars)
"""

import csv
import re

INPUT_FILE = 'products.csv'
OUTPUT_FILE = 'products_cleaned.csv'
MAX_LEN = 50

# Emoji pattern
EMOJI_RE = re.compile(
    r'[\U0001F600-\U0001F64F\U0001F300-\U0001F5FF\U0001F680-\U0001F6FF'
    r'\U0001F1E0-\U0001F1FF\U00002702-\U000027B0\U000024C2-\U0001F251'
    r'\U0001F900-\U0001F9FF\U0001FA00-\U0001FA6F\U0001FA70-\U0001FAFF'
    r'\U00002600-\U000026FF\U0000FE00-\U0000FE0F\U0000200D'
    r'\U00002B50\U00002B55]+', flags=re.UNICODE
)

CAR_RE = re.compile(
    r'tesla|mercedes|bmw|chevrolet|buick|toyota|honda|ford|jeep|dodge|'
    r'cadillac|lexus|nissan|subaru|mazda|kia|hyundai|key\s*fob|smart\s*key|'
    r'remote\s*key|car\s*key', re.I
)

PRESERVE_UPPER = {
    'usa','us','uk','uae','led','usb','acu','ocp','ucp','bmw','ll','xl',
    'xxl','pcs','3d','2d','diy','lcd','hd','ac','dc','bbq','id','ii',
    'iii','iv','tv','pc','nfl','fob','ct','oz','ft','suv','gps','atv',
}

BRAND_NAMES = {
    'tesla','mercedes-benz','mercedes','chevrolet','buick','toyota',
    'honda','ford','jeep','dodge','cadillac','lexus','nissan','subaru',
    'mazda','kia','hyundai','poedagar','ferrero','rocher','godiva',
    'swarovski','pandora',
}


def clean_name(name: str) -> str:
    original = name

    # Normalize smart quotes to ASCII
    name = name.replace('\u2018', "'").replace('\u2019', "'").replace('\u201C', '"').replace('\u201D', '"')

    # Strip emojis and decorative chars
    name = EMOJI_RE.sub(' ', name)
    name = re.sub(r'[✅✔☑️|★☆♥❤❣♡●•·※✿❀◆◇■□▪▫►◄▶◀→←↑↓✦✧⊕⊗⊛∗†‡‣⁃]', ' ', name)

    # Remove barcodes/long numeric codes
    name = re.sub(r'\b\d{8,}\b', '', name)

    # Remove long alphanumeric codes (8+ chars)
    name = re.sub(r'\b[A-Z0-9]{8,}\b', '', name)

    # Remove FCC codes
    name = re.sub(r'\bFCC:?\s*\S+', '', name, flags=re.I)

    # Remove Chinese brackets
    name = re.sub(r'【[^】]*】', '', name)

    # Remove foreign noise
    name = re.sub(r'\breloj\s+hombre\b', '', name, flags=re.I)
    name = re.sub(r'\bmontre\s+femme\b', '', name, flags=re.I)

    # Remove OEM/OUC
    name = re.sub(r'\bOEM\b', '', name)
    name = re.sub(r'\bOUC\d+\b', '', name, flags=re.I)

    # Remove hype words
    name = re.sub(r'\b(?:EXCELLENT|AMAZING|PERFECT|GORGEOUS|BEAUTIFUL|STUNNING|INCREDIBLE)!?\b', '', name, flags=re.I)

    # Collapse spaces
    name = re.sub(r'\s+', ' ', name).strip()

    # Remove year prefix unless car product
    if not CAR_RE.search(name):
        name = re.sub(r'^20(?:2[0-6]|1\d)\s+', '', name)

    # Remove "New" at start
    name = re.sub(r'^New\s+', '', name, flags=re.I)

    # Remove "for X" target audience at end
    name = re.sub(
        r'\s+for\s+(?:women|men|woman|man|ladies|girls?|boys?|kids?|teens?|'
        r'her|him|wife|husband|girlfriend|boyfriend|daughter|son|mother|'
        r'father|mom|dad|couples?|family|friends?|valentine\'?s?'
        r'(?:\s+day)?|christmas|birthday|anniversary|holiday|weddings?|'
        r'engagement|party|new\s*year)(?:[,\s].*)?$', '', name, flags=re.I
    )

    # Handle compound holiday terms BEFORE removing individual words
    name = re.sub(r'\bFather Christmas\b', 'Santa', name, flags=re.I)

    # Remove holiday/occasion words used as filler
    name = re.sub(r"\bValentine'?s?\s*(?:Day)?\b", '', name, flags=re.I)
    name = re.sub(r"\bValentines?\b", '', name, flags=re.I)  # catch leftover
    name = re.sub(r"\bChristmas\b(?:\s+(?:Gift|Edition|Special|Decoratio\w*))?", ' ', name, flags=re.I)
    name = re.sub(r"\bXmas\b", '', name, flags=re.I)
    
    # Clean up orphaned "'s" from removed words (e.g. "Valentine's" → "'s")
    name = re.sub(r"(?<!\w)'s\b", '', name)

    # Remove filler adjectives/phrases
    for phrase in [
        r'Unique\s+Holiday', r'Last\s+Minute', r'Limited\s+Edition',
        r'Best\s+Seller', r'Brand\s+New', r'High\s+Quality',
        r'Top\s+Quality', r'Best\s+Quality', r'Premium\s+Quality',
        r'Free\s+Shipping', r'Fast\s+Shipping', r'Hot\s+Sale',
        r'Best\s+Holiays',  # typo in data
    ]:
        name = re.sub(rf'\b{phrase}\b', '', name, flags=re.I)

    # Remove standalone filler words at start/end
    for word in ['Fashion', 'Trendy', 'Stylish', 'Creative', 'Novelty',
                 'Luxury', 'Luxurious', 'Elegant', 'Premium', 'Classic',
                 'Happy', 'Cute', 'Lovely']:
        name = re.sub(rf'^{word}\s+', '', name, flags=re.I)
        name = re.sub(rf'\s+{word}$', '', name, flags=re.I)

    # Remove "Keyless Entry Remote" → just "Key Fob" or "Remote Key"
    name = re.sub(r'\bKeyless\s+Entry\s+Remote\b', 'Remote Key', name, flags=re.I)

    # Remove trailing "Gift(s)", "Present(s)"
    name = re.sub(r'\s+(?:Gift|Present|Surprise)s?\s*$', '', name, flags=re.I)

    # Remove dangling "Happy" at end (from removed holiday words)
    name = re.sub(r'\bHappy\s*$', '', name, flags=re.I)
    name = re.sub(r'\bHappy\s*,', '', name, flags=re.I)

    # Remove trailing punctuation like "!"
    name = re.sub(r'\s*!+\s*$', '', name)

    # De-duplicate repeated words (e.g. "Hat Hat" → "Hat")
    name = re.sub(r'\b(\w+)\s+\1\b', r'\1', name, flags=re.I)

    # Remove trailing prepositions/articles left dangling after removals
    name = re.sub(r'\s+(?:for|with|to|at|by|in|on|of|and|or|the|a|an)\s*$', '', name, flags=re.I)

    # Clean punctuation artifacts
    name = re.sub(r'\s*–\s*', ' – ', name)  # normalize dashes
    name = re.sub(r',\s*,+', ',', name)       # double commas
    name = re.sub(r'\s*,\s*$', '', name)       # trailing comma
    name = re.sub(r'^\s*,\s*', '', name)       # leading comma
    name = re.sub(r'\s*–\s*$', '', name)       # trailing dash
    name = re.sub(r'\s*-\s*$', '', name)       # trailing hyphen
    name = re.sub(r'\(\s*\)', '', name)         # empty parens
    name = re.sub(r'\s+', ' ', name).strip()

    # Remove dangling short fragments after last comma (< 7 chars, no digits)
    for _ in range(3):  # repeat to catch cascading fragments
        m = re.search(r',\s*([^,]{1,6})\s*$', name)
        if m and not re.search(r'\d', m.group(1)):
            name = name[:m.start()].strip()
        else:
            break

    # Strip edge noise
    name = name.strip(' ,;:-–—|/')

    # Smart truncation
    if len(name) > MAX_LEN:
        name = smart_truncate(name, MAX_LEN)

    # Title case
    name = title_case_smart(name)

    # Final cleanup
    name = re.sub(r'\s+', ' ', name).strip()
    name = name.strip(' ,;:-–—|/')

    # Fallback for too-short results: use less aggressive cleaning
    if len(name) < 8:
        name = EMOJI_RE.sub(' ', original)
        name = re.sub(r'[✅✔☑️|★☆♥❤❣♡●•·※✿❀◆◇■□▪▫►◄▶◀→←↑↓✦✧]', ' ', name)
        name = re.sub(r'\b\d{8,}\b', '', name)
        name = re.sub(r'\s+', ' ', name).strip()
        name = name.strip(' ,;:-–—|/')
        if len(name) > MAX_LEN:
            name = smart_truncate(name, MAX_LEN)
        # Remove trailing prepositions after truncation
        name = re.sub(r'\s+(?:for|with|to|at|by|in|on|of|and|or|the|a|an)\s*$', '', name, flags=re.I)
        name = title_case_smart(name)

    return name.strip()


def smart_truncate(name: str, max_len: int) -> str:
    if len(name) <= max_len:
        return name

    # Try natural breakpoints
    for sep in [' – ', ' - ', ' — ', ' | ', ' / ']:
        idx = name.find(sep)
        if 10 < idx <= max_len:
            candidate = name[:idx].strip()
            if len(candidate) >= 12:
                return candidate

    # Cut at last word boundary
    truncated = name[:max_len]
    last_space = truncated.rfind(' ')
    if last_space > 12:
        result = truncated[:last_space].rstrip(',;:-–— ')
    else:
        result = truncated.rstrip(',;:-–— ')
    
    # Remove trailing prepositions after truncation
    result = re.sub(r'\s+(?:for|with|to|at|by|in|on|of|and|or|the|a|an)$', '', result, flags=re.I)
    return result


def title_case_smart(name: str) -> str:
    words = name.split()
    result = []
    for i, word in enumerate(words):
        lower = word.lower().rstrip('.,;:!?')

        if lower in PRESERVE_UPPER:
            result.append(word.upper())
        elif lower in BRAND_NAMES:
            # Special casing for compound brands
            if lower == 'mercedes-benz':
                result.append('Mercedes-Benz')
            else:
                result.append(word.capitalize())
        elif re.match(r'^\d+[a-zA-Z]+$', word):
            result.append(word)
        elif lower in ('a','an','the','and','or','of','in','on','at','to',
                        'for','with','by','from','as','is','no','up') and i > 0:
            result.append(lower)
        elif not word.isupper() and not word.islower() and any(c.isupper() for c in word[1:]):
            result.append(word)  # preserve mixed case like "iPhone"
        else:
            result.append(word.capitalize())

    return ' '.join(result)


def process_csv():
    rows = []

    with open(INPUT_FILE, 'r', encoding='utf-8') as f:
        reader = csv.reader(f)
        header = next(reader)
        rows.append(header)

        name_col = header.index('name')

        changed = 0
        total = 0
        samples = []

        for row in reader:
            total += 1
            old_name = row[name_col]
            new_name = clean_name(old_name)

            if old_name != new_name:
                changed += 1
                if len(samples) < 40:
                    samples.append((old_name[:80], new_name))

            row[name_col] = new_name
            rows.append(row)

    with open(OUTPUT_FILE, 'w', encoding='utf-8', newline='') as f:
        writer = csv.writer(f)
        writer.writerows(rows)

    print(f"\n{'='*60}")
    print(f"Product Name Cleaning Results")
    print(f"{'='*60}")
    print(f"Total products: {total}")
    print(f"Names changed:  {changed}")
    print(f"Unchanged:      {total - changed}")
    print(f"\nOutput: {OUTPUT_FILE}")

    print(f"\n{'─'*60}")
    print("Sample changes (first 40):")
    print(f"{'─'*60}")
    for old, new in samples:
        print(f"  OLD: {old}")
        print(f"  NEW: {new}")
        print()

    lengths = [len(r[name_col]) for r in rows[1:]]
    print(f"Length distribution:")
    print(f"  ≤ 25 chars: {sum(1 for l in lengths if l <= 25)}")
    print(f"  26-35 chars: {sum(1 for l in lengths if 25 < l <= 35)}")
    print(f"  36-45 chars: {sum(1 for l in lengths if 35 < l <= 45)}")
    print(f"  46-50 chars: {sum(1 for l in lengths if 45 < l <= 50)}")
    print(f"  > 50 chars:  {sum(1 for l in lengths if l > 50)}")
    print(f"  Average:     {sum(lengths)/len(lengths):.1f} chars")
    
    # Show longest names
    name_lengths = [(r[name_col], len(r[name_col])) for r in rows[1:]]
    name_lengths.sort(key=lambda x: -x[1])
    print(f"\nLongest 10 names:")
    for n, l in name_lengths[:10]:
        print(f"  [{l}] {n}")


if __name__ == '__main__':
    process_csv()
