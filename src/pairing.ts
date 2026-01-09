import crypto from "crypto";
import type { TokenStore } from "./tokens";

const PAIRING_TTL_MS = 10 * 60 * 1000;

export class PairingManager {
  private readonly tokenStore: TokenStore;
  private readonly ttlDays: number;
  private readonly codes = new Map<
    string,
    { code: string; expiresAt: number }
  >();

  constructor(tokenStore: TokenStore, ttlDays: number) {
    this.tokenStore = tokenStore;
    this.ttlDays = ttlDays;
  }

  start(origin: string) {
    const code = crypto.randomBytes(4).toString("hex");
    const expiresAt = Date.now() + PAIRING_TTL_MS;
    this.codes.set(origin, { code, expiresAt });

    return {
      step: "start" as const,
      instructions:
        "Enter this code in the Git Daemon pairing prompt within 10 minutes.",
      code,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  async confirm(origin: string, code: string) {
    const entry = this.codes.get(origin);
    if (!entry || entry.code !== code || entry.expiresAt < Date.now()) {
      return null;
    }

    this.codes.delete(origin);
    const { token, expiresAt } = await this.tokenStore.issueToken(
      origin,
      this.ttlDays,
    );

    return {
      step: "confirm" as const,
      accessToken: token,
      tokenType: "Bearer" as const,
      expiresAt,
    };
  }
}
