import { Hono } from "hono";
import type { AuthService } from "./authService";
import { clearSessionCookie, createSessionCookie, getAuthToken } from "./sessionAuth";
import { parseJsonObject } from "../utils/validation";
import { serviceUnavailable, unauthorized } from "../utils/httpErrors";

export function authRoutes(authService: AuthService): Hono {
  const app = new Hono();

  app.post("/login", async (c) => {
    const body = parseJsonObject(await c.req.json().catch(() => ({})));
    const password = typeof body.password === "string" ? body.password : "";
    try {
      const session = await authService.login(password);
      c.header("Set-Cookie", createSessionCookie(session.token));
      return c.json({ authenticated: true });
    } catch (error) {
      const message = (error as Error).message;
      if (message === "Invalid password") {
        throw unauthorized("Invalid password");
      }
      if (message === "APP_PASSWORD is required when auth.requirePassword is true") {
        throw serviceUnavailable("APP_PASSWORD is not configured on the server.");
      }
      throw error;
    }
  });

  app.post("/logout", async (c) => {
    const token = getAuthToken(c.req.header("cookie") ?? null);
    await authService.logout(token);
    c.header("Set-Cookie", clearSessionCookie());
    return c.json({ authenticated: false });
  });

  app.get("/me", (c) => {
    const token = getAuthToken(c.req.header("cookie") ?? null);
    return c.json({
      authenticated: Boolean(authService.authenticate(token)),
      requirePassword: authService.isPasswordRequired(),
      passwordConfigured: authService.hasPasswordConfigured()
    });
  });

  return app;
}
