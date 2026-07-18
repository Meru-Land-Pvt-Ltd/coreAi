/**
 * Location catalogue for Twilio number provisioning. Only countries where
 * Twilio supports region/locality-filtered local-number search are listed with
 * dependent state→city dropdown data; the backend validates every selection
 * against this catalogue server-side (the frontend dropdowns are convenience,
 * not authority).
 *
 * Number availability always depends on live Twilio inventory and local
 * regulatory requirements — being listed here does not guarantee inventory.
 */

export type PhoneRegion = {
  /** Stable region code sent to Twilio's InRegion filter (US state / CA province). */
  code: string;
  name: string;
  cities: string[];
};

export type PhoneCountry = {
  /** ISO 3166-1 alpha-2. */
  code: string;
  name: string;
  /** Region/locality search supported (US/CA). Others search country-wide. */
  supportsRegionSearch: boolean;
  regions: PhoneRegion[];
};

const US_REGIONS: PhoneRegion[] = [
  { code: "AL", name: "Alabama", cities: ["Birmingham", "Montgomery", "Huntsville", "Mobile", "Tuscaloosa"] },
  { code: "AK", name: "Alaska", cities: ["Anchorage", "Fairbanks", "Juneau"] },
  { code: "AZ", name: "Arizona", cities: ["Phoenix", "Tucson", "Mesa", "Scottsdale", "Chandler", "Tempe"] },
  { code: "AR", name: "Arkansas", cities: ["Little Rock", "Fayetteville", "Fort Smith", "Springdale"] },
  { code: "CA", name: "California", cities: ["Los Angeles", "San Diego", "San Jose", "San Francisco", "Fresno", "Sacramento", "Long Beach", "Oakland", "Anaheim", "Irvine"] },
  { code: "CO", name: "Colorado", cities: ["Denver", "Colorado Springs", "Aurora", "Fort Collins", "Boulder"] },
  { code: "CT", name: "Connecticut", cities: ["Bridgeport", "New Haven", "Hartford", "Stamford", "Waterbury"] },
  { code: "DE", name: "Delaware", cities: ["Wilmington", "Dover", "Newark"] },
  { code: "DC", name: "District of Columbia", cities: ["Washington"] },
  { code: "FL", name: "Florida", cities: ["Jacksonville", "Miami", "Tampa", "Orlando", "St. Petersburg", "Fort Lauderdale", "Tallahassee"] },
  { code: "GA", name: "Georgia", cities: ["Atlanta", "Augusta", "Columbus", "Savannah", "Athens"] },
  { code: "HI", name: "Hawaii", cities: ["Honolulu", "Hilo", "Kailua"] },
  { code: "ID", name: "Idaho", cities: ["Boise", "Meridian", "Nampa", "Idaho Falls"] },
  { code: "IL", name: "Illinois", cities: ["Chicago", "Aurora", "Naperville", "Joliet", "Rockford", "Springfield"] },
  { code: "IN", name: "Indiana", cities: ["Indianapolis", "Fort Wayne", "Evansville", "South Bend", "Carmel"] },
  { code: "IA", name: "Iowa", cities: ["Des Moines", "Cedar Rapids", "Davenport", "Sioux City"] },
  { code: "KS", name: "Kansas", cities: ["Wichita", "Overland Park", "Kansas City", "Topeka"] },
  { code: "KY", name: "Kentucky", cities: ["Louisville", "Lexington", "Bowling Green", "Owensboro"] },
  { code: "LA", name: "Louisiana", cities: ["New Orleans", "Baton Rouge", "Shreveport", "Lafayette"] },
  { code: "ME", name: "Maine", cities: ["Portland", "Lewiston", "Bangor"] },
  { code: "MD", name: "Maryland", cities: ["Baltimore", "Columbia", "Germantown", "Silver Spring", "Frederick"] },
  { code: "MA", name: "Massachusetts", cities: ["Boston", "Worcester", "Springfield", "Cambridge", "Lowell"] },
  { code: "MI", name: "Michigan", cities: ["Detroit", "Grand Rapids", "Warren", "Sterling Heights", "Ann Arbor", "Lansing"] },
  { code: "MN", name: "Minnesota", cities: ["Minneapolis", "Saint Paul", "Rochester", "Duluth", "Bloomington"] },
  { code: "MS", name: "Mississippi", cities: ["Jackson", "Gulfport", "Southaven", "Hattiesburg"] },
  { code: "MO", name: "Missouri", cities: ["Kansas City", "Saint Louis", "Springfield", "Columbia", "Independence"] },
  { code: "MT", name: "Montana", cities: ["Billings", "Missoula", "Great Falls", "Bozeman"] },
  { code: "NE", name: "Nebraska", cities: ["Omaha", "Lincoln", "Bellevue"] },
  { code: "NV", name: "Nevada", cities: ["Las Vegas", "Henderson", "Reno", "North Las Vegas"] },
  { code: "NH", name: "New Hampshire", cities: ["Manchester", "Nashua", "Concord"] },
  { code: "NJ", name: "New Jersey", cities: ["Newark", "Jersey City", "Paterson", "Elizabeth", "Trenton", "Edison"] },
  { code: "NM", name: "New Mexico", cities: ["Albuquerque", "Las Cruces", "Rio Rancho", "Santa Fe"] },
  { code: "NY", name: "New York", cities: ["New York", "Buffalo", "Rochester", "Yonkers", "Syracuse", "Albany"] },
  { code: "NC", name: "North Carolina", cities: ["Charlotte", "Raleigh", "Greensboro", "Durham", "Winston-Salem", "Fayetteville"] },
  { code: "ND", name: "North Dakota", cities: ["Fargo", "Bismarck", "Grand Forks"] },
  { code: "OH", name: "Ohio", cities: ["Columbus", "Cleveland", "Cincinnati", "Toledo", "Akron", "Dayton"] },
  { code: "OK", name: "Oklahoma", cities: ["Oklahoma City", "Tulsa", "Norman", "Broken Arrow"] },
  { code: "OR", name: "Oregon", cities: ["Portland", "Salem", "Eugene", "Gresham", "Bend"] },
  { code: "PA", name: "Pennsylvania", cities: ["Philadelphia", "Pittsburgh", "Allentown", "Erie", "Reading", "Scranton"] },
  { code: "RI", name: "Rhode Island", cities: ["Providence", "Warwick", "Cranston"] },
  { code: "SC", name: "South Carolina", cities: ["Charleston", "Columbia", "North Charleston", "Mount Pleasant", "Greenville"] },
  { code: "SD", name: "South Dakota", cities: ["Sioux Falls", "Rapid City", "Aberdeen"] },
  { code: "TN", name: "Tennessee", cities: ["Nashville", "Memphis", "Knoxville", "Chattanooga", "Clarksville"] },
  { code: "TX", name: "Texas", cities: ["Houston", "San Antonio", "Dallas", "Austin", "Fort Worth", "El Paso", "Arlington", "Plano"] },
  { code: "UT", name: "Utah", cities: ["Salt Lake City", "West Valley City", "Provo", "West Jordan"] },
  { code: "VT", name: "Vermont", cities: ["Burlington", "South Burlington", "Rutland"] },
  { code: "VA", name: "Virginia", cities: ["Virginia Beach", "Norfolk", "Chesapeake", "Richmond", "Arlington", "Alexandria"] },
  { code: "WA", name: "Washington", cities: ["Seattle", "Spokane", "Tacoma", "Vancouver", "Bellevue", "Everett"] },
  { code: "WV", name: "West Virginia", cities: ["Charleston", "Huntington", "Morgantown"] },
  { code: "WI", name: "Wisconsin", cities: ["Milwaukee", "Madison", "Green Bay", "Kenosha", "Racine"] },
  { code: "WY", name: "Wyoming", cities: ["Cheyenne", "Casper", "Laramie"] }
];

