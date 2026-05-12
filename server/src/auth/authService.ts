import path from "node:path";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { AppConfig } from "../config";
import { deleteFileIfExists, readJsonFile, writeJsonFile } from "../utils/fileStore";
import { authSessionMaxAgeSeconds } from "./sessionAuth";

export interface AuthSession {
  id: string;
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
  passwordFingerprint: string | null;
}

export interface IssuedAuthSession extends AuthSession {
  token: string;
}

export class AuthService {
  private readonly sessions = new Map<string, AuthSession>();
  private readonly sessionsPath: string;

  constructor(private readonly config: AppConfig, dataRoot: string) {
    this.sessionsPath = path.join(dataRoot, "auth", "sessions.json");
  }

  async init(): Promise<void> {
    const stored = await readJsonFile<AuthSession[]>(this.sessionsPath);
    if (!stored) {
      return;
    }
    if (!Array.isArray(stored)) {
      await this.clearAll();
      return;
    }

    let needsSave = false;
    for (const session of stored) {
      if (!isStoredSession(session) || this.isExpired(session) || !this.matchesCurrentPassword(session)) {
        needsSave = true;
        continue;
      }
      this.sessions.set(session.tokenHash, session);
    }

    if (needsSave) {
      await this.save();
    }
  }

  isPasswordRequired(): boolean {
    return this.config.auth.requirePassword;
  }

  hasPasswordConfigured(): boolean {
    return Boolean(process.env.APP_PASSWORD);
  }

  async login(password: string): Promise<IssuedAuthSession> {
    if (this.config.auth.requirePassword) {
      const expected = process.env.APP_PASSWORD;
      if (!expected) {
        throw new Error("APP_PASSWORD is required when auth.requirePassword is true");
      }
      if (!safeEqual(password, expected)) {
        throw new Error("Invalid password");
      }
    }

    const token = randomBytes(32).toString("hex");
    const now = new Date();
    const session = {
      id: randomBytes(16).toString("hex"),
      tokenHash: hashValue(token),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + authSessionMaxAgeSeconds * 1000).toISOString(),
      passwordFingerprint: currentPasswordFingerprint()
    };
    this.sessions.set(session.tokenHash, session);
    await this.save();
    return { ...session, token };
  }

  async logout(token: string | null): Promise<void> {
    if (token) {
      this.sessions.delete(hashValue(token));
      await this.save();
    }
  }

  authenticate(token: string | null): AuthSession | null {
    if (!token) {
      return null;
    }
    const session = this.sessions.get(hashValue(token));
    if (!session || this.isExpired(session) || !this.matchesCurrentPassword(session)) {
      return null;
    }
    return session;
  }

  async clearExpired(): Promise<void> {
    let changed = false;
    for (const [tokenHash, session] of this.sessions) {
      if (this.isExpired(session) || !this.matchesCurrentPassword(session)) {
        this.sessions.delete(tokenHash);
        changed = true;
      }
    }
    if (changed) {
      await this.save();
    }
  }

  async clearAll(): Promise<void> {
    this.sessions.clear();
    await deleteFileIfExists(this.sessionsPath);
  }

  private isExpired(session: AuthSession): boolean {
    return Date.parse(session.expiresAt) <= Date.now();
  }

  private matchesCurrentPassword(session: AuthSession): boolean {
    return session.passwordFingerprint === currentPasswordFingerprint();
  }

  private async save(): Promise<void> {
    await writeJsonFile(this.sessionsPath, [...this.sessions.values()]);
  }
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

function hashValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function currentPasswordFingerprint(): string | null {
  return process.env.APP_PASSWORD ? hashValue(process.env.APP_PASSWORD) : null;
}

function isStoredSession(value: unknown): value is AuthSession {
  if (!value || typeof value !== "object") {
    return false;
  }
  const session = value as Partial<AuthSession>;
  return (
    typeof session.id === "string" &&
    typeof session.tokenHash === "string" &&
    typeof session.createdAt === "string" &&
    typeof session.expiresAt === "string" &&
    (typeof session.passwordFingerprint === "string" || session.passwordFingerprint === null)
  );
}
