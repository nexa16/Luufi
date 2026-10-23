// A bounded subset matching exactly our static discovery schemas.
export function validates(
  value: unknown,
  schema: Record<string, unknown>,
): boolean {
  if (Array.isArray(schema.anyOf))
    return schema.anyOf.some((s) => validates(value, s));
  if (schema.enum && !(schema.enum as unknown[]).includes(value)) return false;
  switch (schema.type) {
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
    case 'string':
      return (
        typeof value === 'string' &&
        value.length >= ((schema.minLength as number) ?? 0) &&
        value.length <= ((schema.maxLength as number) ?? Infinity) &&
        (!schema.pattern || new RegExp(schema.pattern as string).test(value))
      );
    case 'integer':
      return (
        Number.isSafeInteger(value) &&
        (value as number) >= (schema.minimum as number) &&
        (value as number) <= (schema.maximum as number)
      );
    case 'array':
      return (
        Array.isArray(value) &&
        value.length <= (schema.maxItems as number) &&
        value.every((item) =>
          validates(item, schema.items as Record<string, unknown>),
        )
      );
    case 'object': {
      if (!value || typeof value !== 'object' || Array.isArray(value))
        return false;
      const fields = schema.properties as Record<
        string,
        Record<string, unknown>
      >;
      return (
        (schema.required as string[]).every((key) =>
          Object.hasOwn(value, key),
        ) &&
        Object.entries(value).every(
          ([key, field]) =>
            Object.hasOwn(fields, key) && validates(field, fields[key]),
        )
      );
    }
    default:
      return false;
  }
}
