"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SERVICE_RULES = void 0;
exports.serviceRules = serviceRules;
exports.validateServiceFields = validateServiceFields;
exports.getAllowedFields = getAllowedFields;
exports.stripDisallowedFields = stripDisallowedFields;
exports.getInquiryServiceType = getInquiryServiceType;
const readableError_1 = require("./readableError");
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
// Disabled fields accept only null or omission; zero is still an applicable value.
function validateServiceFields(serviceType, payload) {
    const rules = serviceRules(serviceType);
    for (const key of Object.keys(fields)) {
        if (rules[key])
            continue;
        for (const field of fields[key]) {
            if (payload[field] !== undefined && payload[field] !== null)
                throw Object.assign(new Error(`${(0, readableError_1.fieldLabel)(field)} is not used for ${serviceType} jobs.`), { statusCode: 400, field });
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
/** Inquiry categories are the existing stored service type; expose one canonical API value. */
function getInquiryServiceType(inquiry) {
    const value = inquiry.serviceType ?? inquiry.category;
    if (typeof value !== 'string')
        return null;
    return Object.keys(exports.SERVICE_RULES).find(type => type.toLowerCase() === value.trim().toLowerCase()) ?? null;
}
