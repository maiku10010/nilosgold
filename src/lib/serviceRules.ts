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
// Disabled fields accept only null or omission; zero is still an applicable value.
export function validateServiceFields(serviceType: unknown, payload: Record<string, unknown>) {
  const rules = serviceRules(serviceType);
  for (const key of Object.keys(fields) as Array<keyof typeof fields>) {
    if (rules[key]) continue;
    for (const field of fields[key]) {
      if (payload[field] !== undefined && payload[field] !== null) throw Object.assign(new Error(`${field} is not allowed for ${serviceType}.`), { statusCode: 400, field });
    }
  }
  return rules;
}

/** Concrete costing payload keys enabled for this service. */
export function getAllowedFields(serviceType: ServiceType) {
  const rules = serviceRules(serviceType);
  return (Object.keys(fields) as Array<keyof typeof fields>).flatMap(key => rules[key] ? [...fields[key]] : []);
}

/** Return a copy, clearing every disabled costing field without changing other data. */
export function stripDisallowedFields(serviceType: ServiceType, payload: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const rules = serviceRules(serviceType);
  const result = { ...payload };
  for (const key of Object.keys(fields) as Array<keyof typeof fields>) {
    if (rules[key]) continue;
    for (const field of fields[key]) result[field] = null;
  }
  return result;
}

/** Inquiry categories are the existing stored service type; expose one canonical API value. */
export function getInquiryServiceType(inquiry: { serviceType?: unknown; category?: unknown }): ServiceType | null {
  const value = inquiry.serviceType ?? inquiry.category;
  if (typeof value !== 'string') return null;
  return (Object.keys(SERVICE_RULES) as ServiceType[]).find(type => type.toLowerCase() === value.trim().toLowerCase()) ?? null;
}
