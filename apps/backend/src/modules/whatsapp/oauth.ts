import { env } from "../../config/env";
import { WhatsAppServiceError } from "./types";

const WHATSAPP_EMBEDDED_SIGNUP_BASE_URL = "https://business.facebook.com/messaging/whatsapp/onboard/";
const WHATSAPP_EMBEDDED_SIGNUP_SCOPE = "whatsapp_business_messaging,whatsapp_business_management";

export type WhatsAppEmbeddedSignupLaunchParams = {
  /**
   * Optional end-customer phone number (E.164). Used only for convenience/state
   * so we can show/validate it later — Meta still performs the phone verification
   * flow unless configured otherwise.
   */
  phoneNumber?: string;
  /**
   * Optional opaque value to help correlate the flow across redirects/popups.
   */
  state?: string;
};

/**
 * Create the URL used to launch WhatsApp Embedded Signup in a popup/window.
 * The returned URL is opened by the frontend and the completion payload is sent
 * back to the parent window via a `message` event of type `WA_EMBEDDED_SIGNUP`.
 */
export function buildWhatsAppEmbeddedSignupLaunchUrl(params: WhatsAppEmbeddedSignupLaunchParams): string {
  const configId = env.META_WHATSAPP_EMBEDDED_SIGNUP_CONFIGURATION_ID;
  const appId = env.META_WHATSAPP_APP_ID;
  const apiVersion = env.META_WHATSAPP_API_VERSION;

  if (!configId) {
    throw new WhatsAppServiceError(
      "WhatsApp Embedded Signup is not configured (missing META_WHATSAPP_EMBEDDED_SIGNUP_CONFIGURATION_ID).",
      500,
      "EMBEDDED_SIGNUP_NOT_CONFIGURED"
    );
  }
  if (!appId) {
    throw new WhatsAppServiceError("Missing META_WHATSAPP_APP_ID.", 500, "MISSING_META_APP_ID");
  }

  const extras = {
    setup: {},
    // Session logging variant that includes the embedded signup message event payload.
    sessionInfoVersion: 3,
    // Keep the launch deterministic for the UX.
    response_type: "code",
    // Metadata for our frontend/debugging (not security-critical).
    triven: {
      phoneNumber: params.phoneNumber ?? "",
      state: params.state ?? ""
    }
  };

  const qs = new URLSearchParams({
    app_id: appId,
    config_id: configId,
    response_type: "code",
    scope: WHATSAPP_EMBEDDED_SIGNUP_SCOPE,
    extras: JSON.stringify(extras),
    state: params.state ?? ""
  });

  // apiVersion isn't always needed for the launch URL, but we keep it as a sanity
  // requirement so the same env set controls all Meta interactions.
  if (!apiVersion) {
    throw new WhatsAppServiceError("META_WHATSAPP_API_VERSION is required.", 500, "MISSING_API_VERSION");
  }

  return `${WHATSAPP_EMBEDDED_SIGNUP_BASE_URL}?${qs.toString()}`;
}

/**
 * Exchange Embedded Signup authorization `code` for a customer-scoped business token.
 */
export async function exchangeWhatsAppEmbeddedSignupCodeForToken(code: string): Promise<string> {
  const appId = env.META_WHATSAPP_APP_ID;
  const appSecret = env.META_WHATSAPP_APP_SECRET;
  const apiVersion = env.META_WHATSAPP_API_VERSION;
  const graphBaseUrl = env.META_WHATSAPP_GRAPH_BASE_URL.replace(/\/$/, "");

  if (!appId || !appSecret) {
    throw new WhatsAppServiceError("Meta app credentials are missing.", 500, "MISSING_META_APP_CREDENTIALS");
  }

  const url = `${graphBaseUrl}/${apiVersion}/oauth/access_token?client_id=${encodeURIComponent(appId)}&client_secret=${encodeURIComponent(appSecret)}&code=${encodeURIComponent(code)}`;
  const response = await fetch(url, { method: "GET" });
  const json = (await response.json().catch(() => ({}))) as { access_token?: string; error?: { message?: string } };

  if (!response.ok || !json.access_token) {
    const message = json.error?.message ?? `Meta oauth/access_token failed (${response.status}).`;
    throw new WhatsAppServiceError(message, response.status || 502, "CODE_EXCHANGE_FAILED", true);
  }

  return json.access_token;
}
