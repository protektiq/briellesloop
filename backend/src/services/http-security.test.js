import { describe, expect, it, vi } from "vitest";
import {
  createIpRateLimiter,
  createUrlLengthGuard,
  hasPdfMagicHeader,
} from "./http-security.js";
import { parsePdfTextIsolated } from "./pdf-parse-isolated.js";

const createResponseMock = () => {
  const response = {
    statusCode: 200,
    headers: {},
    payload: null,
    setHeader: vi.fn((name, value) => {
      response.headers[name] = value;
    }),
    status: vi.fn((code) => {
      response.statusCode = code;
      return response;
    }),
    json: vi.fn((payload) => {
      response.payload = payload;
      return response;
    }),
  };
  return response;
};

describe("http security controls", () => {
  it("blocks long malformed URLs with 414", () => {
    const guard = createUrlLengthGuard(64);
    const req = { originalUrl: `/api/share/${"a".repeat(64)}` };
    const res = createResponseMock();
    const next = vi.fn();

    guard(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(414);
    expect(res.payload?.error).toBe("UriTooLong");
  });

  it("accepts normal URL lengths", () => {
    const guard = createUrlLengthGuard(256);
    const req = { originalUrl: "/api/share/validate/token123" };
    const res = createResponseMock();
    const next = vi.fn();

    guard(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("rate-limits high-rate upload floods from the same IP", () => {
    const limiter = createIpRateLimiter({ windowMs: 60_000, maxRequests: 2 });
    const req = { ip: "127.0.0.1", socket: { remoteAddress: "127.0.0.1" } };
    const next = vi.fn();

    const res1 = createResponseMock();
    limiter(req, res1, next);
    const res2 = createResponseMock();
    limiter(req, res2, next);
    const res3 = createResponseMock();
    limiter(req, res3, next);

    expect(next).toHaveBeenCalledTimes(2);
    expect(res3.status).toHaveBeenCalledWith(429);
    expect(res3.headers["Retry-After"]).toBeDefined();
    expect(res3.payload?.error).toBe("RateLimitExceeded");
  });

  it("checks %PDF- magic header", () => {
    expect(hasPdfMagicHeader(Buffer.from("%PDF-1.7\nfoo", "latin1"))).toBe(true);
    expect(hasPdfMagicHeader(Buffer.from("not-a-pdf", "latin1"))).toBe(false);
  });

  it("rejects malformed PDF payloads in isolated parser", async () => {
    const malformedWithHeader = Buffer.from("%PDF-1.7\nthis is not a valid PDF body", "latin1");
    await expect(parsePdfTextIsolated(malformedWithHeader, 2_000)).rejects.toThrow();
  });
});
