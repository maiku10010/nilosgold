# Reconciled legacy sheets

The October 15, 2026 business rules supersede the earlier historical import assumptions in DATA_MODEL_NOTES.md. Use `scripts/reconcile_legacy.py` and `npm run import:reconciled` for these ten cleaned source files. The older `import:historical` command expects different original sheets and must not be used for this package.

## Outputs

The builder preserves every source record and writes ten separate reconciled CSVs, a canonical `legacy_invoices.csv`, `migration_records.csv` covering all source cells, and `reconciliation_changes.csv`. UTF-8 BOM supports Excel; empty fields represent null, not zero. JSON payloads use explicit JSON null. Import CSV through Excel's text import with identifier/phone columns set to Text to retain leading zeros.

`legacy_invoices.csv` is the authoritative invoice-level reconciliation. Daily-sales rows retain individual item amounts and recorded downpayments, so a multi-item payment is reconciled once at invoice level. Do not sum repeated invoice identifiers as duplicate transactions or import collection snapshots as additional cash receipts.

## Rules

- LIN identifiers replace INV for this historical dataset. Internal IDs also include date and source row, so repeated invoice numbers do not collide.
- Blank or zero balances imply full settlement. The difference from recorded receipts is an **assumed payment**, never represented as an actual dated cash payment.
- Positive balances are recalculated from price and recorded receipts. Negative balances caused by excess receipts become zero; the excess is classified **Price Change or Tip** without choosing between those explanations.
- Collection snapshots match only a unique customer/amount/date or unique customer/amount. The larger cumulative receipt is used, not the sum of overlapping snapshots. Unmatched/ambiguous snapshots remain in the source archive rather than generating a duplicate sale.
- Completion and payment status are explicit. Negation is checked before `done`/`finished`; `not`, `not yet`, and `dont` mean unfinished. Cash/payment methods alone do not establish product completion.
- Pulled-out invoice LIN-466 retains its identity, description and cancellation status. Its sale, payment, balance, excess and related costing values are null. Original values remain in `original_data`; no transfer to another customer is invented.
- Missing transaction dates use the preceding valid date, or next valid date for an initial missing date. Existing cleaning-log estimates/year corrections are marked as possibly estimated wherever the exact original-to-cleaned row mapping is unavailable. Existing valid dates are not shifted simply to force sorted order.
- Cost totals use recorded gold cost, stone cost, staff labor and other cost. Customer labor charges are not staff costs. Missing cost components remain unknown; available-component sums are labelled incomplete. Gold quantity times unit cost is used only where both are recorded and SOP is absent. SOP is preserved without guessing its units.
- Original hand-typed totals are historical controls, not additional transactions and not proof of current cash received. Assumed payments must not enter cashflow reports.
- All inventory records are preserved as **Inventory Deferred**. No stock movements, customer-gold ownership splits, or inventory valuations are posted.

## Schema and import boundary

The additive migration creates `legacy_invoices` with typed dates, decimal amounts, permitted statuses and arithmetic/null constraints, and `legacy_sheet_rows` with original/cleaned JSON, source hashes, source rows and invoice links. Prisma models mirror these tables. Both have RLS enabled and no public/client grants.

These tables preserve the full historical package without duplicating existing live sales or inventories. They do **not** automatically populate the application's operational sales, job-cost, expense or payment tables. Moving reconciled historical records into those existing ledgers requires matching against the data already imported there. This separation also allows nullable pulled-out records without weakening the live sale model.

```powershell
python scripts/reconcile_legacy.py --source 'F:/Downloads/files' --output outputs/legacy-reconciliation-2026-10-15
npm run import:reconciled -- outputs/legacy-reconciliation-2026-10-15
```

The second command validates without connecting to the database. After the SQL migration is applied, append `--apply` to load the historical tables. It runs in a single transaction, checks exact repeat imports, rejects changed existing records, and performs no operational/inventory writes. Original source files are never modified. Output files contain customer data and are ignored by Git.
