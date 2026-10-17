import { Prisma } from '@prisma/client';
import { serviceRules } from './lib/serviceRules';
import { goldMaterialCost } from './goldAllocation';
type Cost = { goldUsed: Prisma.Decimal | string | number | null; goldScrap: Prisma.Decimal | string | number | null; goldCostPerG: Prisma.Decimal | string | number | null; stoneCost: Prisma.Decimal | string | number | null; laborCost: Prisma.Decimal | string | number | null; otherCost?: Prisma.Decimal | string | number | null };
export function serviceCost(serviceType: unknown, job: Cost) {
  const rules = serviceRules(serviceType);
  return (rules.gold ? goldMaterialCost(job.goldUsed ?? 0, rules.scrap ? job.goldScrap ?? 0 : 0, job.goldCostPerG ?? 0) : new Prisma.Decimal(0))
    .plus(rules.stone ? job.stoneCost ?? 0 : 0).plus(rules.labor ? job.laborCost ?? 0 : 0).plus(job.otherCost ?? 0).toDecimalPlaces(2);
}
