import type { Request, Response, NextFunction } from "express";
import { authInvalid, authRequired, originNotAllowed } from "./errors";
import type { TokenStore } from "./tokens";

const ALLOWED_HOSTS = new Set(["127.0.0.1", "localhost"]);

export const getOrigin = (req: Request) => req.headers.origin || "";

const isLoopbackAddress = (address: string | undefined) => {
  if (!address) {
    return false;
  }
  if (address === "127.0.0.1" || address === "::1") {
    return true;
  }
  return address.startsWith("::ffff:127.0.0.1");
};

export const originGuard = (allowlist: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const origin = getOrigin(req);
    if (!origin || !allowlist.includes(origin)) {
      return next(originNotAllowed());
    }

    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Authorization, Content-Type",
    );
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Max-Age", "600");

    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }

    next();
  };
};

export const hostGuard = () => {
  return (req: Request, _res: Response, next: NextFunction) => {
    const host = req.headers.host?.split(":")[0];
    if (!host || !ALLOWED_HOSTS.has(host)) {
      return next(originNotAllowed());
    }
    next();
  };
};

export const loopbackGuard = () => {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!isLoopbackAddress(req.socket.remoteAddress)) {
      return next(originNotAllowed());
    }
    next();
  };
};

export const authGuard = (tokenStore: TokenStore) => {
  return (req: Request, _res: Response, next: NextFunction) => {
    const origin = getOrigin(req);
    const auth = req.headers.authorization;
    if (!auth) {
      return next(authRequired());
    }
    const match = auth.match(/^Bearer (.+)$/i);
    if (!match) {
      return next(authInvalid());
    }
    const token = match[1];
    if (!tokenStore.verifyToken(origin, token)) {
      return next(authInvalid());
    }
    next();
  };
};
