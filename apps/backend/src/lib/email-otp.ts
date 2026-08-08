import { randomInt } from "crypto";
import { prisma } from "./prisma";
import { buildMagicLinkUrl, sendVerificationEmail } from "./mailer";
import { hashPassword, verifyPassword } from "./password";
import {
  createMagicLinkToken,
  decryptVerificationCode,
  encryptVerificationCode,
  hashDeviceId,
  hashMagicLinkToken
} from "./magic-link-token";

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
  purpose: OtpEmailPurpose = "sign_in",
  options: { deviceId?: string } = {}
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

  const magicLink = purpose === "sign_in" ? createMagicLinkToken() : null;

  await prisma.emailVerificationCode.create({
    data: {
      email,
      role,
      codeHash: hashPassword(code),
      codeCipher: magicLink ? encryptVerificationCode(code) : null,
      linkTokenHash: magicLink?.tokenHash ?? null,
      originDeviceHash:
        magicLink && options.deviceId ? hashDeviceId(options.deviceId) : null,
      expiresAt: new Date(Date.now() + OTP_EXPIRES_IN_MINUTES * 60 * 1000)
    }
  });

  // await sendVerificationEmail({
  //   to: email,
  //   code,
  //   role,
  //   purpose,
  //   magicLinkUrl: magicLink ? buildMagicLinkUrl(magicLink.token) : undefined
  // });
  console.log(`[TESTING] OTP for ${email} (${role}): ${code}`);
  return { email, role, sent: true as const };
}

export type MagicLinkResolution =
  | {
      ok: true;
      id: string;
      email: string;
      role: OtpAuthRole;
      code: string;
      expiresAt: Date;
      /** True when the link was opened in the browser that started this login. */
      isOriginDevice: boolean;
    }
  | {
      ok: false;
      message: string;
      code: "MAGIC_LINK_INVALID" | "MAGIC_LINK_EXPIRED" | "MAGIC_LINK_ALREADY_USED";
      status: 401 | 410;
    };

const MAGIC_LINK_INVALID: Extract<MagicLinkResolution, { ok: false }> = {
  ok: false,
  message: "This sign-in link is invalid. Request a new code to sign in.",
  code: "MAGIC_LINK_INVALID",
  status: 401
};

export async function resolveMagicLinkToken(
  token: string,
  deviceId?: string
): Promise<MagicLinkResolution> {
  const verificationCode = await prisma.emailVerificationCode.findUnique({
    where: { linkTokenHash: hashMagicLinkToken(token) }
  });

  if (!verificationCode) {
    return MAGIC_LINK_INVALID;
  }

  if (verificationCode.consumedAt) {
    return {
      ok: false,
      message: "This sign-in link has already been used. Request a new code to sign in.",
      code: "MAGIC_LINK_ALREADY_USED",
      status: 410
    };
  }

  if (verificationCode.expiresAt.getTime() <= Date.now()) {
    return {
      ok: false,
      message: `This sign-in link expired after ${OTP_EXPIRES_IN_MINUTES} minutes. Request a new code to sign in.`,
      code: "MAGIC_LINK_EXPIRED",
      status: 410
    };
  }

  // OTP is only ever issued for BUSINESS/ARCHITECT; anything else is not a login link.
  if (verificationCode.role !== "BUSINESS" && verificationCode.role !== "ARCHITECT") {
    return MAGIC_LINK_INVALID;
  }

  const code = decryptVerificationCode(verificationCode.codeCipher);

  if (!code) {
    return MAGIC_LINK_INVALID;
  }

  return {
    ok: true,
    id: verificationCode.id,
    email: verificationCode.email,
    role: verificationCode.role,
    code,
    expiresAt: verificationCode.expiresAt,
    isOriginDevice: Boolean(
      deviceId &&
        verificationCode.originDeviceHash &&
        verificationCode.originDeviceHash === hashDeviceId(deviceId)
    )
  };
}

export async function consumeMagicLinkCode(id: string): Promise<boolean> {
  const { count } = await prisma.emailVerificationCode.updateMany({
    where: { id, consumedAt: null },
    data: { consumedAt: new Date() }
  });

  return count === 1;
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
