import { describe, expect, it } from "vitest";
import { findPhoneCountry, validatePhoneLocation } from "./phone-locations";

describe("phone location validation", () => {
  it("rejects unsupported countries", () => {
    const result = validatePhoneLocation({ country: "ZZ" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe("UNSUPPORTED_COUNTRY");
  });

  it("requires the state to belong to the selected country", () => {
    const result = validatePhoneLocation({ country: "US", state: "ON" }); // Ontario is Canadian
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe("INVALID_REGION");
  });

  it("requires the city to belong to the selected state", () => {
    const result = validatePhoneLocation({ country: "US", state: "CA", city: "Houston" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe("INVALID_CITY");
  });

  it("accepts a valid country/state/city triple case-insensitively on city", () => {
    const result = validatePhoneLocation({ country: "us", state: "ca", city: "los angeles" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.country.code).toBe("US");
      expect(result.region?.code).toBe("CA");
      expect(result.city).toBe("Los Angeles");
    }
  });

  it("ignores region/city for country-wide-search countries", () => {
    const result = validatePhoneLocation({ country: "GB", state: "XX", city: "Nowhere" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.region).toBeNull();
      expect(result.city).toBeNull();
    }
  });

  it("exposes supported countries with ISO codes", () => {
    expect(findPhoneCountry("US")?.name).toBe("United States");
    expect(findPhoneCountry("ca")?.supportsRegionSearch).toBe(true);
    expect(findPhoneCountry(null)).toBeNull();
  });
});
