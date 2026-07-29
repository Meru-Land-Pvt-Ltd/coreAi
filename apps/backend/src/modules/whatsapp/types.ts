export type WhatsAppListenFor = "all" | "text" | "image" | "document" | "audio" | "video";

/**
 * Safe shape sent to the frontend / workflow architect.
 * NEVER includes phoneNumberId, businessAccountId, accessToken, appSecret,
 * or webhookVerifyToken — those are platform-internal credentials.
 */
export type WhatsAppConnectionPublic = {
  id: string;
  displayName: string | null;
  businessName: string | null;
  phoneNumber: string;
  status: "CONNECTED" | "DISCONNECTED" | "ERROR" | "PENDING";
  qualityRating: string | null;
  lastConnectedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  webhookCallbackUrl: string;
};

/**
 * Extended shape used ONLY on the integrations configuration page (business owner).
 * Exposes phoneNumberId for webhook setup but NEVER tokens or secrets.
 */
export type WhatsAppConnectionOwnerView = WhatsAppConnectionPublic & {
  phoneNumberId: string;
  businessAccountId: string;
};

export type WhatsAppServiceErrorBody = {
  success: false;
  errorCode: string;
  message: string;
  retryable: boolean;
};

export class WhatsAppServiceError extends Error {
  status: number;
  errorCode: string;
  retryable: boolean;

  constructor(message: string, status: number, errorCode: string, retryable = false) {
    super(message);
    this.name = "WhatsAppServiceError";
    this.status = status;
    this.errorCode = errorCode;
    this.retryable = retryable;
  }

  toBody(): WhatsAppServiceErrorBody {
    return {
      success: false,
      errorCode: this.errorCode,
      message: this.message,
      retryable: this.retryable
    };
  }
}

export type MetaWebhookMessage = {
  from: string;
  id: string;
  timestamp: string;
  type: string;
  text?: { body?: string };
  image?: { id?: string; mime_type?: string; caption?: string };
  document?: { id?: string; mime_type?: string; filename?: string; caption?: string };
  audio?: { id?: string; mime_type?: string };
  video?: { id?: string; mime_type?: string; caption?: string };
  context?: { id?: string };
};

export type MetaWebhookContact = {
  wa_id?: string;
  profile?: { name?: string };
};

export type MetaWebhookChangeValue = {
  messaging_product?: string;
  metadata?: {
    display_phone_number?: string;
    phone_number_id?: string;
  };
  contacts?: MetaWebhookContact[];
  messages?: MetaWebhookMessage[];
  statuses?: Array<Record<string, unknown>>;
};

export type ParsedInboundWhatsAppMessage = {
  connectionPhoneNumberId: string;
  contactPhone: string;
  contactName: string | null;
  wamid: string;
  type: string;
  text: string | null;
  mediaId: string | null;
  mediaUrl: string | null;
  timestamp: Date;
  isGroup: boolean;
  isStatus: boolean;
};

export type WhatsAppWorkflowEvent = {
  type: "WHATSAPP_MESSAGE";
  connectionId: string;
  contact: { name: string | null; phone: string };
  customer: { name: string | null; phone: string };
  message: {
    id: string;
    type: string;
    text: string | null;
    mediaUrl: string | null;
  };
  timestamp: string;
};
