import { Prisma } from '@prisma/client';
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

/** Derive labor from the saved quote, never a client-supplied labor amount. */
export function calculateLaborCost(quotedPrice: unknown): number {
  try {
    const quote = new Prisma.Decimal(String(quotedPrice));
    if (!quote.isFinite() || quote.isNegative()) throw new Error();
    return quote.times('0.30').toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toNumber();
  } catch {
    throw Object.assign(new Error('A valid quoted price is required to calculate labor cost.'), { statusCode: 400, field: 'quotedPrice' });
  }
}
