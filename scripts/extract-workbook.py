"""Read workbook source cells and cached formulas without modifying the source."""
import datetime
import hashlib
import json
import pathlib
import sys
import openpyxl

source, output = map(pathlib.Path, sys.argv[1:3])
values = openpyxl.load_workbook(source, data_only=True)
formulas = openpyxl.load_workbook(source, data_only=False)
def serialize(value):
    if isinstance(value, (datetime.datetime, datetime.date, datetime.time)):
        return value.isoformat()
    return value
data = {'sha256': hashlib.sha256(source.read_bytes()).hexdigest(), 'sheets': {}}
for sheet in values:
    rows = []
    for cells in sheet:
        if not any(c.value is not None for c in cells):
            continue
        rows.append({'row': cells[0].row, 'values': [serialize(c.value) for c in cells],
                     'formulas': {c.column_letter: str(formulas[sheet.title][c.coordinate].value)
                                  for c in cells if formulas[sheet.title][c.coordinate].data_type == 'f'}})
    data['sheets'][sheet.title] = rows
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(data, indent=2), encoding='utf-8')
for name, rows in data['sheets'].items():
    print(name, len(rows), 'nonempty rows')
