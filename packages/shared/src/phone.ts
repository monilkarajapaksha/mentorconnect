import { parsePhoneNumberFromString } from 'libphonenumber-js';

export const DEFAULT_COUNTRY = 'LK' as const;

/** Normalize any input to E.164, defaulting to Sri Lanka. Returns null if invalid. */
export function normalizePhone(input: string): string | null {
  const parsed = parsePhoneNumberFromString(input.trim(), DEFAULT_COUNTRY);
  return parsed && parsed.isValid() ? parsed.number : null;
}
