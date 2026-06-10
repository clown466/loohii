import type { NextFunction, Request, Response } from "express";
import { HttpError } from "../lib/httpErrors";

export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
) {
  if (error instanceof HttpError) {
    console.warn(`[http-error] ${req.method} ${req.originalUrl} ${error.status}: ${error.message}`);
    return res.status(error.status).json({ message: error.message });
  }

  if (isPrismaKnownRequestError(error)) {
    return res.status(400).json({
      message: "Database request failed",
      code: error.code,
    });
  }

  if (isPrismaInitializationError(error)) {
    return res.status(503).json({
      message: "Database is not ready. Check DATABASE_URL and run Prisma migrations.",
    });
  }

  if (isDatabaseSetupError(error)) {
    return res.status(503).json({
      message: error.message,
    });
  }

  const message = error instanceof Error ? error.message : "Internal server error";
  console.error(error);
  return res.status(500).json({ message });
}

function isPrismaKnownRequestError(error: unknown): error is { code: string } {
  return (
    error instanceof Error &&
    error.name === "PrismaClientKnownRequestError" &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
  );
}

function isPrismaInitializationError(error: unknown): error is Error {
  return error instanceof Error && error.name === "PrismaClientInitializationError";
}

function isDatabaseSetupError(error: unknown): error is Error {
  return (
    error instanceof Error &&
    (error.message.includes("DATABASE_URL is not configured") ||
      error.message.includes("Prisma Client is not generated"))
  );
}
