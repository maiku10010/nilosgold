import { Prisma } from '@prisma/client';
import { serviceRules } from './lib/serviceRules';
import { goldMaterialCost } from './goldAllocation';
type Cost = { goldUsed: Prisma.Decimal | string | number; goldScrap: Prisma.Decimal | string | number; goldCostPerG: Prisma.Decimal | string | number; stoneCost: Prisma.Decimal | string | number; laborCost: Prisma.Decimal | string | number; otherCost?: Prisma.Decimal | string | number };
export function serviceCost(serviceType: unknown, job: Cost) {
  const rules = serviceRules(serviceType);
  return (rules.gold ? goldMaterialCost(job.goldUsed, rules.scrap ? job.goldScrap : 0, job.goldCostPerG) : new Prisma.Decimal(0))
    .plus(rules.stone ? job.stoneCost : 0).plus(rules.labor ? job.laborCost : 0).plus(job.otherCost ?? 0).toDecimalPlaces(2);
}
