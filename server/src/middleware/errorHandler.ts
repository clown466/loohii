import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
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

  // P4-B（P3C-1 / P2-C S4 统一治理）：zod 入参校验失败是 400 不是 500；
  // 文案取首个 issue（根路径 refine 直接给 message），不再把 zod JSON 塞给前端
  if (error instanceof ZodError) {
    const issue = error.issues[0];
    const where = issue?.path?.length ? `${issue.path.join(".")}: ` : "";
    const message = issue ? `${where}${issue.message}` : "请求参数不合法";
    console.warn(`[validation-error] ${req.method} ${req.originalUrl}: ${message}`);
    return res.status(400).json({ message });
  }

  if (isPrismaKnownRequestError(error)) {
    console.error(`[prisma-error] ${req.method} ${req.originalUrl} ${error.code}: ${error.message}`, {
      code: error.code,
      meta: "meta" in error ? (error as { meta?: unknown }).meta : undefined,
    });
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

function isPrismaKnownRequestError(error: unknown): error is { code: string; message: string } {
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
