import { z } from "zod";

export const authRoleSchema = z.enum(["ADMIN", "BUSINESS", "ARCHITECT"]);

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