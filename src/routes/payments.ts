import { Hono } from "hono";
import pLimit from "p-limit";
import { wcGet } from "../lib/woocommerce.js";
import { getCached, setCached, CACHE_PREFIX } from "../lib/redis.js";
import { classifyPaymentMethodFromNotes, isSaleStatus, type PaymentMethod } from "../lib/status.js";

export const payments = new Hono();

interface OrderNote {
  note?: string;
}

// Função Edge da Vercel tem teto de execução fixo (~25s, não configurável).
// Corta a busca de notas bem antes disso pra nunca estourar o timeout — o que
// não deu tempo de classificar entra como "Outros" e o resumo fica marcado
// como parcial (partial: true), com TTL curto pra tentar de novo em breve.
const TIME_BUDGET_MS = 15_000;
const SUMMARY_TTL_FULL = 10 * 60; // resumo completo: cache por 10min
const SUMMARY_TTL_PARTIAL = 45; // resumo parcial: tenta recalcular logo

// Mesmo formato de chave que /orders/all usa (ver routes/orders.ts). O app
// sempre chama getAllOrders() pro período antes de getPaymentsSummary() pro
// MESMO período (ver Dashboard.jsx) — então essa lista quase sempre já está
// quente no Redis, e a gente evita paginar o WooCommerce de novo só pra pegar
// os IDs que a outra rota acabou de buscar.
async function getOrderIdsForPeriod(after: string | undefined, before: string | undefined): Promise<number[]> {
  const ordersAllKey = `${CACHE_PREFIX.ordersAll}${JSON.stringify({ after, before })}`;
  const cached = await getCached<Array<{ id: number; status: string }>>(ordersAllKey);
  if (cached) {
    return cached.filter((o) => isSaleStatus(o.status)).map((o) => o.id);
  }

  const perPage = 100;
  const maxPages = 10;
  const ids: number[] = [];

  for (let page = 1; page <= maxPages; page++) {
    const { data, headers } = await wcGet<Array<{ id: number; status: string }>>("/orders", {
      after,
      before,
      page,
      per_page: perPage,
      _fields: "id,status",
    });
    for (const order of data) {
      if (isSaleStatus(order.status)) ids.push(order.id);
    }

    const totalPages = Number(headers.get("x-wp-totalpages") ?? "1");
    if (page >= totalPages) break;
  }

  return ids;
}

// As notas de um pedido não mudam com o tempo — cache longo (5 min) por orderId.
async function getPaymentMethodForOrder(orderId: number, bypass: boolean): Promise<PaymentMethod> {
  const key = `${CACHE_PREFIX.orderNotes}${orderId}`;
  if (!bypass) {
    const cached = await getCached<PaymentMethod>(key);
    if (cached) return cached;
  }

  const { data } = await wcGet<OrderNote[]>(`/orders/${orderId}/notes`);
  const noteTexts = data.map((note) => note.note ?? "");
  const method = classifyPaymentMethodFromNotes(noteTexts);
  await setCached(key, method, 300);
  return method;
}

// Normaliza after/before pra uma chave estável: o app manda timestamps ISO
// (podem variar em segundos/ms entre chamadas do "mesmo" período) — arredondar
// pro minuto garante que a 2ª carga do MESMO período bate na mesma chave, sem
// misturar períodos realmente diferentes.
function normalizePeriodKey(value: string | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  d.setSeconds(0, 0);
  return d.toISOString();
}

// GET /payments/summary?after=&before= — busca os pedidos do período, busca as notas
// de cada um com concorrência limitada, e retorna já agregado (cacheado).
payments.get("/summary", async (c) => {
  const after = c.req.query("after");
  const before = c.req.query("before");
  const bypass = c.req.header("x-refresh") === "1";
  const start = Date.now();

  const summaryKey = `${CACHE_PREFIX.paymentsSummary}${normalizePeriodKey(after)}:${normalizePeriodKey(before)}`;

  if (!bypass) {
    const cached = await getCached<Record<string, unknown>>(summaryKey);
    if (cached) {
      console.log(`[payments/summary] HIT key=${summaryKey} in ${Date.now() - start}ms`);
      return c.json(cached);
    }
  }
  console.log(`[payments/summary] MISS key=${summaryKey}`);

  const orderIds = await getOrderIdsForPeriod(after, before);

  const limit = pLimit(8);
  const counts: Record<PaymentMethod, number> = { PIX: 0, "Cartão de Crédito": 0, Outros: 0 };
  let processed = 0;
  let partial = false;

  await Promise.all(
    orderIds.map((id) =>
      limit(async () => {
        if (Date.now() - start > TIME_BUDGET_MS) {
          partial = true;
          counts.Outros++;
          return;
        }
        const method = await getPaymentMethodForOrder(id, bypass);
        counts[method]++;
        processed++;
      }),
    ),
  );

  const total = orderIds.length;
  const percentages = Object.fromEntries(
    Object.entries(counts).map(([method, count]) => [
      method,
      total > 0 ? Number(((count / total) * 100).toFixed(1)) : 0,
    ]),
  );

  const result = { ...counts, total, percentages, partial };
  await setCached(summaryKey, result, partial ? SUMMARY_TTL_PARTIAL : SUMMARY_TTL_FULL);

  console.log(
    `[payments/summary] computed key=${summaryKey} orders=${total} processed=${processed} partial=${partial} in ${Date.now() - start}ms`,
  );

  return c.json(result);
});