const CA_REGIONS: PhoneRegion[] = [
  { code: "AB", name: "Alberta", cities: ["Calgary", "Edmonton", "Red Deer", "Lethbridge"] },
  { code: "BC", name: "British Columbia", cities: ["Vancouver", "Victoria", "Surrey", "Burnaby", "Kelowna"] },
  { code: "MB", name: "Manitoba", cities: ["Winnipeg", "Brandon"] },
  { code: "NB", name: "New Brunswick", cities: ["Moncton", "Saint John", "Fredericton"] },
  { code: "NL", name: "Newfoundland and Labrador", cities: ["St. John's", "Corner Brook"] },
  { code: "NS", name: "Nova Scotia", cities: ["Halifax", "Sydney"] },
  { code: "ON", name: "Ontario", cities: ["Toronto", "Ottawa", "Mississauga", "Brampton", "Hamilton", "London", "Kitchener"] },
  { code: "PE", name: "Prince Edward Island", cities: ["Charlottetown"] },
  { code: "QC", name: "Quebec", cities: ["Montreal", "Quebec City", "Laval", "Gatineau", "Longueuil"] },
  { code: "SK", name: "Saskatchewan", cities: ["Saskatoon", "Regina"] }
];

export const PHONE_PROVISIONING_COUNTRIES: PhoneCountry[] = [
  { code: "US", name: "United States", supportsRegionSearch: true, regions: US_REGIONS },
  { code: "CA", name: "Canada", supportsRegionSearch: true, regions: CA_REGIONS },
  // Country-wide search only: Twilio local search for these markets does not
  // reliably filter by locality, and local numbers may carry regulatory
  // requirements (address/identity verification) before activation.
  { code: "GB", name: "United Kingdom", supportsRegionSearch: false, regions: [] },
  { code: "AU", name: "Australia", supportsRegionSearch: false, regions: [] }
];

export function findPhoneCountry(countryCode: string | null | undefined): PhoneCountry | null {
  const code = (countryCode ?? "").trim().toUpperCase();
  return PHONE_PROVISIONING_COUNTRIES.find((country) => country.code === code) ?? null;
}

export type PhoneLocationValidation =
  | { ok: true; country: PhoneCountry; region: PhoneRegion | null; city: string | null }
  | { ok: false; errorCode: "UNSUPPORTED_COUNTRY" | "INVALID_REGION" | "INVALID_CITY"; message: string };

/**
 * Server-side validation of a buyer-selected location. The frontend dropdowns
 * are never trusted: unknown countries, regions outside the selected country,
 * and cities outside the selected region are all rejected.
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
      message: "Phone numbers are not currently offered in the selected country."
    };
  }

  const stateCode = (params.state ?? "").trim().toUpperCase();
  const cityName = (params.city ?? "").trim();

  if (!country.supportsRegionSearch) {
    // Country-wide search: region/city are ignored rather than validated.
    return { ok: true, country, region: null, city: null };
  }

  if (!stateCode) {
    return { ok: true, country, region: null, city: null };
  }

  const region = country.regions.find((entry) => entry.code === stateCode) ?? null;

  if (!region) {
    return {
      ok: false,
      errorCode: "INVALID_REGION",
      message: "The selected state/province does not belong to the selected country."
    };
  }

  if (!cityName) {
    return { ok: true, country, region, city: null };
  }

  const city = region.cities.find((entry) => entry.toLowerCase() === cityName.toLowerCase()) ?? null;

  if (!city) {
    return {
      ok: false,
      errorCode: "INVALID_CITY",
      message: "The selected city does not belong to the selected state/province."
    };
  }

  return { ok: true, country, region, city };
}
