import { z } from "zod";

// Login may target any role (ADMIN included).
export const authRoleSchema = z.enum(["ADMIN", "BUSINESS", "ARCHITECT"]);

// OTP and public signup must never create ADMIN accounts — admins come only from
// the seed script. Keep ADMIN out of these role schemas.
export const otpAuthRoleSchema = z.enum(["BUSINESS", "ARCHITECT"]);
export const publicSignupRoleSchema = z.enum(["BUSINESS", "ARCHITECT"]);

export const signupSchema = z.object({
  fullName: z.string().trim().min(2, "Full name is required"),
  email: z.string().trim().toLowerCase().email("Valid email is required"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  role: publicSignupRoleSchema
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Valid email is required"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  role: authRoleSchema
});

const deviceIdSchema = z
  .string()
  .trim()
  .min(8)
  .max(100)
  .regex(/^[A-Za-z0-9_-]+$/, "Invalid device id");

export const sendVerificationCodeSchema = z.object({
  email: z.string().trim().toLowerCase().email("Valid email is required"),
  role: otpAuthRoleSchema,
  deviceId: deviceIdSchema.optional()
});

export const verifyCodeSchema = z.object({
  email: z.string().trim().toLowerCase().email("Valid email is required"),
  role: otpAuthRoleSchema,
  code: z.string().trim().regex(/^\d{6}$/, "Valid 6-digit code is required")
});

// Token from the emailed sign-in link. base64url of 32 random bytes → 43 chars.
export const magicLinkCompleteSchema = z.object({
  token: z
    .string()
    .trim()
    .min(20, "Sign-in link token is required")
    .max(200, "Sign-in link token is invalid")
    .regex(/^[A-Za-z0-9_-]+$/, "Sign-in link token is invalid"),
  deviceId: deviceIdSchema.optional(),
  /** Visitor on a second device chose to finish the login there instead. */
  signInHere: z.boolean().optional()
});

export const firebaseLoginSchema = z.object({
  idToken: z.string().min(10, "Firebase ID token is required"),
  role: z.enum(["BUSINESS", "ARCHITECT"])
});