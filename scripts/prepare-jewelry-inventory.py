"""Extract the reviewed two-page jewelry PDF into a repeatable, insert-only SQL import."""
import hashlib
import json
import pathlib
import sys
from pypdf import PdfReader

source = pathlib.Path(sys.argv[1])
destination = pathlib.Path(sys.argv[2])
digest = hashlib.sha256(source.read_bytes()).hexdigest()
sections = {
    '1. Birthstones and Colored Stones': ('Birthstones and Colored Stones', 'GEMSTONES'),
    '2. Boxes with Logo': ('Boxes with Logo', 'BOXES'),
    '3. Moissanite': ('Moissanite', 'GEMSTONES'),
    '4. Lab-Grown Diamonds': ('Lab-Grown Diamonds', 'GEMSTONES'),
    '5. Titus and Natural Diamonds': ('Titus and Natural Diamonds', 'GEMSTONES'),
}
rows = []
section = None
for page in PdfReader(source).pages:
    lines = [line.strip() for line in page.extract_text().splitlines()]
    for index, line in enumerate(lines):
        if line in sections:
            section = sections[line]
        if line.isdigit() and index and index + 1 < len(lines) and lines[index + 1].startswith('___'):
            assert section, 'Missing section'
            description = lines[index - 1].replace('\ufffd', '-')
            rows.append({'row': len(rows) + 1, 'section': section[0], 'category': section[1],
                         'description': description, 'quantity': int(line)})
assert len(rows) == 36, f'Expected 36 entries, got {len(rows)}'
assert sum(row['quantity'] for row in rows) == 523
def literal(value):
    return "'" + str(value).replace("'", "''") + "'"
values = []
for row in rows:
    reference = f"pdf-{digest[:12]}-{row['row']:03d}"
    values.append('(' + ', '.join([
        literal(reference), literal(reference), literal(row['section'] + ' - ' + row['description']),
        literal(row['category']), "'pieces'", str(row['quantity']), '0', '0', 'NULL',
        'NULL',
    ]) + ')')
sql = f'''-- Source SHA256: {digest}
-- 36 source rows, 523 pieces. No source date or prices were supplied.
-- Separate source entries (including Yellow and Titus) retain separate IDs.
-- Existing inventory is never replaced. Repeating this import inserts no duplicates.
BEGIN;
INSERT INTO public.inventory
  ("referenceId", universal_reference_id, "itemName", category, unit,
   "quantityIn", "quantityOut", "quantityLoss", "unitPrice", source_date)
VALUES
''' + ',\n'.join(values) + '\nON CONFLICT ("referenceId") DO NOTHING;\nCOMMIT;\n'
destination.parent.mkdir(parents=True, exist_ok=True)
destination.write_text(sql, encoding='utf-8')
print(json.dumps({'rows': len(rows), 'pieces': sum(row['quantity'] for row in rows),
                  'sections': {name: sum(row['quantity'] for row in rows if row['section'] == name)
                               for name, _ in sections.values()}}))

