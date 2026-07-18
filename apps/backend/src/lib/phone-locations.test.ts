import { describe, expect, it } from "vitest";
import {
  findPhoneCountry,
  listPhoneCities,
  listPhoneCountries,
  listPhoneStates,
  supportsLocalityFilter,
  validatePhoneLocation
} from "./phone-locations";

describe("worldwide phone location catalogue", () => {
  it("lists every ISO country", () => {
    const countries = listPhoneCountries();
    expect(countries.length).toBeGreaterThan(200);
    expect(countries.find((c) => c.code === "US")?.name).toBe("United States");
    expect(countries.find((c) => c.code === "IN")?.name).toBe("India");
    expect(countries.find((c) => c.code === "DE")).toBeTruthy();
  });

  it("lists real states and cities for any country, not just US/CA", () => {
    const indianStates = listPhoneStates("IN");
    expect(indianStates.length).toBeGreaterThan(25);
    const up = indianStates.find((s) => s.name === "Uttar Pradesh");
    expect(up?.code).toBe("UP");
    expect(listPhoneCities("IN", "UP")).toContain("Noida");

    expect(listPhoneCities("US", "CA")).toContain("Los Angeles");
    expect(listPhoneStates("GB").length).toBeGreaterThan(0);
  });

  it("marks Twilio state/city filtering support for US/CA only", () => {
    expect(supportsLocalityFilter("US")).toBe(true);
    expect(supportsLocalityFilter("ca")).toBe(true);
    expect(supportsLocalityFilter("IN")).toBe(false);
    expect(supportsLocalityFilter("GB")).toBe(false);
  });
});

describe("phone location validation", () => {
  it("rejects unknown countries", () => {
    const result = validatePhoneLocation({ country: "ZZ" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe("UNSUPPORTED_COUNTRY");
  });

  it("requires the state to belong to the selected country", () => {
    const result = validatePhoneLocation({ country: "US", state: "UP" }); // Indian state code
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe("INVALID_REGION");
  });

  it("requires the city to belong to the selected state", () => {
    const result = validatePhoneLocation({ country: "US", state: "CA", city: "Houston" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe("INVALID_CITY");
  });

  it("accepts a valid triple for any country, case-insensitively on city", () => {
    const us = validatePhoneLocation({ country: "us", state: "ca", city: "los angeles" });
    expect(us.ok).toBe(true);
    if (us.ok) {
      expect(us.country.code).toBe("US");
      expect(us.region?.code).toBe("CA");
      expect(us.city).toBe("Los Angeles");
      expect(us.localityFilter).toBe(true);
    }

    const india = validatePhoneLocation({ country: "IN", state: "UP", city: "Noida" });
    expect(india.ok).toBe(true);
    if (india.ok) {
      expect(india.region?.name).toBe("Uttar Pradesh");
      expect(india.city).toBe("Noida");
      // Twilio cannot city-filter India — search runs country-wide, honestly.
      expect(india.localityFilter).toBe(false);
    }
  });

  it("exposes country lookups", () => {
    expect(findPhoneCountry("IN")?.name).toBe("India");
    expect(findPhoneCountry("us")?.code).toBe("US");
    expect(findPhoneCountry(null)).toBeNull();
    expect(findPhoneCountry("XX")).toBeNull();
  });
});
