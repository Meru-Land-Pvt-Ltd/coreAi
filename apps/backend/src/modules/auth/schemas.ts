import { z } from "zod";

export const authRoleSchema = z.enum(["ADMIN", "BUSINESS", "ARCHITECT"]);

export const otpAuthRoleSchema = z.enum(["BUSINESS", "ARCHITECT"]);

export const signupSchema = z.object({
  fullName: z.string().trim().min(2, "Full name is required"),
  email: z.string().trim().toLowerCase().email("Valid email is required"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  role: authRoleSchema
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Valid email is required"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  role: authRoleSchema
});

export const sendVerificationCodeSchema = z.object({
  email: z.string().trim().toLowerCase().email("Valid email is required"),
  role: otpAuthRoleSchema
});

export const verifyCodeSchema = z.object({
  email: z.string().trim().toLowerCase().email("Valid email is required"),
  role: otpAuthRoleSchema,
  code: z.string().trim().regex(/^\d{6}$/, "Valid 6-digit code is required")
});

export const firebaseLoginSchema = z.object({
  idToken: z.string().min(10, "Firebase ID token is required"),
  role: z.enum(["BUSINESS", "ARCHITECT"])
});