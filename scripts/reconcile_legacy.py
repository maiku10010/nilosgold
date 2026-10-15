"""Reconcile supplied CSVs without changing the source files or posting inventory.

Money uses Decimal. Empty CSV fields represent SQL NULL. Original cells are kept
in migration_records.csv; business assumptions are separate from cash receipts.
"""
import argparse
import csv
import hashlib
import json
import re
import unicodedata
from collections import Counter, defaultdict
from datetime import date
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path

FILES = ['dailysales_clean.csv', 'collectibles_clean.csv', 'jobcosting_clean.csv',
         'expenses_clean.csv', 'gold_clean.csv', 'goldinventory_clean.csv',
         'stoneinventory_clean.csv', 'totalsales_clean.csv',
         'summary_handtyped_totals.csv', 'cleaning_log.csv']
INVENTORY = set(FILES[4:7])
CENT = Decimal('0.01')
ZERO = Decimal(0)

def text(value):
    return re.sub(r'\s+', ' ', unicodedata.normalize('NFC', str(value or ''))).strip()

def number(value):
    value = text(value)
    if not value or value.lower() == 'null' or value in ('#DIV/0!', '#VALUE!', '#REF!', '#N/A'):
        return None
    if not re.fullmatch(r'-?\d+(?:\.\d+)?%?', value):
        raise ValueError(f'Invalid numeric cell: {value!r}')
    result = Decimal(value.rstrip('%'))
    if not result.is_finite():
        raise ValueError('Non-finite number')
    return result

def money(value):
    return format(value.quantize(CENT, rounding=ROUND_HALF_UP), '.2f') if value is not None else ''

def valid_date(value):
    try:
        parsed = date.fromisoformat(value)
        return parsed if 2020 <= parsed.year <= 2026 else None
    except (ValueError, TypeError):
        return None

def key(value):
    return re.sub(r'[^\w]+', ' ', text(value).casefold()).strip()

def status(raw, paid, price, cancelled=False):
    raw = text(raw).casefold().replace('’', '').replace("'", '')
    if cancelled or 'cancel' in raw:
        return 'Cancelled'
    unfinished = raw in ('not', 'not yet', 'dont') or bool(re.search(r'not(?: yet)? (?:done|finish)|not finish', raw))
    finished = not unfinished and (bool(re.search(r'\bdone\b|\bfinished\b', raw)) or ('taken' in raw and 'not taken' not in raw) or raw in ('dome', 'domne'))
    full = price is not None and paid is not None and paid >= price
    if unfinished:
        return 'Fully Paid, Unfinished Product' if full else 'Not Yet Finished'
    if finished:
        return 'Fully Paid, Finished Product' if full else 'Finished Product, Unpaid'
    return 'Fully Paid, Product Status Unknown' if full else 'Unpaid, Product Status Unknown'

def financial(price, recorded, balance):
    if price is None:
        return None, None, None, None
    if price < 0 or recorded < 0:
        raise ValueError('Negative sale/payment/balance needs a refund workflow')
    # Explicit user rule wins over contradictory source status/notes.
    assumed = max(price - recorded, ZERO) if balance in (None, ZERO) else ZERO
    paid = recorded + assumed
    return paid, max(price - paid, ZERO), assumed, max(recorded - price, ZERO)

def write_csv(path, rows, fields=None):
    fields = fields or list(dict.fromkeys(k for row in rows for k in row))
    with path.open('w', newline='', encoding='utf-8-sig') as handle:
        writer = csv.DictWriter(handle, fields, lineterminator='\n')
        writer.writeheader()
        writer.writerows(rows)

