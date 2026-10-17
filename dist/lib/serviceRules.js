"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SERVICE_RULES = void 0;
exports.serviceRules = serviceRules;
exports.validateServiceFields = validateServiceFields;
exports.getAllowedFields = getAllowedFields;
exports.stripDisallowedFields = stripDisallowedFields;
exports.SERVICE_RULES = {
    Repair: { gold: true, stone: true, scrap: true, labor: true },
    Custom: { gold: true, stone: true, scrap: true, labor: true },
    Resize: { gold: true, stone: false, scrap: true, labor: true },
    Cleaning: { gold: false, stone: false, scrap: false, labor: true },
};
function serviceRules(serviceType) {
    if (typeof serviceType !== 'string' || !Object.hasOwn(exports.SERVICE_RULES, serviceType)) {
        throw Object.assign(new Error('Choose a valid service type.'), { statusCode: 400 });
    }
    return exports.SERVICE_RULES[serviceType];
}
const fields = { gold: ['goldSourceId', 'goldUsed', 'goldCostPerG'], stone: ['stoneCost'], scrap: ['goldScrap'], labor: ['laborCost', 'laborCharge'] };
// Disabled fields must be omitted, even if they contain zero or a stale value.
function validateServiceFields(serviceType, payload) {
    const rules = serviceRules(serviceType);
    for (const key of Object.keys(fields)) {
        if (rules[key])
            continue;
        for (const field of fields[key]) {
            if (Object.hasOwn(payload, field))
                throw Object.assign(new Error(`${field} is not allowed for ${serviceType}.`), { statusCode: 400, field });
        }
    }
    return rules;
}
/** Concrete costing payload keys enabled for this service. */
function getAllowedFields(serviceType) {
    const rules = serviceRules(serviceType);
    return Object.keys(fields).flatMap(key => rules[key] ? [...fields[key]] : []);
}
/** Return a copy, clearing every disabled costing field without changing other data. */
function stripDisallowedFields(serviceType, payload) {
    const rules = serviceRules(serviceType);
    const result = { ...payload };
    for (const key of Object.keys(fields)) {
        if (rules[key])
            continue;
        for (const field of fields[key])
            result[field] = null;
    }
    return result;
}
