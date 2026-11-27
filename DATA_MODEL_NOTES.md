# Data model

Sales use SalePayment rows for installments. Client balances, inventory balances, job totals, and profit are calculated from operational records.

## Gold karats

Inquiries, job costing, and inventory expose optional Prisma goldKarat, stored as gold_karat (smallint). Every whole-number karat from 10 to 24 is supported. SQL CHECK constraints enforce the range and permit inventory karats only for GOLD.

NULL means unspecified. Each costing or inventory movement records one karat. API input handling, inquiry-to-job propagation, UI selectors, pricing, and stock aggregation by karat still require application changes. Apply the gold-karat migration before deploying the regenerated Prisma client; prisma db push alone does not install CHECK constraints.

## Removed import support

The remove_legacy_import_support migration drops the legacy staging tables and import-only source metadata. It preserves operational clients, sales, payments, job costs, expenses, inventory rows, and gold karats. Existing migration history is retained so previously deployed databases can migrate forward.


All job services calculate labor as 30% of the linked inquiry quote, rounded to
cents. Jobs without an inquiry use the saved invoice price. Historical job and
profit views recalculate labor where a price is available. Approval reversals
restore the original saved labor. Job staff attribution uses the existing empId
relationship.
Gold source is required for Custom. Repair and Resize may omit it (or pass null/empty);
these jobs retain entered material costs but do not deduct stock or recover scrap.
Supplying a source retains the existing karat and inventory balance validation.
Cleaning continues to exclude gold fields.
