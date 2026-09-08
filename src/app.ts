import { Hono } from "hono";
import { cors } from "hono/cors";
import { env } from "./lib/env.js";
import { WooCommerceError } from "./lib/woocommerce.js";
import { checkRedisHealth } from "./lib/redis.js";
import { orders } from "./routes/orders.js";
import { payments } from "./routes/payments.js";

export const app = new Hono().basePath("/api");

// localhost/127.0.0.1 em qualquer porta é sempre aceito (dev local), além das
// origens de produção configuradas em ALLOWED_ORIGIN — assim o dev não fica
// refém de manter essa env var em sincronia com a porta do Vite.
const LOCALHOST_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

// Deploys de preview da Vercel para o app (adoratta-app) — a Vercel gera uma
// URL nova a cada deploy/branch, sempre no formato
// adoratta<algo>-wagnerpereira89-sources-projects.vercel.app (o "<algo>" varia:
// hash do deploy, nome da branch truncado, etc.). Sem isso, cada preview novo
// exigiria atualizar ALLOWED_ORIGIN manualmente. Escopo restrito ao subdomínio
// da equipe/projeto na Vercel — não libera vercel.app em geral.
const VERCEL_PREVIEW_ORIGIN = /^https:\/\/adoratta[a-z0-9-]*-wagnerpereira89-sources-projects\.vercel\.app$/;

app.use(
  "*",
  cors({
    origin: (origin) => {
      const allowed = env.allowedOrigins;
      if (allowed === "*") return "*";
      if (LOCALHOST_ORIGIN.test(origin)) return origin;
      if (VERCEL_PREVIEW_ORIGIN.test(origin)) return origin;
      return allowed.includes(origin) ? origin : undefined;
    },
  }),
);

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

// Sempre responde 200 mesmo se o Redis estiver fora do ar — o app não deve
// depender do cache para ficar de pé. Timeout de 3s garantido pelo cliente Redis.
app.get("/health", async (c) => {
  const redis = await checkRedisHealth();
  return c.json({ ok: true, redis });
});

app.route("/orders", orders);
app.route("/payments", payments);
