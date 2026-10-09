/** Normaliza un CUIT/CUIL quitando guiones y espacios. */
export function normalizeCuit(value: string) {
  return value.replace(/[\s.-]/g, "");
}

/** Valida un CUIT/CUIL de 11 dígitos con su dígito verificador. */
export function isValidCuit(value: string) {
  const digits = normalizeCuit(value);
  if (!/^\d{11}$/.test(digits)) return false;
  if (
    !["20", "23", "24", "25", "26", "27", "30", "33", "34"].includes(
      digits.slice(0, 2),
    )
  ) {
    return false;
  }
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const sum = weights.reduce(
    (total, weight, index) => total + weight * Number(digits[index]),
    0,
  );
  const remainder = 11 - (sum % 11);
  // Con resto 10 ARCA no asigna el número (usa otro prefijo), así que es inválido.
  if (remainder === 10) return false;
  const check = remainder === 11 ? 0 : remainder;
  return check === Number(digits[10]);
}

export function formatCuit(value: string) {
  const digits = normalizeCuit(value);
  return digits.length === 11
    ? `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}`
    : value;
}
