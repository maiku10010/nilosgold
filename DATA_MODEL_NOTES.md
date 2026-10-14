# Historical data and normalized model

## Source mapping

- `dailysales.csv` supplies sale records, cleaned customer names and contacts, source invoice numbers, service descriptions, and the first payment. A sale uses a date-qualified internal ID because invoice numbers repeat. Duplicate date, invoice, and customer rows are consolidated. Summary, week, and repeated-header rows are excluded.
- `collectibles.csv` supplies later payment installments. A matching first installment is not imported twice. Installment dates not present in the sheet remain unknown. Collectibles with no matching daily-sales row create a sale record from the sheet's date, customer, description, and total.
- `jobcosting.csv` supplies gold quantity and price per gram, stone cost, staff labor cost, customer labor charge, and other cost. Staff cost and customer labor charge remain separate exactly as recorded. Job costing totals, gross profit, and margin are calculations, not stored inputs. Employee assignment is nullable for historical records where the sheet has no employee.
- Job-cost rows with a blank source input remain traceable and are flagged as incomplete rather than treating missing source cells as verified zeroes.
- The source `SOP 10%` column is inconsistently populated with amounts, weights, and text. It is not used in cost calculations; nonblank entries are preserved in `sourceNotes` and flagged incomplete for review.
- `goldinventory.csv` is the canonical gold movement source. Gold quantity fields accept only unmarked numeric gram values. Gold Out and Scrap cells marked with a peso symbol are treated as currency amounts, not weights, and skipped as quantities (with skipped-cell count reported by the importer); Gold In gram values remain valid. Blank dates on continuation rows inherit the previous valid movement date. `gold.csv` and `stoneinventory.csv` are skipped because they duplicate the same gold movements and the user confirmed there is no separate stone sheet.
- `expenses.csv` imports dated rows with an amount. Formula/summary blocks and status cells are excluded. Purpose is used as the expense category; description is retained, with a source-row label only when both are absent.
- `totalsales.csv` is excluded because it is a report of totals derived from sales, not a transaction ledger.
- The `dailysales.csv` detail rows sum to ₱3,192,349, while its `Total Contracted Sales` summary says ₱3,194,826 (a ₱2,477 difference). The detail rows are imported as-is; no balancing sale is invented.

## Consolidation and calculated values

- `Sales.payment` is replaced by `SalePayment` rows so downpayments and installments retain their own amount, payment number, method, date when known, and source location. The API returns the summed payment as a compatibility field.
- `Client.balance` is removed because it is the sum of each active sale's unpaid amount. The API computes it from sales and payments.
- Inventory's duplicate `goldIn`, `goldOut`, and `scraps` columns are removed. `quantityIn`, `quantityOut`, and `quantityLoss` are the single movement fields; incoming aliases are accepted only at the API boundary for older callers.
- Stored inventory `balance` and `totalGold` are removed because both are running totals from movement rows. The API calculates balances at read time.
- Inventory-linked expense rows are removed from `expenses` because they duplicated inventory purchase rows. The expenses endpoint derives purchase display rows from inventory `quantityIn × unitPrice`; manually recorded expenses remain in `expenses`.
- Sale/customer names, source invoice/date/status, and source row identifiers are retained as provenance where needed to audit cleaned imports and safely rerun them.
- CSV formulas, running balances, report totals, calculated total cost, gross profit, and margin are not imported as independent facts. The runtime/database relationships are the source of truth for those values.

## Data quality rules

Names and spacing are normalized; phone numbers are reduced to digits and Philippine `+63`/10-digit mobile formats are normalized to `09...`. Invalid dates and non-transaction rows are not assigned invented dates. Imported rows carry source sheet and row metadata so omissions and duplicates can be traced back to the original CSV.
