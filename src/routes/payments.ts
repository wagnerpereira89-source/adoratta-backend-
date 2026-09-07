import { Hono } from "hono";
import pLimit from "p-limit";
import { wcGet } from "../lib/woocommerce.js";
import { withCache, CACHE_PREFIX } from "../lib/redis.js";
import { classifyPaymentMethodFromNotes, isSaleStatus, type PaymentMethod } from "../lib/status.js";

export const payments = new Hono();

interface OrderNote {
  note?: string;
}

async function fetchOrderIdsForPeriod(after?: string, before?: string): Promise<number[]> {
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
  return withCache(
    `${CACHE_PREFIX.orderNotes}${orderId}`,
    300,
    async () => {
      const { data } = await wcGet<OrderNote[]>(`/orders/${orderId}/notes`);
      const noteTexts = data.map((note) => note.note ?? "");
      return classifyPaymentMethodFromNotes(noteTexts);
    },
    { bypass },
  );
}

// GET /payments/summary?after=&before= — busca os pedidos do período, busca as notas
// de cada um com concorrência limitada, e retorna já agregado.
payments.get("/summary", async (c) => {
  const after = c.req.query("after");
  const before = c.req.query("before");
  const bypass = c.req.header("x-refresh") === "1";

  const orderIds = await fetchOrderIdsForPeriod(after, before);

  const limit = pLimit(5);
  const methods = await Promise.all(
    orderIds.map((id) => limit(() => getPaymentMethodForOrder(id, bypass))),
  );

  const counts: Record<PaymentMethod, number> = { PIX: 0, "Cartão de Crédito": 0, Outros: 0 };
  for (const method of methods) counts[method]++;

  const total = orderIds.length;
  const percentages = Object.fromEntries(
    Object.entries(counts).map(([method, count]) => [
      method,
      total > 0 ? Number(((count / total) * 100).toFixed(1)) : 0,
    ]),
  );

  return c.json({ ...counts, total, percentages });
});
