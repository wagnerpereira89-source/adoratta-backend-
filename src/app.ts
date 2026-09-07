import { Hono } from "hono";
import { cors } from "hono/cors";
import { env } from "./lib/env.js";
import { WooCommerceError } from "./lib/woocommerce.js";
import { orders } from "./routes/orders.js";
import { payments } from "./routes/payments.js";

export const app = new Hono().basePath("/api");

app.use("*", cors({ origin: env.allowedOrigin }));

// Token compartilhado opcional (APP_SHARED_TOKEN) — se não configurado, não exige nada.
app.use("*", async (c, next) => {
  const expected = env.appSharedToken;
  if (!expected) return next();

  const provided = c.req.header("x-app-token");
  if (provided !== expected) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  return next();
});

app.onError((err, c) => {
  if (err instanceof WooCommerceError) {
    return c.json({ error: err.message }, err.status >= 400 && err.status < 600 ? (err.status as any) : 502);
  }
  console.error(err);
  return c.json({ error: "Internal server error" }, 500);
});

app.get("/health", (c) => c.json({ ok: true }));

app.route("/orders", orders);
app.route("/payments", payments);
