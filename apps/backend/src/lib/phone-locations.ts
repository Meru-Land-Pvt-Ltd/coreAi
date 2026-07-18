import { City, Country, State } from "country-state-city";

/**
 * Worldwide location catalogue for Twilio number provisioning, backed by the
 * ISO country-state-city dataset (every country, with its real states and
 * cities). Served hierarchically (countries → states of a country → cities of
 * a state) so the buyer's dropdowns load lazily; the backend re-validates
 * every selection against the same dataset — the frontend dropdowns are
 * convenience, not authority.
 *
 * Twilio's available-number search only honors state/city (InRegion /
 * InLocality) filters for US and Canada local numbers; for every other
 * country the search is country-wide and the buyer's requested state/city is
 * stored on the provisioning request for the record. Number availability
 * always depends on live Twilio inventory and local regulatory requirements.
 */

/** Countries where Twilio local search supports InRegion/InLocality filters. */
const LOCALITY_FILTER_COUNTRIES = new Set(["US", "CA"]);

export function supportsLocalityFilter(countryCode: string): boolean {
  return LOCALITY_FILTER_COUNTRIES.has(countryCode.trim().toUpperCase());
}

export type PhoneCountryOption = { code: string; name: string };
export type PhoneStateOption = { code: string; name: string };

export function listPhoneCountries(): PhoneCountryOption[] {
  return Country.getAllCountries().map((country) => ({
    code: country.isoCode,
    name: country.name
  }));
}

export function findPhoneCountry(countryCode: string | null | undefined): PhoneCountryOption | null {
  const code = (countryCode ?? "").trim().toUpperCase();
  if (!code) return null;
  const country = Country.getCountryByCode(code);
  return country ? { code: country.isoCode, name: country.name } : null;
}

export function listPhoneStates(countryCode: string): PhoneStateOption[] {
  const code = countryCode.trim().toUpperCase();
  return State.getStatesOfCountry(code).map((state) => ({
    code: state.isoCode,
    name: state.name
  }));
}

/**
 * Cities of a state — or, for the few countries without states in the ISO
 * dataset, the country's own city list (pass an empty state code).
 */
export function listPhoneCities(countryCode: string, stateCode: string): string[] {
  const country = countryCode.trim().toUpperCase();
  const state = stateCode.trim().toUpperCase();

  const cities = state
    ? City.getCitiesOfState(country, state)
    : City.getCitiesOfCountry(country) ?? [];

  // The dataset can contain duplicate city names within a state.
  return [...new Set(cities.map((city) => city.name))];
}

export type PhoneLocationValidation =
  | {
      ok: true;
      country: PhoneCountryOption;
      region: PhoneStateOption | null;
      city: string | null;
      /** True when Twilio search can actually filter by this state/city. */
      localityFilter: boolean;
    }
  | { ok: false; errorCode: "UNSUPPORTED_COUNTRY" | "INVALID_REGION" | "INVALID_CITY"; message: string };

/**
 * Server-side validation of a buyer-selected location: unknown countries,
 * states outside the selected country, and cities outside the selected state
 * are all rejected.
 */
export function validatePhoneLocation(params: {
  country: string;
  state?: string | null;
  city?: string | null;
}): PhoneLocationValidation {
  const country = findPhoneCountry(params.country);

  if (!country) {
    return {
      ok: false,
      errorCode: "UNSUPPORTED_COUNTRY",
      message: "Select a valid country."
    };
  }

  const localityFilter = supportsLocalityFilter(country.code);
  const stateCode = (params.state ?? "").trim().toUpperCase();
  const cityName = (params.city ?? "").trim();

  if (!stateCode) {
    if (cityName) {
      // A city without its state is only meaningful for stateless countries.
      const countryCities = listPhoneCities(country.code, "");
      const match = countryCities.find((entry) => entry.toLowerCase() === cityName.toLowerCase());
      if (!match) {
        return {
          ok: false,
          errorCode: "INVALID_CITY",
          message: "The selected city does not belong to the selected country."
        };
      }
      return { ok: true, country, region: null, city: match, localityFilter };
    }
    return { ok: true, country, region: null, city: null, localityFilter };
  }

  const region = listPhoneStates(country.code).find((entry) => entry.code === stateCode) ?? null;

  if (!region) {
    return {
      ok: false,
      errorCode: "INVALID_REGION",
      message: "The selected state/province does not belong to the selected country."
    };
  }

  if (!cityName) {
    return { ok: true, country, region, city: null, localityFilter };
  }

  const city =
    listPhoneCities(country.code, region.code).find(
      (entry) => entry.toLowerCase() === cityName.toLowerCase()
    ) ?? null;

  if (!city) {
    return {
      ok: false,
      errorCode: "INVALID_CITY",
      message: "The selected city does not belong to the selected state/province."
    };
  }

  return { ok: true, country, region, city, localityFilter };
}
