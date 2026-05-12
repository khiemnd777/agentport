export class AppError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function notFound(message: string): AppError {
  return new AppError(404, message);
}

export function badRequest(message: string): AppError {
  return new AppError(400, message);
}

export function unauthorized(message = "Unauthorized"): AppError {
  return new AppError(401, message);
}

export function conflict(message: string): AppError {
  return new AppError(409, message);
}

export function serviceUnavailable(message: string): AppError {
  return new AppError(503, message);
}
