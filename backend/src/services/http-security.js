const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_REQUESTS = 5;

export const createUrlLengthGuard = (maxLength = 2048) => {
  const limit = Number.parseInt(String(maxLength), 10);
  if (!Number.isInteger(limit) || limit < 64 || limit > 16_384) {
    throw new Error("maxLength must be an integer between 64 and 16384.");
  }

  return (req, res, next) => {
    const url = typeof req.originalUrl === "string" ? req.originalUrl : "";
    if (url.length > limit) {
      return res.status(414).json({
        error: "UriTooLong",
        message: `Request URL must be at most ${limit} characters.`,
      });
    }
    return next();
  };
};

export const createIpRateLimiter = ({
  windowMs = DEFAULT_WINDOW_MS,
  maxRequests = DEFAULT_MAX_REQUESTS,
} = {}) => {
  const windowLimit = Number.parseInt(String(windowMs), 10);
  const requestLimit = Number.parseInt(String(maxRequests), 10);
  if (!Number.isInteger(windowLimit) || windowLimit < 1_000 || windowLimit > 3_600_000) {
    throw new Error("windowMs must be an integer between 1000 and 3600000.");
  }
  if (!Number.isInteger(requestLimit) || requestLimit < 1 || requestLimit > 10_000) {
    throw new Error("maxRequests must be an integer between 1 and 10000.");
  }

  const counters = new Map();
  return (req, res, next) => {
    const rawIp =
      typeof req.ip === "string" && req.ip.trim().length > 0
        ? req.ip.trim()
        : req.socket?.remoteAddress ?? "unknown";
    const now = Date.now();
    const existing = counters.get(rawIp);
    if (!existing || now - existing.windowStart >= windowLimit) {
      counters.set(rawIp, { windowStart: now, count: 1 });
      return next();
    }

    existing.count += 1;
    if (existing.count > requestLimit) {
      const retryAfterSeconds = Math.max(1, Math.ceil((windowLimit - (now - existing.windowStart)) / 1_000));
      res.setHeader("Retry-After", String(retryAfterSeconds));
      return res.status(429).json({
        error: "RateLimitExceeded",
        message: `Too many requests. Limit is ${requestLimit} per ${windowLimit / 1000}s.`,
      });
    }

    return next();
  };
};

export const hasPdfMagicHeader = (bufferLike) => {
  if (!Buffer.isBuffer(bufferLike) || bufferLike.length < 5) {
    return false;
  }
  return bufferLike.subarray(0, 5).toString("latin1") === "%PDF-";
};
