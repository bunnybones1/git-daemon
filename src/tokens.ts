import { promises as fs } from "fs";
import crypto from "crypto";
import { getTokensPath } from "./config";
import type { TokenEntry, TokenStoreData } from "./types";

const TOKEN_BYTES = 32;
const HASH_BYTES = 32;

export class TokenStore {
  private entries: TokenEntry[] = [];
  private readonly tokensPath: string;

  constructor(configDir: string) {
    this.tokensPath = getTokensPath(configDir);
  }

  async load() {
    try {
      const raw = await fs.readFile(this.tokensPath, "utf8");
      const data = JSON.parse(raw) as TokenStoreData;
      this.entries = Array.isArray(data.entries) ? data.entries : [];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw err;
      }
      this.entries = [];
      await this.save();
    }
    this.pruneExpired();
  }

  private async save() {
    const payload: TokenStoreData = { entries: this.entries };
    await fs.writeFile(this.tokensPath, JSON.stringify(payload, null, 2));
  }

  private pruneExpired() {
    const now = Date.now();
    this.entries = this.entries.filter((entry) => {
      const expiresAt = Date.parse(entry.expiresAt);
      return Number.isNaN(expiresAt) || expiresAt > now;
    });
  }

  getActiveToken(origin: string): TokenEntry | undefined {
    this.pruneExpired();
    return this.entries.find((entry) => entry.origin === origin);
  }

  async issueToken(origin: string, ttlDays: number) {
    const token = crypto.randomBytes(TOKEN_BYTES).toString("base64url");
    const salt = crypto.randomBytes(16).toString("base64url");
    const tokenHash = crypto
      .scryptSync(token, salt, HASH_BYTES)
      .toString("base64url");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000);

    const entry: TokenEntry = {
      origin,
      tokenHash,
      salt,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };

    this.entries = this.entries.filter((item) => item.origin !== origin);
    this.entries.push(entry);
    await this.save();

    return {
      token,
      expiresAt: entry.expiresAt,
    };
  }

  async revokeToken(origin: string) {
    this.entries = this.entries.filter((item) => item.origin !== origin);
    await this.save();
  }

  verifyToken(origin: string, token: string): boolean {
    this.pruneExpired();
    const entry = this.entries.find((item) => item.origin === origin);
    if (!entry) {
      return false;
    }
    const derived = crypto.scryptSync(token, entry.salt, HASH_BYTES);
    const stored = Buffer.from(entry.tokenHash, "base64url");
    if (stored.length !== derived.length) {
      return false;
    }
    return crypto.timingSafeEqual(stored, derived);
  }
}
