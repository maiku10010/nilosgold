"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.serviceCost = serviceCost;
const client_1 = require("@prisma/client");
const serviceRules_1 = require("./lib/serviceRules");
const goldAllocation_1 = require("./goldAllocation");
function serviceCost(serviceType, job) {
    const rules = (0, serviceRules_1.serviceRules)(serviceType);
    return (rules.gold ? (0, goldAllocation_1.goldMaterialCost)(job.goldUsed, rules.scrap ? job.goldScrap : 0, job.goldCostPerG) : new client_1.Prisma.Decimal(0))
        .plus(rules.stone ? job.stoneCost : 0).plus(rules.labor ? job.laborCost : 0).plus(job.otherCost ?? 0).toDecimalPlaces(2);
}
