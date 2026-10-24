// One argument contract for CLI, Pi and MCP. Fixed selectors cannot be overridden.
export function validateArguments(value, spec, label = 'arguments') {
  if (spec.anyOf) {
    if (!spec.anyOf.some(s => { try { validateArguments(value, s, label); return true; } catch { return false; } })) throw new Error(`${label}: no matching schema`);
    return;
  }
  if (spec.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}: expected object`);
    for (const key of spec.required || []) if (!(key in value)) throw new Error(`${label}: missing ${key}`);
    for (const [key, v] of Object.entries(value)) {
      if (!Object.hasOwn(spec.properties || {}, key)) { if (spec.additionalProperties === false) throw new Error(`${label}: unexpected ${key}`); }
      else validateArguments(v, spec.properties[key], `${label}.${key}`);
    }
  } else if (spec.type === 'array') {
    if (!Array.isArray(value) || value.length < (spec.minItems || 0) || value.length > (spec.maxItems ?? Infinity)) throw new Error(`${label}: invalid array`);
    if (spec.uniqueItems && new Set(value.map(v => JSON.stringify(v))).size !== value.length) throw new Error(`${label}: duplicate items`);
    value.forEach((v, i) => validateArguments(v, spec.items, `${label}[${i}]`));
  } else if (spec.type === 'integer' || spec.type === 'number') {
    if (!Number.isFinite(value) || (spec.type === 'integer' && !Number.isInteger(value)) || value < (spec.minimum ?? -Infinity) || value > (spec.maximum ?? Infinity)) throw new Error(`${label}: invalid ${spec.type}`);
  } else if (spec.type && typeof value !== spec.type) throw new Error(`${label}: expected ${spec.type}`);
  if (typeof value === 'string' && (value.length < (spec.minLength || 0) || value.length > (spec.maxLength ?? Infinity) || (spec.pattern && !new RegExp(spec.pattern).test(value)))) throw new Error(`${label}: invalid string`);
  if (spec.enum && !spec.enum.includes(value)) throw new Error(`${label}: unsupported value`);
}

export function specializeSchema(base, fields, required = []) {
  return { type: 'object', properties: Object.fromEntries(fields.map(key => {
    if (!base.properties[key]) throw new Error(`Unknown contract field: ${key}`);
    return [key, base.properties[key]];
  })), required, additionalProperties: false };
}
