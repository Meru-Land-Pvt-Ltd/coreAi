export const COUNTRY_CODES: ReadonlyArray<{ code: string; label: string }> = [
  { code: "+1", label: "US / Canada" },
  { code: "+44", label: "United Kingdom" },
  { code: "+91", label: "India" },
  { code: "+61", label: "Australia" },
  { code: "+971", label: "UAE" },
  { code: "+65", label: "Singapore" },
  { code: "+49", label: "Germany" },
  { code: "+33", label: "France" },
  { code: "+81", label: "Japan" },
  { code: "+55", label: "Brazil" }
];

export type CountryCode = string;

export function splitPhoneNumber(value: string): { countryCode: string; phone: string } {
  const phone = value.trim();
  const country = COUNTRY_CODES.find(
    (entry) => phone.startsWith(`${entry.code} `) || phone === entry.code
  );

  if (country) {
    return {
      countryCode: country.code,
      phone: phone.replace(country.code, "").trim()
    };
  }

  // Profile numbers are stored as "<calling code> <national number>". Accept
  // every international code here so newly seeded countries do not depend on
  // the small legacy fallback list above.
  const internationalParts = phone.match(/^(\+\d+)\s+(.+)$/);
  if (internationalParts) {
    return { countryCode: internationalParts[1]!, phone: internationalParts[2]!.trim() };
  }

  return { countryCode: COUNTRY_CODES[0]!.code, phone };
}

export function joinPhoneNumber(countryCode: string, phone: string): string {
  const trimmedPhone = phone.trim();
  return trimmedPhone ? `${countryCode} ${trimmedPhone}` : countryCode;
}

/** Builds compact E.164 (`+91…`) for APIs that reject spaced dial codes. */
export function buildE164PhoneNumber(countryCode: string, phone: string): string {
  const digitsOnly = phone.replace(/[^\d]/g, "");
  return `${countryCode}${digitsOnly}`;
}
