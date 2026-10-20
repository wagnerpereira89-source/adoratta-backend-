import { Hono } from "hono";
import { getCached, setCached, CACHE_PREFIX } from "../lib/redis.js";
import { getGA4Summary, withTimeout, EMPTY_GA4_SUMMARY, type GA4Summary } from "../lib/ga4.js";

export const analytics = new Hono();

const SUMMARY_TTL = 10 * 60; // 10min, mesmo padrão de /payments/summary
// Rede de segurança no nível da rota inteira (cache + client + GA4), não só
// nas chamadas do GA4 — se QUALQUER etapa travar (ex: o próprio Redis),
// a rota ainda responde dentro desse prazo em vez de pendurar pra sempre.
const ROUTE_TIMEOUT_MS = 15_000;

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
// Todo o corpo (cache + GA4 + cache de novo) isolado numa função pra poder
// envolver a execução INTEIRA em um único timeout (ver ROUTE_TIMEOUT_MS).
async function buildResponse(after: string | undefined, before: string | undefined, bypass: boolean): Promise<GA4Summary> {
  const summaryKey = `${CACHE_PREFIX.analyticsSummary}${normalizePeriodKey(after)}:${normalizePeriodKey(before)}`;

  if (!bypass) {
    console.log("[analytics/summary] lendo cache...");
    const cached = await getCached<GA4Summary>(summaryKey);
    console.log("[analytics/summary] leitura do cache terminou — HIT:", !!cached);
    if (cached) return cached;
  }

  console.log("[analytics/summary] MISS no cache — chamando getGA4Summary");
  const summary = await getGA4Summary(after, before);

  console.log("[analytics/summary] sucesso — gravando no cache");
  await setCached(summaryKey, summary, SUMMARY_TTL);
  console.log("[analytics/summary] gravação no cache terminou — respondendo");
  return summary;
}

analytics.get("/summary", async (c) => {
  console.log("[analytics/summary] rota chamada");
  const after = c.req.query("after");
  const before = c.req.query("before");
  const bypass = c.req.header("x-refresh") === "1";

  try {
    const summary = await withTimeout(buildResponse(after, before, bypass), ROUTE_TIMEOUT_MS, "rota /analytics/summary inteira");
    return c.json(summary);
  } catch (error) {
    // Cobre QUALQUER falha ou travamento (Redis, client do GA4, chamada em
    // si) — nunca derruba a rota nem fica pendurada. Devolve zerado (o app
    // sabe renderizar isso) e não cacheia o erro, pra próxima chamada tentar
    // de novo.
    console.error("[analytics/summary] falhou ou estourou o timeout, devolvendo zerado. Erro:", error);
    return c.json(EMPTY_GA4_SUMMARY);
  }
});
