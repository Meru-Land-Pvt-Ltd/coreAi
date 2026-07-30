import { z } from "zod";

export const connectWhatsAppSchema = z.object({
  accessToken: z.string().min(10, "Access token is required"),
  phoneNumberId: z.string().min(3, "Phone number ID is required"),
  phoneNumber: z.string().min(5, "Phone number is required"),
  businessAccountId: z.string().min(3).optional(),
  businessName: z.string().trim().max(200).optional(),
  displayName: z.string().trim().max(200).optional(),
  webhookVerifyToken: z.string().min(8).optional(),
  appSecret: z.string().min(8).optional()
});

export const renameWhatsAppConnectionSchema = z.object({
  displayName: z.string().trim().min(1).max(200)
});

export const sendWhatsAppTextSchema = z.object({
  connectionId: z.string().min(1),
  recipient: z.string().min(5),
  message: z.string().min(1).max(4096)
});

export const sendWhatsAppMediaSchema = z.object({
  connectionId: z.string().min(1),
  recipient: z.string().min(5),
  mediaType: z.enum(["image", "document", "audio", "video"]),
  mediaId: z.string().optional(),
  mediaLink: z.string().url().optional(),
  caption: z.string().max(1024).optional(),
  filename: z.string().max(255).optional()
}).refine((value) => Boolean(value.mediaId || value.mediaLink), {
  message: "mediaId or mediaLink is required"
});

export const sendWhatsAppTemplateSchema = z.object({
  connectionId: z.string().min(1),
  recipient: z.string().min(5),
  templateName: z.string().min(1),
  languageCode: z.string().default("en_US"),
  components: z.array(z.record(z.string(), z.unknown())).optional()
});

export type ConnectWhatsAppInput = z.infer<typeof connectWhatsAppSchema>;
export type SendWhatsAppTextInput = z.infer<typeof sendWhatsAppTextSchema>;
