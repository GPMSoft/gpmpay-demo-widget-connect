import { createHmac, timingSafeEqual } from "node:crypto";

const apiBase = () =>
  `${(process.env.GPMPAY_API_URL || "https://sandbox-api.gpmpay.com").replace(/\/+$/, "")}/api/v1/partner`;

export class GpmpayError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/** Response thành công bọc trong { statusCode, message, data }. */
export async function partnerApi(method, path, body) {
  const res = await fetch(`${apiBase()}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${process.env.GPMPAY_PARTNER_TOKEN}`,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = Array.isArray(json.message) ? json.message.join(", ") : json.message;
    throw new GpmpayError(message || `HTTP ${res.status}`, res.status);
  }
  return json.data;
}

/**
 * Header dạng `t=<unix>,v1=<hex>`; chữ ký là HMAC-SHA256 của `${t}.${rawBody}`.
 * Phải ký trên body THÔ — parse JSON rồi stringify lại là lệch byte.
 */
export function verifySignature(rawBody, secret, header) {
  const parts = Object.fromEntries(
    String(header ?? "")
      .split(",")
      .map((part) => part.split("=")),
  );
  if (!parts.t || !parts.v1) return false;
  const expected = createHmac("sha256", secret).update(`${parts.t}.${rawBody}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(parts.v1);
  return a.length === b.length && timingSafeEqual(a, b);
}
