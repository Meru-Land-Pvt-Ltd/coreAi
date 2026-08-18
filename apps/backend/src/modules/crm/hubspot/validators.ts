import { z } from "zod";

/**
 * Request validation for the CRM API.
 *
 * Deliberate shape: phone is the only required identifier anywhere. Email and
 * company accept an empty string (meaning "clear this field") and are simply
 * absent when the buyer never filled them in. Nothing here can force a consumer
 * contact to carry a company or an email.
 */

/** Empty string → null so a cleared input clears the CRM property. */
const optionalText = z
  .string()
  .trim()
  .max(255)
  .transform((value) => (value.length ? value : null))
  .nullable()
  .optional();

const phoneSchema = z
  .string()
  .trim()
  .min(7, "Enter a valid phone number")
  .max(32, "Enter a valid phone number");

export const contactListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  stage: z.string().trim().max(100).optional(),
  owner: z.string().trim().max(100).optional(),
  tag: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(10)
});

export const contactSearchQuerySchema = z
  .object({
    phone: z.string().trim().max(32).optional(),
    email: z.string().trim().max(255).optional()
  })
  .refine((value) => Boolean(value.phone || value.email), {
    message: "Provide either phone or email"
  });

export const contactUpdateSchema = z
  .object({
    firstName: optionalText,
    lastName: optionalText,
    // Phone can be changed but never cleared — it is the identity key.
    phone: phoneSchema.optional(),
    email: optionalText,
    company: optionalText,
    preferredLanguage: optionalText,
    stage: optionalText,
    vip: z.boolean().optional()
  })
  .refine((value) => Object.keys(value).length > 0, { message: "No changes supplied" });

export const contactUpsertSchema = z.object({
  phone: phoneSchema,
  firstName: optionalText,
  lastName: optionalText,
  email: optionalText,
  company: optionalText,
  preferredLanguage: optionalText,
  stage: optionalText,
  vip: z.boolean().optional()
});

export const contactNoteSchema = z.object({
  body: z.string().trim().min(1, "Note cannot be empty").max(5000)
});

export const dealStageSchema = z.object({
  stage: z.string().trim().min(1).max(100)
});

export const activeProviderSchema = z.object({
  provider: z.string().trim().min(1).max(50)
});

export type ContactListQuery = z.infer<typeof contactListQuerySchema>;
export type ContactUpdateInput = z.infer<typeof contactUpdateSchema>;
export type ContactUpsertInput = z.infer<typeof contactUpsertSchema>;
