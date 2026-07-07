import { randomUUID } from "crypto";
import type { Context } from "hono";
import type { LoginHistoryStatus } from "@prisma/client";
import { env } from "../config/env";
import { prisma } from "./prisma";

export function maskIp(ip: string) {
  const parts = ip.split(".");
  if (parts.length === 4) {
    return `${parts[0]}.${parts[1]}.•••.•••`;
  }

  return "•••.•••.•••.•••";
}

export function parseDeviceLabel(userAgent: string) {
  const ua = userAgent.toLowerCase();

  if (/iphone|ipad|ipod/.test(ua)) {
    return /ipad/.test(ua) ? "Safari on iPad" : "Safari on iPhone";
  }

  if (/android/.test(ua)) {
    return "Chrome on Android";
  }

  if (/vscode|node-fetch|axios|curl|postman/.test(ua)) {
    return "VS Code (API)";
  }

  if (/firefox/.test(ua)) {
    return /mac/.test(ua) ? "Firefox on Mac" : "Firefox";
  }

  if (/edg\//.test(ua)) {
    return "Edge";
  }

  if (/chrome/.test(ua)) {
    return /mac/.test(ua) ? "Chrome on Mac" : "Chrome";
  }

  if (/safari/.test(ua)) {
    return "Safari";
  }

  return "Unknown browser";
}

export function getRequestMeta(c: Context) {
  const userAgent = c.req.header("user-agent") ?? "Unknown";
  const forwarded = c.req.header("x-forwarded-for");
  const ip =
    forwarded?.split(",")[0]?.trim() ??
    c.req.header("x-real-ip") ??
    c.req.header("cf-connecting-ip") ??
    "127.0.0.1";

  return {
    userAgent,
    deviceLabel: parseDeviceLabel(userAgent),
    ipMasked: maskIp(ip),
    location: c.req.header("x-geo-location") ?? null
  };
}

export async function recordUserLogin(
  userId: string,
  c: Context,
  status: LoginHistoryStatus = "SUCCESS"
) {
  const meta = getRequestMeta(c);

  await prisma.userLoginHistory.create({
    data: {
      userId,
      deviceLabel: meta.deviceLabel,
      location: meta.location,
      ipMasked: meta.ipMasked,
      userAgent: meta.userAgent,
      status
    }
  });
}

export async function createUserSession(userId: string, c: Context) {
  const meta = getRequestMeta(c);
  const tokenSid = randomUUID();
  const expiresAt = new Date(Date.now() + env.JWT_EXPIRES_IN_DAYS * 24 * 60 * 60 * 1000);

  await prisma.userActiveSession.create({
    data: {
      userId,
      tokenSid,
      deviceLabel: meta.deviceLabel,
      location: meta.location,
      ipMasked: meta.ipMasked,
      userAgent: meta.userAgent,
      expiresAt
    }
  });

  return { tokenSid, expiresAt };
}

export async function issueAuthSession(userId: string, c: Context) {
  await recordUserLogin(userId, c, "SUCCESS");
  return createUserSession(userId, c);
}

export async function assertActiveSession(userId: string, tokenSid?: string) {
  if (!tokenSid) return true;

  const session = await prisma.userActiveSession.findUnique({
    where: { tokenSid }
  });

  // Allow tokens issued before session tracking or when the session row is missing.
  if (!session) return true;

  if (session.userId !== userId || session.revokedAt) {
    return false;
  }

  if (session.expiresAt.getTime() <= Date.now()) {
    return false;
  }

  await prisma.userActiveSession.update({
    where: { id: session.id },
    data: { lastActiveAt: new Date() }
  });

  return true;
}

export function serializeLoginHistory(entry: {
  id: string;
  createdAt: Date;
  deviceLabel: string;
  location: string | null;
  status: LoginHistoryStatus;
}) {
  return {
    id: entry.id,
    date: entry.createdAt.toISOString(),
    device: entry.deviceLabel,
    location: entry.location ?? "Unknown",
    status: entry.status === "SUCCESS" ? "Success" : "Blocked"
  };
}

export function serializeActiveSession(
  session: {
    id: string;
    tokenSid: string;
    deviceLabel: string;
    location: string | null;
    ipMasked: string | null;
    lastActiveAt: Date;
    createdAt: Date;
  },
  currentSid?: string
) {
  const isCurrent = Boolean(currentSid && session.tokenSid === currentSid);
  const activeNow = Date.now() - session.lastActiveAt.getTime() < 5 * 60 * 1000;

  return {
    id: session.id,
    deviceLabel: session.deviceLabel,
    location: session.location ?? "Unknown",
    ipMasked: session.ipMasked ?? "•••.•••.•••",
    isCurrent,
    statusLabel: isCurrent && activeNow ? "Active now" : `Last active ${formatRelativeTime(session.lastActiveAt)}`,
    lastActiveAt: session.lastActiveAt.toISOString()
  };
}

function formatRelativeTime(date: Date) {
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.floor(diffMs / 60000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;

  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
