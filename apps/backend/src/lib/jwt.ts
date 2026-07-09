import { sign, verify } from "hono/jwt";
import { env } from "../config/env";

export type JwtUserRole = "ADMIN" | "BUSINESS" | "ARCHITECT";

export type AuthJwtPayload = {
  sub: string;
  email: string;
  role: JwtUserRole;
  sid?: string;
  exp: number;
};

const JWT_ALGORITHM = "HS256";

export async function createAuthToken(
  user: {
    id: string;
    email: string;
    role: JwtUserRole;
  },
  sessionId?: string
) {
  const expiresAt =
    Math.floor(Date.now() / 1000) + env.JWT_EXPIRES_IN_DAYS * 24 * 60 * 60;

  return sign(
    {
      sub: user.id,
      email: user.email,
      role: user.role,
      ...(sessionId ? { sid: sessionId } : {}),
      exp: expiresAt
    },
    env.JWT_SECRET,
    JWT_ALGORITHM
  );
}

export async function verifyAuthToken(token: string): Promise<AuthJwtPayload> {
  const payload = await verify(token, env.JWT_SECRET, JWT_ALGORITHM);

  return {
    sub: String(payload.sub),
    email: String(payload.email),
    role: payload.role as JwtUserRole,
    sid: payload.sid ? String(payload.sid) : undefined,
    exp: Number(payload.exp)
  };
}