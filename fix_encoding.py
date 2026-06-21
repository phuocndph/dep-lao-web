"""
Fix double-encoded UTF-8 in deplao-ui source files.

When files were copied from src/ui/ to frontend/deplao-ui/, the UTF-8 bytes
were read as Latin-1 and then re-saved as UTF-8. This script reverses that:
  1. Read file bytes, strip BOM
  2. Decode as UTF-8 (gives double-encoded string)
  3. Encode as Latin-1 (recovers original UTF-8 bytes)
  4. Decode as UTF-8 (gives correct Unicode text)
  5. Write back as UTF-8 without BOM
"""

import os
import sys

TARGET_DIR = r'c:\Users\Lenovo\Downloads\deplao-builder-main (1)\deplao-builder-main\frontend\deplao-ui'
EXTENSIONS = {'.tsx', '.ts', '.css', '.js', '.json', '.md'}

fixed = []
skipped = []
errors = []


def try_fix(text: str):
    """Return fixed text if double-encoded, else None."""
    # Check if text has any non-ASCII (if all ASCII, nothing to fix)
    if all(ord(c) < 128 for c in text):
        return None
    try:
        original_bytes = text.encode('latin-1')
        return original_bytes.decode('utf-8')
    except (UnicodeEncodeError, UnicodeDecodeError):
        pass
    try:
        original_bytes = text.encode('cp1252')
        return original_bytes.decode('utf-8')
    except (UnicodeEncodeError, UnicodeDecodeError):
        pass
    return None


for root, dirs, files in os.walk(TARGET_DIR):
    dirs[:] = [d for d in dirs if d not in ('node_modules', '.git', '__pycache__')]
    for fname in files:
        ext = os.path.splitext(fname)[1].lower()
        if ext not in EXTENSIONS:
            continue
        fpath = os.path.join(root, fname)
        try:
            with open(fpath, 'rb') as f:
                raw = f.read()
            # Strip UTF-8 BOM
            if raw.startswith(b'\xef\xbb\xbf'):
                raw = raw[3:]
            try:
                text = raw.decode('utf-8')
            except UnicodeDecodeError:
                skipped.append(f"[not valid UTF-8] {fname}")
                continue
            result = try_fix(text)
            if result is None or result == text:
                skipped.append(f"[no change] {fname}")
                continue
            # Write back as UTF-8 without BOM, preserving exact line endings (binary)
            with open(fpath, 'wb') as f:
                f.write(result.encode('utf-8'))
            fixed.append(fname)
        except Exception as e:
            errors.append(f"[ERROR] {fname}: {e}")

print(f"Fixed {len(fixed)} files:")
for f in fixed:
    print(f"  + {f}")
print(f"\nSkipped {len(skipped)} files (no change needed or not fixable)")
for s in skipped[:10]:
    print(f"  - {s}")
if len(skipped) > 10:
    print(f"  ... and {len(skipped)-10} more")
if errors:
    print(f"\nErrors ({len(errors)}):")
    for e in errors:
        print(f"  {e}")
