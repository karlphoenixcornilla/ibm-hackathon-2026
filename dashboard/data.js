export async function readJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Data request failed (${response.status})`);
  return response.json();
}

// Covers the keywords used by the current dashboard index contract.
export function validate(value, schema) {
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  const matches = type => type === 'null' ? value === null
    : type === 'array' ? Array.isArray(value)
    : type === 'integer' ? Number.isInteger(value)
    : type === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value)
    : typeof value === type;
  if (schema.type && !types.some(matches)) throw new Error('Invalid data type');
  if (schema.enum && !schema.enum.includes(value)) throw new Error('Invalid data value');
  if (schema.required?.some(key => !Object.hasOwn(value, key))) throw new Error('Missing data field');
  if (schema.properties) for (const [key, rule] of Object.entries(schema.properties)) {
    if (Object.hasOwn(value, key)) validate(value[key], rule);
  }
  if (schema.items) for (const item of value) validate(item, schema.items);
}

export function recordPath(issue) {
  const parts = issue.repo.split('/');
  if (parts.length !== 2 || parts.some(part => !/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(part)) || !Number.isInteger(issue.issue) || issue.issue < 1) throw new Error('Invalid report path');
  return `data/${parts.map(encodeURIComponent).join('/')}/issues/${issue.issue}.json`;
}
