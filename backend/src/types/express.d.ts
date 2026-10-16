import 'express-serve-static-core';

declare module 'express-serve-static-core' {
  interface Request {
    // DTO instances produced by the validate() middleware, keyed by source.
    validated?: { body?: unknown; query?: unknown; params?: unknown };
  }
}
