import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config";
import { unauthorized } from "../lib/httpErrors";

export interface AuthUser {
  id: string;
  email: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function signToken(user: AuthUser): string {
  return jwt.sign(user, config.jwtSecret, { expiresIn: "30d" });
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const token = readToken(req);
  if (!token) return next();

  try {
    req.user = jwt.verify(token, config.jwtSecret, { algorithms: ["HS256"] }) as AuthUser;
  } catch {
    req.user = undefined;
  }

  return next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  optionalAuth(req, _res, () => undefined);
  if (!req.user?.id) {
    unauthorized();
  }
  return next();
}

function readToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  if (header.startsWith("Bearer ")) return header.slice(7).trim();
  return header.trim();
}

