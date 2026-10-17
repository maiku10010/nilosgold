import { z } from 'zod';
import { roundTwo } from '../rounding';

export const jobCostingSchema = z.object({
  stoneCost: z.number().nonnegative().nullable().optional(),
});

/** An unrecorded stone cost stays null; an explicitly measured zero stays zero. */
export function parseStoneCost(value: unknown): number | null {
  const parsed = jobCostingSchema.shape.stoneCost.safeParse(value);
  if (!parsed.success) throw Object.assign(new Error('Stone cost must be a non-negative number or left empty.'), { statusCode: 400, field: 'stoneCost' });
  return parsed.data == null ? null : roundTwo(parsed.data);
}