def reconcile(source, output):
    output.mkdir(parents=True, exist_ok=True)
    raw, clean, hashes = {}, {}, {}
    audit = []
    def log(file, row, field, old, new, reason):
        audit.append({'Source File': file, 'Source Row': row, 'Field': field,
                      'Original': old, 'Reconciled': new, 'Reason': reason})

    for filename in FILES:
        path = source / filename
        hashes[filename] = hashlib.sha256(path.read_bytes()).hexdigest()
        with path.open(encoding='utf-8-sig', newline='') as handle:
            reader = csv.DictReader(handle)
            if not reader.fieldnames or len(set(reader.fieldnames)) != len(reader.fieldnames):
                raise ValueError(f'{filename}: missing/duplicate headers')
            rows = list(reader)
            if any(None in r or None in r.values() for r in rows):
                raise ValueError(f'{filename}: inconsistent column count')
        raw[filename] = rows
        clean[filename] = []
        for rownum, original in enumerate(rows, 2):
            row = {k: text(v) for k, v in original.items()}
            row['Source Row'] = str(rownum) if filename != 'cleaning_log.csv' else row.get('Source Row', '')
            row['Processing'] = 'Inventory Deferred' if filename in INVENTORY else 'Reconciled'
            for name in ('Client Name', 'Client'):
                if name in row:
                    row[name] = row[name].title()
            if 'Contact No.' in row:
                phone = re.sub(r'[\s()+-]', '', row['Contact No.'])
                if re.fullmatch(r'639\d{9}', phone):
                    phone = '0' + phone[2:]
                elif re.fullmatch(r'9\d{9}', phone):
                    phone = '0' + phone
                if phone and not re.fullmatch(r'09\d{9}', phone):
                    log(filename, rownum, 'Contact No.', phone, '', 'Invalid mobile number preserved in original data')
                    phone = ''
                row['Contact No.'] = phone
            if 'Invoice #' in row:
                row['Legacy Invoice'] = 'LIN-' + (row['Invoice #'] or f'ROW-{rownum}')
            clean[filename].append(row)

    # Preserve prior date estimates and explicitly identify their uncertainty.
    estimated_by_file = defaultdict(set)
    for entry in raw['cleaning_log.csv']:
        if entry['Field'] == 'Date' and ('previous row' in entry['Note'] or
             re.search(r'1900|2006|2025|2028', entry['Original'])):
            estimated_by_file[entry['File'].replace('.csv', '_clean.csv')].add(entry['Cleaned To'])
    for filename, rows in clean.items():
        if filename in INVENTORY or filename == 'cleaning_log.csv':
            continue
        previous = None
        for index, row in enumerate(rows):
            if 'Date' not in row:
                continue
            current = valid_date(row['Date'])
            # Blank dates on aggregate reports are intentional, not transactions.
            if filename == 'summary_handtyped_totals.csv' and not row['Date']:
                continue
            if current is None:
                following = next((valid_date(r.get('Date')) for r in rows[index + 1:] if valid_date(r.get('Date'))), None)
                estimate = previous or following
                row['Date'] = estimate.isoformat() if estimate else ''
                row['Date Basis'] = 'Estimated from adjacent dated record' if estimate else 'Unknown'
            elif row['Date'] in estimated_by_file[filename]:
                row['Date Basis'] = 'Possibly estimated in supplied cleaning log; original row mapping unavailable'
            else:
                row['Date Basis'] = 'As supplied'
            if current or row['Date']:
                previous = current or valid_date(row['Date'])
            if filename == 'expenses_clean.csv':
                row['Month'] = row['Date'][:7]

    # Group explicit breakdown rows with their invoice. Sum distinct item prices,
    # then compare receipts once at invoice level (e.g. invoice 39).
    groups = defaultdict(list)
    daily = clean['dailysales_clean.csv']
    for row in daily:
        groups[(row['Legacy Invoice'], row['Date'], key(row['Client Name']))].append(row)
    pulled = set()
    invoices = []
    for (label, day, customer), rows in groups.items():
        original_price = [number(r['Total Price']) for r in rows]
        price = sum((v for v in original_price if v is not None), ZERO) if all(v is not None for v in original_price) else None
        receipts = sum((number(r['Dp Today']) or ZERO for r in rows), ZERO)
        balances = [number(r['Balance']) for r in rows]
        balance = sum((b for b in balances if b is not None), ZERO) if any(b is not None for b in balances) else None
        pulled_out = label == 'LIN-466' or any(re.search(r'pull[ -]?out|pulled out', r['Notes'] + ' ' + r['Status'], re.I) for r in rows)
        cancelled = pulled_out or any('cancel' in r['Status'].lower() for r in rows)
        paid, remaining, assumed, excess = financial(price, receipts, balance)
        statuses = [status(r['Status'], paid, price, cancelled) for r in rows]
        normalized = next((s for s in statuses if s in ('Fully Paid, Unfinished Product', 'Not Yet Finished')), statuses[0])
        ident = f'{label}-{day.replace("-", "")}-R{rows[0]["Source Row"]}'
        if pulled_out:
            pulled.add(label)
            price = paid = remaining = assumed = excess = None
            receipts = None
        inv = {'record_id': ident, 'legacy_invoice': label, 'source_file': 'dailysales_clean.csv',
               'source_row': int(rows[0]['Source Row']), 'invoice_date': day or None,
               'date_estimated': any(r['Date Basis'] != 'As supplied' for r in rows),
               'customer_name': rows[0]['Client Name'], 'description': '; '.join(r['Type'] for r in rows),
               'status': 'Cancelled' if cancelled else normalized, 'pulled_out': pulled_out,
               'sale_price': money(price) or None, 'recorded_payment': money(receipts) or None,
               'assumed_payment': money(assumed) or None, 'reconciled_payment': money(paid) or None,
               'balance': money(remaining) or None, 'excess_payment': money(excess) or None,
               'excess_classification': 'Price Change or Tip' if excess else None}
        invoices.append(inv)
        for row in rows:
            row['Invoice Record ID'] = ident
            row['Status'] = 'Cancelled' if cancelled else status(row['Status'], paid, price)
            row['Payment Basis'] = 'Assumed Fully Paid' if assumed else 'Recorded Payments'
            row['Processing'] = 'Pulled Out' if pulled_out else 'Reconciled'
            # Invoice-level reconciliations live in legacy_invoices.csv, not
            # repeated on every line where a future sum would double count.
            for field in ('Total Price', 'Dp Today', 'Balance'):
                row[field] = '' if pulled_out else money(number(row[field]))
            if len(rows) == 1:
                row['Balance'] = money(remaining)
            if pulled_out:
                row['Payment Method'] = ''
                row['Payment Basis'] = ''

    # Collection sheets are snapshots, not additional invoices or cash receipts.
    # Merge only a unique exact customer + amount + date match (or unique
    # customer + amount). Never fuzzy-merge names or add the first payment twice.
    for row in clean['collectibles_clean.csv']:
        price = number(row['Total Amount'])
        recorded = sum((number(row[f]) or ZERO for f in ('1st Payment', '2nd Payment', '3rd Payment', '4th Payment')), ZERO)
        paid, balance, assumed, excess = financial(price, recorded, number(row['Balance']))
        candidates = [i for i in invoices if not i['pulled_out'] and key(i['customer_name']) == key(row['Client Name']) and i['sale_price'] == money(price)]
        dated = [i for i in candidates if i['invoice_date'] == row['Date']]
        matches = dated or candidates
        if len(matches) == 1:
            inv = matches[0]
            # Snapshot records can cover earlier receipts already in daily sales.
            # Keep the larger documented cumulative receipt, not their sum.
            recorded = max(recorded, number(inv['recorded_payment']) or ZERO)
            paid, balance, assumed, excess = financial(price, recorded, number(row['Balance']))
            inv.update(recorded_payment=money(recorded), assumed_payment=money(assumed), reconciled_payment=money(paid), balance=money(balance), excess_payment=money(excess),
                       excess_classification='Price Change or Tip' if excess else None,
                       status=status(row['Status'], paid, price))
            row['Invoice Record ID'] = inv['record_id']
            row['Match Basis'] = 'Unique customer and amount' + (' and date' if dated else '')
        else:
            row['Invoice Record ID'] = ''
            row['Match Basis'] = 'Unmatched snapshot' if not matches else 'Ambiguous snapshot; not posted'
        row['Recorded Payment'] = money(recorded)
        row['Assumed Payment'] = money(assumed)
        row['Reconciled Payment'] = money(paid)
        row['Balance'] = money(balance)
        row['Excess Payment'] = money(excess)
        row['Status'] = status(row['Status'], paid, price)
        for field in ('Total Amount', '1st Payment', '2nd Payment', '3rd Payment', '4th Payment'):
            row[field] = money(number(row[field]))

    # Propagate the reconciled invoice status/balance back after collection matching.
    by_id = {i['record_id']: i for i in invoices}
    for rows in groups.values():
        inv = by_id[rows[0]['Invoice Record ID']]
        for row in rows:
            row['Status'] = inv['status']
            if not inv['pulled_out']:
                row['Payment Basis'] = 'Assumed Fully Paid' if number(inv['assumed_payment']) else 'Recorded Payments'
        if len(rows) == 1:
            rows[0]['Balance'] = inv['balance'] or ''

    numeric_costs = ['Gold grams', 'Gold cost/gram', 'Gold Cost', 'Stone Cost', 'Labor Cost', 'Total Labor Cost', 'Other Cost', 'Total Cost', 'Selling Price', 'Gross Profit', 'Margin %']
    for row in clean['jobcosting_clean.csv']:
        if row['Legacy Invoice'] in pulled:
            for field in numeric_costs + ['SOP 10%']:
                row[field] = ''
            row['Processing'] = 'Pulled Out'
            continue
        nums = {field: number(row[field]) for field in numeric_costs}
        gold = nums['Gold Cost']
        # Do not infer customer gold ownership, splits, or SOP units.
        if nums['Gold grams'] is not None and nums['Gold cost/gram'] is not None and not row['SOP 10%']:
            gold = (nums['Gold grams'] * nums['Gold cost/gram']).quantize(CENT, rounding=ROUND_HALF_UP)
            row['Gold Cost'] = money(gold)
        components = [gold, nums['Stone Cost'], nums['Labor Cost'], nums['Other Cost']]
        cost = sum((v for v in components if v is not None), ZERO)
        # A known total with no underlying inputs cannot be reconstructed.
        if any(v is not None for v in components):
            row['Total Cost'] = money(cost)
            price = nums['Selling Price']
            row['Gross Profit'] = money(price - cost) if price is not None else ''
            row['Margin %'] = money((price - cost) / price * 100) + '%' if price else ''
        row['Cost Basis'] = 'Available recorded costs; missing components remain unknown' if any(v is None for v in components) else 'Complete recorded components'
        if row['SOP 10%']:
            row['Cost Basis'] += '; SOP preserved without unit inference'
        for field in numeric_costs:
            if field not in ('Margin %', 'Gold grams'):
                row[field] = money(number(row[field]))

    for row in clean['expenses_clean.csv']:
        row['Amount'] = money(number(row['Amount']))
    # Historical reported totals remain reference controls. They are not cash
    # transactions, especially now that assumed settlements differ from receipts.
    for filename in ('totalsales_clean.csv', 'summary_handtyped_totals.csv'):
        for row in clean[filename]:
            row['Amount'] = money(number(row['Amount']))
            row['Processing'] = 'Historical Reference Only'

    records = []
    for filename in FILES:
        for rownum, (original, row) in enumerate(zip(raw[filename], clean[filename]), 2):
            for field, value in row.items():
                if field in original and value != original[field]:
                    log(filename, rownum, field, original[field], value, 'Business-rule reconciliation or text/number normalization')
            # JSON null makes SQL semantics explicit; source retains exact strings.
            payload = {k: (v if v != '' else None) for k, v in row.items()}
            records.append({'record_id': f'{filename}:{rownum}', 'source_file': filename,
                            'source_row': rownum, 'source_sha256': hashes[filename],
                            'processing': row['Processing'],
                            'invoice_record_id': row.get('Invoice Record ID', '') or '',
                            'original_data': json.dumps(original, ensure_ascii=False),
                            'cleaned_data': json.dumps(payload, ensure_ascii=False)})
        write_csv(output / filename.replace('.csv', '_reconciled.csv'), clean[filename])
    write_csv(output / 'legacy_invoices.csv', invoices)
    write_csv(output / 'migration_records.csv', records)
    write_csv(output / 'reconciliation_changes.csv', audit)
    summary = {'source_rows': {f: len(raw[f]) for f in FILES}, 'preserved_rows': len(records),
               'legacy_invoices': len(invoices), 'changes': len(audit),
               'pulled_out': sum(i['pulled_out'] for i in invoices),
               'statuses': dict(Counter(i['status'] for i in invoices)),
               'recorded_payments': money(sum((number(i['recorded_payment']) or ZERO for i in invoices), ZERO)),
               'assumed_payments': money(sum((number(i['assumed_payment']) or ZERO for i in invoices), ZERO)),
               'excess_payments': money(sum((number(i['excess_payment']) or ZERO for i in invoices), ZERO)),
               'unmatched_collection_snapshots': sum(not r['Invoice Record ID'] for r in clean['collectibles_clean.csv']),
               'inventory_posted': 0, 'source_sha256': hashes}
    (output / 'validation_summary.json').write_text(json.dumps(summary, indent=2), encoding='utf-8')
    return summary

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.source.resolve() == args.output.resolve():
        raise SystemExit('Output must be separate from source')
    print(json.dumps(reconcile(args.source, args.output), indent=2))
