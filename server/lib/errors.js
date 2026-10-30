'use strict';

class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.expose = true;
  }
}

const badRequest = (message, details) => new AppError(400, 'bad_request', message, details);
const unauthorized = (message = 'يجب تسجيل الدخول أولاً') => new AppError(401, 'unauthorized', message);
const forbidden = (message = 'لا تملك صلاحية لهذا الإجراء') => new AppError(403, 'forbidden', message);
const notFound = (message = 'العنصر غير موجود') => new AppError(404, 'not_found', message);
const conflict = (message, details) => new AppError(409, 'conflict', message, details);

module.exports = { AppError, badRequest, unauthorized, forbidden, notFound, conflict };
