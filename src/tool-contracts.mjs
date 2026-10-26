import Value from 'typebox/value';

// One argument contract for CLI, Pi and MCP. Validate the complete JSON Schema,
// including sibling constraints beside anyOf; never coerce or mutate tool inputs.
export function validateArguments(value, spec, label = 'arguments') {
  if (Value.Check(spec, value)) return;
  const errors = Value.Errors(spec, value);
  const extra = errors.find(error => error.keyword === 'additionalProperties');
  const error = extra || errors[0];
  const message = extra ? `unexpected ${extra.params.additionalProperties.join(', ')}` : error.message;
  throw new Error(`${label}${error.instancePath}: ${message}`);
}

export function specializeSchema(base, fields, required = []) {
  return { type: 'object', properties: Object.fromEntries(fields.map(key => {
    if (!base.properties[key]) throw new Error(`Unknown contract field: ${key}`);
    return [key, base.properties[key]];
  })), required, additionalProperties: false };
}
