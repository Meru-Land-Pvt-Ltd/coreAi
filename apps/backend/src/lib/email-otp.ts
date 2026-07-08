import { randomInt } from "crypto";
import { prisma } from "./prisma";
import { sendVerificationEmail } from "./mailer";
import { hashPassword, verifyPassword } from "./password";

export type OtpAuthRole = "BUSINESS" | "ARCHITECT";
export type OtpEmailPurpose = "sign_in" | "email_update";

export const OTP_EXPIRES_IN_MINUTES = 10;
export const OTP_RESEND_COOLDOWN_SECONDS = 60;
export const OTP_MAX_ATTEMPTS = 5;

export type OtpVerifyFailure = {
  ok: false;
  message: string;
  code:
    | "OTP_INVALID_OR_EXPIRED"
    | "OTP_TOO_MANY_ATTEMPTS"
    | "INVALID_OTP";
  status: 400 | 401 | 422;
};

export type OtpVerifySuccess = { ok: true };

/**
 * Issue a login/settings verification code and deliver it with the shared OTP
 * email template used by auth login.
 */
export async function issueEmailVerificationCode(
  email: string,
  role: OtpAuthRole,
  purpose: OtpEmailPurpose = "sign_in"
) {
  const cooldownDate = new Date(Date.now() - OTP_RESEND_COOLDOWN_SECONDS * 1000);

  const recentCode = await prisma.emailVerificationCode.findFirst({
    where: {
      email,
      role,
      consumedAt: null,
      createdAt: {
        gte: cooldownDate
      }
    },
    select: { id: true }
  });

  if (recentCode) {
    const error = new Error("Please wait before requesting another code");
    (error as Error & { statusCode?: number; code?: string }).statusCode = 422;
    (error as Error & { code?: string }).code = "OTP_COOLDOWN";
    throw error;
  }

  await prisma.emailVerificationCode.updateMany({
    where: {
      email,
      role,
      consumedAt: null
    },
    data: {
      consumedAt: new Date()
    }
  });

  const code = String(randomInt(100000, 1000000));

  await prisma.emailVerificationCode.create({
    data: {
      email,
      role,
      codeHash: hashPassword(code),
      expiresAt: new Date(Date.now() + OTP_EXPIRES_IN_MINUTES * 60 * 1000)
    }
  });

  await sendVerificationEmail({
    to: email,
    code,
    role,
    purpose
  });

  return { email, role, sent: true as const };
}

export async function verifyEmailVerificationCode(
  email: string,
  role: OtpAuthRole,
  code: string
): Promise<OtpVerifySuccess | OtpVerifyFailure> {
  const verificationCode = await prisma.emailVerificationCode.findFirst({
    where: {
      email,
      role,
      consumedAt: null,
      expiresAt: {
        gt: new Date()
      }
    },
    orderBy: {
      createdAt: "desc"
    }
  });

  if (!verificationCode) {
    return {
      ok: false,
      message: "Verification code is invalid or expired",
      code: "OTP_INVALID_OR_EXPIRED",
      status: 401
    };
  }

  if (verificationCode.attempts >= OTP_MAX_ATTEMPTS) {
    await prisma.emailVerificationCode.update({
      where: { id: verificationCode.id },
      data: { consumedAt: new Date() }
    });

    return {
      ok: false,
      message: "Too many incorrect attempts. Please request a new code",
      code: "OTP_TOO_MANY_ATTEMPTS",
      status: 422
    };
  }

  const isCodeValid = verifyPassword(code, verificationCode.codeHash);

  if (!isCodeValid) {
    await prisma.emailVerificationCode.update({
      where: { id: verificationCode.id },
      data: {
        attempts: {
          increment: 1
        }
      }
    });

    return {
      ok: false,
      message: "Invalid verification code",
      code: "INVALID_OTP",
      status: 401
    };
  }

  await prisma.emailVerificationCode.update({
    where: { id: verificationCode.id },
    data: { consumedAt: new Date() }
  });

  return { ok: true };
}

export function isOtpError(error: unknown): error is Error & { statusCode?: number; code?: string } {
  return error instanceof Error;
}
