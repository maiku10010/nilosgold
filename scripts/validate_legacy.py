"""Validate the exported CSV package independently of reconciliation."""
import csv
import hashlib
import json
import sys
from collections import Counter
from decimal import Decimal
from pathlib import Path

def read(path):
    with path.open(encoding='utf-8-sig', newline='') as handle:
        return list(csv.DictReader(handle))

def validate(folder, source):
    report = json.loads((folder / 'validation_summary.json').read_text())
    records = read(folder / 'migration_records.csv')
    invoices = read(folder / 'legacy_invoices.csv')
    assert len(records) == report['preserved_rows']
    assert len(invoices) == report['legacy_invoices']
    assert len({r['record_id'] for r in records}) == len(records)
    assert len({r['record_id'] for r in invoices}) == len(invoices)
    counts = Counter(r['source_file'] for r in records)
    assert dict(counts) == report['source_rows']
    for filename, count in counts.items():
        assert len(read(folder / filename.replace('.csv', '_reconciled.csv'))) == count
        assert hashlib.sha256((source / filename).read_bytes()).hexdigest() == report['source_sha256'][filename]
    originals = {f: read(source / f) for f in counts}
    ids = {i['record_id'] for i in invoices}
    for r in records:
        assert json.loads(r['original_data']) == originals[r['source_file']][int(r['source_row']) - 2]
        payload = json.loads(r['cleaned_data'])
        assert not r['invoice_record_id'] or r['invoice_record_id'] in ids
        assert r['source_sha256'] == report['source_sha256'][r['source_file']]
        if r['source_file'] in ('gold_clean.csv', 'goldinventory_clean.csv', 'stoneinventory_clean.csv'):
            assert payload['Processing'] == 'Inventory Deferred'
    fields = ('sale_price','recorded_payment','assumed_payment','reconciled_payment','balance','excess_payment')
    for inv in invoices:
        assert inv['legacy_invoice'].startswith('LIN-')
        if inv['pulled_out'] == 'True':
            assert inv['status'] == 'Cancelled'
            assert all(inv[f] == '' for f in fields)
            continue
        values = {f: Decimal(inv[f]) if inv[f] else None for f in fields}
        assert all(v is None or v >= 0 for v in values.values())
        if values['sale_price'] is not None:
            p, r, a, t, b, e = [values[f] for f in fields]
            assert t == r + a
            assert b == max(p - t, 0)
            assert e == max(r - p, 0)
            assert (inv['excess_classification'] == 'Price Change or Tip') == (e > 0)
            if inv['status'].startswith('Fully Paid'):
                assert b == 0
    pulled_cost = [json.loads(r['cleaned_data']) for r in records if r['source_file'] == 'jobcosting_clean.csv' and json.loads(r['cleaned_data']).get('Legacy Invoice') == 'LIN-466']
    assert pulled_cost and all(r['Total Cost'] is None and r['Selling Price'] is None for r in pulled_cost)
    print(f'PASS: {len(records)} source rows preserved; {len(invoices)} invoices reconciled; source hashes unchanged; pulled-out nulls and inventory deferral verified.')

if __name__ == '__main__':
    validate(Path(sys.argv[1]), Path(sys.argv[2]))
