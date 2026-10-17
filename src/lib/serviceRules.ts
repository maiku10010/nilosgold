export const SERVICE_RULES = {
  Repair: { gold: true, stone: true, scrap: true, labor: true },
  Custom: { gold: true, stone: true, scrap: true, labor: true },
  Resize: { gold: true, stone: false, scrap: true, labor: true },
  Cleaning: { gold: false, stone: false, scrap: false, labor: true },
} as const;

export type ServiceType = keyof typeof SERVICE_RULES;
export function serviceRules(serviceType: unknown) {
  if (typeof serviceType !== 'string' || !Object.hasOwn(SERVICE_RULES, serviceType)) {
    throw Object.assign(new Error('Choose a valid service type.'), { statusCode: 400 });
  }
  return SERVICE_RULES[serviceType as ServiceType];
}

const fields = { gold: ['goldSourceId', 'goldUsed', 'goldCostPerG'], stone: ['stoneCost'], scrap: ['goldScrap'], labor: ['laborCost', 'laborCharge'] } as const;
// Disabled fields must be omitted, even if they contain zero or a stale value.
export function validateServiceFields(serviceType: unknown, payload: Record<string, unknown>) {
  const rules = serviceRules(serviceType);
  for (const key of Object.keys(fields) as Array<keyof typeof fields>) {
    if (rules[key]) continue;
    for (const field of fields[key]) {
      if (Object.hasOwn(payload, field)) throw Object.assign(new Error(`${field} is not allowed for ${serviceType}.`), { statusCode: 400, field });
    }
  }
  return rules;
}
