export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function notFound(message = "Not found"): never {
  throw new HttpError(404, message);
}

export function badRequest(message = "Bad request"): never {
  throw new HttpError(400, message);
}

export function unauthorized(message = "Unauthorized"): never {
  throw new HttpError(401, message);
}

export function routeParam(value: string | string[] | undefined, name: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  throw new HttpError(400, `Missing or invalid route parameter: ${name}`);
}
