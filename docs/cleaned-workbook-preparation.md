# Cleaned workbook review and migration preparation

This workflow prepares local data only. It does not execute SQL, upload data, or create an automatically applied migration. Financial and customer data stays under ignored `outputs/`.

## Reproduce the comparison

1. Extract the supplied workbook using `scripts/extract-workbook.py INPUT.xlsx outputs/cleaned-review/source.json` with the bundled Python runtime. The original workbook is unchanged.
2. Capture `node scripts/workbook-snapshot.cjs outputs/cleaned-review/system-snapshot.json`. This uses a repeatable-read, read-only database transaction. The destination must not already exist.
3. Run `node scripts/review-cleaned-workbook.cjs outputs/cleaned-review outputs/workbook-import-20261016`.

The prior import directory must contain its original `source.json`, `before.json`, and `plan.json`. Its source hash is checked against the manifest. This is a comparison against that specific historical import, not a general workbook importer. Do not use it for a workbook with reordered rows or a different layout. Source provenance and existing primary keys are checked before staging changes.

Outputs:

- `review.json`: source cell differences, supported changes, withheld changes, system edits since import, cached formula errors, inconsistent cost references, duplicate-name candidates, and source issue diagnostics.
- `proposed-patches.json`: proposed field changes with existing IDs, before/after values, evidence, and hashes.
- `prepared-data.json`: corrected copy of the selected business tables, retaining all rows and all financial amounts. This is not a full database backup or directly executable import file.

The legacy parser is used only to reconstruct differences and produce diagnostics. Its row-specific assumptions, inferred payments, and proposed inventory replacement are not executed. Workbook cached formula errors are reported without claiming recalculation. Never pass diagnostic results to `apply-workbook-import.cjs`.

## Rules for the eventual migration

- Resolve withheld financial changes against receipts. Replacing `paid` with zero in a balance cell must not erase recorded settlement payments.
- Retain IDs even when correcting dates. Keep application-created records, newer system edits, inventory movements, scrap allocations, and inquiry links.
- Obtain a fresh backup and compare every affected full row and dependent financial record against the reviewed snapshot. IDs alone do not detect changed values.
- Apply only explicitly reviewed fields in a transaction with locks and expected-value predicates. Require exactly one affected row per patch; roll back on any mismatch.
- Retain a reverse patch with original values, guarded against subsequent changes. Reconcile counts, payment totals, invoice totals, expenses, links, statuses, and inventory after applying.
- No schema change is required for the currently staged date, status, and payment-method corrections. Keep future SQL outside the automatically applied migrations directory until migration is authorized.

Validation: `node --test tests/cleaned-workbook-review.test.cjs`. Tests cover preservation of settlements, live-edit conflicts, date changes, stable IDs, and non-mutation of input snapshots.

## Verify against a fresh database snapshot

Capture a new read-only snapshot as `outputs/cleaned-review/verification-snapshot.json`, then run `node scripts/verify-prepared-data.cjs outputs/cleaned-review`.

This verifies source/snapshot hashes, checks every field in the nine captured business tables against the documented patches, rejects changes to affected full rows, checks relational links, and reconciles counts, nulls, and exact decimal totals without floating-point arithmetic. Inventory quantities are grouped by category, purity, and unit. Monthly amounts are reported separately because a date correction can move a transaction between months while preserving the grand total.

`verification.json` records all checks and any intervening system changes. On success, `prepared-data-verified.json` preserves newly added unrelated records and contains only the reviewed changes. Earlier evidence files remain untouched. `OFFLINE_COPY_VERIFIED` means the local copy preserves the captured database apart from the listed corrections; it does not mean the workbook is reconciled or a database migration has occurred. This is not an apply command. A later write must re-check live state transactionally.

Run `node --test tests/prepared-data-verification.test.cjs` for precision, equal-total row tampering, new records, concurrent edits, broken links, and prohibited financial changes.
