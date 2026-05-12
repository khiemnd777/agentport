import type { MiddlewareHandler } from "hono";
import type { AuthService, AuthSession } from "./authService";
import { unauthorized } from "../utils/httpErrors";

export const authCookieName = "rcd_session";
export const authSessionMaxAgeSeconds = 30 * 24 * 60 * 60;

export interface AuthVariables {
  authSession: AuthSession;
}

export function parseCookies(cookieHeader: string | null): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) {
    return cookies;
  }
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (!name) {
      continue;
    }
    cookies[name] = decodeURIComponent(rest.join("="));
  }
  return cookies;
}

export function getAuthToken(cookieHeader: string | null): string | null {
  return parseCookies(cookieHeader)[authCookieName] ?? null;
}

export function createSessionCookie(token: string): string {
  return `${authCookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${authSessionMaxAgeSeconds}`;
}

export function clearSessionCookie(): string {
  return `${authCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function requireAuth(authService: AuthService): MiddlewareHandler<{ Variables: AuthVariables }> {
  return async (c, next) => {
    const token = getAuthToken(c.req.header("cookie") ?? null);
    const session = authService.authenticate(token);
    if (!session) {
      throw unauthorized();
    }
    c.set("authSession", session);
    await next();
  };
}
