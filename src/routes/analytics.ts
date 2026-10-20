import { Hono } from "hono";
import { getCached, setCached, CACHE_PREFIX } from "../lib/redis.js";
import { getGA4Summary, EMPTY_GA4_SUMMARY, type GA4Summary } from "../lib/ga4.js";

export const analytics = new Hono();

const SUMMARY_TTL = 10 * 60; // 10min, mesmo padrão de /payments/summary

// Mesma normalização de /payments/summary: arredonda pro minuto pra bater na
// mesma chave em chamadas repetidas do "mesmo" período.
function normalizePeriodKey(value: string | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  d.setSeconds(0, 0);
  return d.toISOString();
}

// GET /analytics/summary?after=&before= — métricas do GA4 (usuários, páginas,
// funil de conversão, origem de tráfego), cacheadas (a API do GA4 tem cota).
analytics.get("/summary", async (c) => {
  const after = c.req.query("after");
  const before = c.req.query("before");
  const bypass = c.req.header("x-refresh") === "1";

  const summaryKey = `${CACHE_PREFIX.analyticsSummary}${normalizePeriodKey(after)}:${normalizePeriodKey(before)}`;

  if (!bypass) {
    const cached = await getCached<GA4Summary>(summaryKey);
    if (cached) return c.json(cached);
  }

  let summary: GA4Summary;
  try {
    summary = await getGA4Summary(after, before);
  } catch (error) {
    // GA4 recém-ligado, sem dado, ou qualquer falha da API — nunca derruba a
    // rota. Devolve zerado (o app sabe renderizar isso) e não cacheia o erro,
    // pra próxima chamada tentar de novo.
    console.error("[analytics/summary] GA4 falhou, devolvendo zerado:", error);
    return c.json(EMPTY_GA4_SUMMARY);
  }

  await setCached(summaryKey, summary, SUMMARY_TTL);
  return c.json(summary);
});
