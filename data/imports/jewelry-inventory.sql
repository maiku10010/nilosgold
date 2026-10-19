-- Source SHA256: 52b851b0cad7c7aa3fe55e3f14238ac5282e692ec675784effb43ce4903bfd41
-- 36 source rows, 523 pieces. No source date or prices were supplied.
-- Separate source entries (including Yellow and Titus) retain separate IDs.
-- Existing inventory is never replaced. Repeating this import inserts no duplicates.
BEGIN;
INSERT INTO public.inventory
  ("referenceId", universal_reference_id, "itemName", category, unit,
   "quantityIn", "quantityOut", "quantityLoss", "unitPrice", source_date)
VALUES
('pdf-52b851b0cad7-001', 'pdf-52b851b0cad7-001', 'Birthstones and Colored Stones - Blue', 'GEMSTONES', 'pieces', 5, 0, 0, NULL, NULL),
('pdf-52b851b0cad7-002', 'pdf-52b851b0cad7-002', 'Birthstones and Colored Stones - Light Blue', 'GEMSTONES', 'pieces', 10, 0, 0, NULL, NULL),
('pdf-52b851b0cad7-003', 'pdf-52b851b0cad7-003', 'Birthstones and Colored Stones - Dark Blue', 'GEMSTONES', 'pieces', 4, 0, 0, NULL, NULL),
('pdf-52b851b0cad7-004', 'pdf-52b851b0cad7-004', 'Birthstones and Colored Stones - Purple', 'GEMSTONES', 'pieces', 9, 0, 0, NULL, NULL),
('pdf-52b851b0cad7-005', 'pdf-52b851b0cad7-005', 'Birthstones and Colored Stones - Dark Pink', 'GEMSTONES', 'pieces', 4, 0, 0, NULL, NULL),
('pdf-52b851b0cad7-006', 'pdf-52b851b0cad7-006', 'Birthstones and Colored Stones - Green', 'GEMSTONES', 'pieces', 5, 0, 0, NULL, NULL),
('pdf-52b851b0cad7-007', 'pdf-52b851b0cad7-007', 'Birthstones and Colored Stones - Yellow', 'GEMSTONES', 'pieces', 10, 0, 0, NULL, NULL),
('pdf-52b851b0cad7-008', 'pdf-52b851b0cad7-008', 'Birthstones and Colored Stones - Red', 'GEMSTONES', 'pieces', 6, 0, 0, NULL, NULL),
('pdf-52b851b0cad7-009', 'pdf-52b851b0cad7-009', 'Birthstones and Colored Stones - White', 'GEMSTONES', 'pieces', 40, 0, 0, NULL, NULL),
('pdf-52b851b0cad7-010', 'pdf-52b851b0cad7-010', 'Birthstones and Colored Stones - Yellow (second entry)', 'GEMSTONES', 'pieces', 8, 0, 0, NULL, NULL),
('pdf-52b851b0cad7-011', 'pdf-52b851b0cad7-011', 'Birthstones and Colored Stones - Black', 'GEMSTONES', 'pieces', 3, 0, 0, NULL, NULL),
('pdf-52b851b0cad7-012', 'pdf-52b851b0cad7-012', 'Birthstones and Colored Stones - Blue Green', 'GEMSTONES', 'pieces', 6, 0, 0, NULL, NULL),
('pdf-52b851b0cad7-013', 'pdf-52b851b0cad7-013', 'Birthstones and Colored Stones - Medium Pink', 'GEMSTONES', 'pieces', 3, 0, 0, NULL, NULL),
('pdf-52b851b0cad7-014', 'pdf-52b851b0cad7-014', 'Birthstones and Colored Stones - Big Oval Stone – Yellow Green', 'GEMSTONES', 'pieces', 3, 0, 0, NULL, NULL),
('pdf-52b851b0cad7-015', 'pdf-52b851b0cad7-015', 'Birthstones and Colored Stones - Big Oval Stone – Pink', 'GEMSTONES', 'pieces', 1, 0, 0, NULL, NULL),
('pdf-52b851b0cad7-016', 'pdf-52b851b0cad7-016', 'Birthstones and Colored Stones - Big Oval Stone – White Round', 'GEMSTONES', 'pieces', 1, 0, 0, NULL, NULL),
('pdf-52b851b0cad7-017', 'pdf-52b851b0cad7-017', 'Birthstones and Colored Stones - Big Oval Stone – Green', 'GEMSTONES', 'pieces', 4, 0, 0, NULL, NULL),
('pdf-52b851b0cad7-018', 'pdf-52b851b0cad7-018', 'Birthstones and Colored Stones - Assorted Small Stones', 'GEMSTONES', 'pieces', 69, 0, 0, NULL, NULL),
('pdf-52b851b0cad7-019', 'pdf-52b851b0cad7-019', 'Birthstones and Colored Stones - Cat''s Eye', 'GEMSTONES', 'pieces', 4, 0, 0, NULL, NULL),
('pdf-52b851b0cad7-020', 'pdf-52b851b0cad7-020', 'Birthstones and Colored Stones - Big Pearl', 'GEMSTONES', 'pieces', 2, 0, 0, NULL, NULL),
('pdf-52b851b0cad7-021', 'pdf-52b851b0cad7-021', 'Birthstones and Colored Stones - Rice Pearl', 'GEMSTONES', 'pieces', 16, 0, 0, NULL, NULL),
('pdf-52b851b0cad7-022', 'pdf-52b851b0cad7-022', 'Boxes with Logo - Single Ring Box', 'BOXES', 'pieces', 24, 0, 0, NULL, NULL),
('pdf-52b851b0cad7-023', 'pdf-52b851b0cad7-023', 'Boxes with Logo - Wedding Ring Box', 'BOXES', 'pieces', 23, 0, 0, NULL, NULL),
('pdf-52b851b0cad7-024', 'pdf-52b851b0cad7-024', 'Boxes with Logo - Bracelet Box', 'BOXES', 'pieces', 26, 0, 0, NULL, NULL),
('pdf-52b851b0cad7-025', 'pdf-52b851b0cad7-025', 'Boxes with Logo - Earrings Box', 'BOXES', 'pieces', 20, 0, 0, NULL, NULL),
('pdf-52b851b0cad7-026', 'pdf-52b851b0cad7-026', 'Moissanite - Oval Moissanite', 'GEMSTONES', 'pieces', 4, 0, 0, NULL, NULL),
('pdf-52b851b0cad7-027', 'pdf-52b851b0cad7-027', 'Moissanite - Round, Half Carat', 'GEMSTONES', 'pieces', 2, 0, 0, NULL, NULL),
('pdf-52b851b0cad7-028', 'pdf-52b851b0cad7-028', 'Moissanite - Cushion Cut', 'GEMSTONES', 'pieces', 5, 0, 0, NULL, NULL),
('pdf-52b851b0cad7-029', 'pdf-52b851b0cad7-029', 'Moissanite - 1 Carat', 'GEMSTONES', 'pieces', 10, 0, 0, NULL, NULL),
('pdf-52b851b0cad7-030', 'pdf-52b851b0cad7-030', 'Moissanite - 2 Carat', 'GEMSTONES', 'pieces', 10, 0, 0, NULL, NULL),
('pdf-52b851b0cad7-031', 'pdf-52b851b0cad7-031', 'Lab-Grown Diamonds - 2 Carat', 'GEMSTONES', 'pieces', 2, 0, 0, NULL, NULL),
('pdf-52b851b0cad7-032', 'pdf-52b851b0cad7-032', 'Lab-Grown Diamonds - 1 Carat', 'GEMSTONES', 'pieces', 2, 0, 0, NULL, NULL),
('pdf-52b851b0cad7-033', 'pdf-52b851b0cad7-033', 'Lab-Grown Diamonds - Teardrop', 'GEMSTONES', 'pieces', 2, 0, 0, NULL, NULL),
('pdf-52b851b0cad7-034', 'pdf-52b851b0cad7-034', 'Titus and Natural Diamonds - Titus', 'GEMSTONES', 'pieces', 47, 0, 0, NULL, NULL),
('pdf-52b851b0cad7-035', 'pdf-52b851b0cad7-035', 'Titus and Natural Diamonds - Titus', 'GEMSTONES', 'pieces', 67, 0, 0, NULL, NULL),
('pdf-52b851b0cad7-036', 'pdf-52b851b0cad7-036', 'Titus and Natural Diamonds - Natural Diamond Titus', 'GEMSTONES', 'pieces', 66, 0, 0, NULL, NULL)
ON CONFLICT ("referenceId") DO NOTHING;
COMMIT;
