import express from "express";
import { readFileSync } from "node:fs";
import { GpmpayError, partnerApi, verifySignature } from "./gpmpay.js";

const PORT = Number(process.env.PORT || 4000);
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/+$/, "");
const WIDGET_SCRIPT_URL =
  process.env.WIDGET_SCRIPT_URL || "https://sandbox-widget-connect.gpmpay.com/v1/connect.js";
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "";
const MAX_WEBHOOKS = 50;
const MAX_SESSIONS = 50;
const TRANSACTION_FILTERS = ["bankAccountId", "transferType", "source", "startDate", "endDate"];

const webhooks = [];
// Đối tác thật lưu sessionId cùng mã khách/quán của mình trong DB để biết STK kết nối xong thuộc về ai.
const sessions = [];

function rememberSession(session, details) {
  sessions.unshift({ ...details, sessionId: session.sessionId, createdAt: new Date().toISOString() });
  sessions.length = Math.min(sessions.length, MAX_SESSIONS);
  return session;
}
const app = express();

// Đọc body thô để kiểm chữ ký — phải đặt TRƯỚC express.json().
app.post("/webhook", express.raw({ type: "*/*" }), (req, res) => {
  const rawBody = req.body.toString("utf8");
  const signatureValid = WEBHOOK_SECRET
    ? verifySignature(rawBody, WEBHOOK_SECRET, req.get("X-GPMPay-Signature"))
    : null;
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    payload = rawBody;
  }
  webhooks.unshift({ receivedAt: new Date().toISOString(), signatureValid, payload });
  webhooks.length = Math.min(webhooks.length, MAX_WEBHOOKS);
  // GPMPay coi 2xx là giao thành công; chữ ký sai thì đối tác thật nên trả 401.
  res.status(signatureValid === false ? 401 : 200).json({ received: true });
});

app.use(express.json());

const indexHtml = readFileSync(new URL("./public/index.html", import.meta.url), "utf8").replace(
  "{{WIDGET_SCRIPT_URL}}",
  WIDGET_SCRIPT_URL,
);
app.get("/", (_req, res) => res.type("html").send(indexHtml));
app.use(express.static(new URL("./public", import.meta.url).pathname));

const route = (handler) => async (req, res) => {
  try {
    res.json(await handler(req));
  } catch (err) {
    const status = err instanceof GpmpayError ? err.status : 500;
    res.status(status).json({ error: err.message });
  }
};

app.get(
  "/api/config",
  route(async () => ({
    publicUrl: PUBLIC_URL,
    paymentSimulation: process.env.PAYMENT_SIMULATION === "true",
    hasToken: Boolean(process.env.GPMPAY_PARTNER_TOKEN),
  })),
);

app.get(
  "/api/banks",
  route(() => partnerApi("GET", "/banks")),
);

app.post(
  "/api/connect",
  route(async ({ body }) => {
    const session = await partnerApi("POST", "/connect-sessions", {
      email: body.email,
      name: body.name || undefined,
      phone: body.phone || undefined,
      origin: PUBLIC_URL,
      // Tạo webhook ngay khi STK kết nối xong để không lỡ giao dịch đầu tiên.
      ...(body.autoWebhook
        ? {
            webhook: {
              url: `${PUBLIC_URL}/webhook`,
              authorizationType: "HMAC",
              authorizationSecret: WEBHOOK_SECRET,
            },
          }
        : {}),
    });
    return rememberSession(session, { mode: "CONNECT", email: body.email });
  }),
);

app.post(
  "/api/disconnect",
  route(async ({ body }) =>
    rememberSession(
      await partnerApi("POST", "/disconnect-sessions", {
        bankAccountId: body.bankAccountId,
        origin: PUBLIC_URL,
      }),
      { mode: "DISCONNECT", bankAccountId: body.bankAccountId },
    ),
  ),
);
app.get("/api/sessions", (_req, res) => res.json(sessions));
app.get(
  "/api/connect-sessions/:id",
  route(({ params }) => partnerApi("GET", `/connect-sessions/${params.id}`)),
);
app.get(
  "/api/transactions",
  route(({ query }) => {
    const search = new URLSearchParams({ limit: "50" });
    for (const key of TRANSACTION_FILTERS) {
      if (query[key]) search.set(key, String(query[key]));
    }
    return partnerApi("GET", `/transactions?${search}`);
  }),
);

app.get(
  "/api/bank-accounts",
  route(({ query }) =>
    partnerApi(
      "GET",
      query.expiresBefore
        ? `/bank-accounts?limit=50&expiresBefore=${encodeURIComponent(query.expiresBefore)}`
        : "/bank-accounts?limit=50&includeDeleted=true",
    ),
  ),
);
app.post(
  "/api/bank-accounts/:id/bills",
  route(({ params, body }) =>
    partnerApi("POST", `/bank-accounts/${params.id}/bills`, { planId: body.planId }),
  ),
);
app.get(
  "/api/bills",
  route(({ query }) => partnerApi("GET", `/bills?status=${query.status || "PENDING"}&limit=50`)),
);
app.get("/api/bills/:id", route(({ params }) => partnerApi("GET", `/bills/${params.id}`)));
app.post(
  "/api/bills/:id/simulate-payment",
  route(({ params }) => partnerApi("POST", `/bills/${params.id}/simulate-payment`)),
);
app.get(
  "/api/batch-orders",
  route(({ query }) => partnerApi("GET", `/batch-orders?status=${query.status || "PENDING"}&limit=50`)),
);
app.post(
  "/api/batch-orders",
  route(({ body }) => partnerApi("POST", "/batch-orders", { billIds: body.billIds })),
);
app.get("/api/batch-orders/:id", route(({ params }) => partnerApi("GET", `/batch-orders/${params.id}`)));
app.delete("/api/batch-orders/:id", route(({ params }) => partnerApi("DELETE", `/batch-orders/${params.id}`)));
app.post(
  "/api/batch-orders/:id/simulate-payment",
  route(({ params }) => partnerApi("POST", `/batch-orders/${params.id}/simulate-payment`)),
);
app.get("/api/webhooks", (_req, res) => res.json(webhooks));

app.listen(PORT, () => {
  console.log(`Demo Widget connect: ${PUBLIC_URL} (port ${PORT})`);
  if (!process.env.GPMPAY_PARTNER_TOKEN) console.warn("Chưa có GPMPAY_PARTNER_TOKEN trong .env");
});
