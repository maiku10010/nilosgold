"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.jobCostingSchema = void 0;
exports.parseStoneCost = parseStoneCost;
const zod_1 = require("zod");
const rounding_1 = require("../rounding");
exports.jobCostingSchema = zod_1.z.object({
    stoneCost: zod_1.z.number().nonnegative().nullable().optional(),
});
/** An unrecorded stone cost stays null; an explicitly measured zero stays zero. */
function parseStoneCost(value) {
    const parsed = exports.jobCostingSchema.shape.stoneCost.safeParse(value);
    if (!parsed.success)
        throw Object.assign(new Error('Stone cost must be a non-negative number or left empty.'), { statusCode: 400, field: 'stoneCost' });
    return parsed.data == null ? null : (0, rounding_1.roundTwo)(parsed.data);
}
