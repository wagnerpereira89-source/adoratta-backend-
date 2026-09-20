import { Hono } from "hono";
import pLimit from "p-limit";
import { wcGet } from "../lib/woocommerce.js";
import { getCached, setCached, CACHE_PREFIX } from "../lib/redis.js";
import {
  classifyPaymentMethodFromMeta,
  classifyPaymentMethodFromNotes,
  isSaleStatus,
  ORDER_PAYMENT_FIELDS,
  type PaymentMethod,
} from "../lib/status.js";

export const payments = new Hono();

interface OrderNote {
  note?: string;
}

interface OrderMetaEntry {
  key?: string;
}

interface OrderForPayment {
  id: number;
  status: string;
  meta_data?: OrderMetaEntry[];
}

// Função Edge da Vercel tem teto de execução fixo (~25s, não configurável).
// Com a classificação por meta_data (Netcred), a imensa maioria dos pedidos
// nem chega a precisar de rede extra — esse orçamento agora só protege o
// fallback de notas (gateway não reconhecido, ou pedido sem meta Netcred).
// O que não deu tempo entra como "Outros" e o resumo fica marcado como
// parcial (partial: true), com TTL curto pra tentar de novo em breve.
const TIME_BUDGET_MS = 15_000;
const SUMMARY_TTL_FULL = 10 * 60; // resumo completo: cache por 10min
const SUMMARY_TTL_PARTIAL = 45; // resumo parcial: tenta recalcular logo
const ORDER_METHOD_TTL = 60 * 60 * 24 * 90; // 90 dias — a forma de pagamento de um pedido fechado não muda

// Busca dedicada (não reaproveita o cache de /orders/all — ORDER_ALL_FIELDS
// não inclui meta_data, e não deve incluir, pra não inflar aquele endpoint
// com um campo que só pagamentos precisa).
async function getOrdersForPeriod(after: string | undefined, before: string | undefined): Promise<OrderForPayment[]> {
  const perPage = 100;
  const maxPages = 10;
  const orders: OrderForPayment[] = [];

  for (let page = 1; page <= maxPages; page++) {
    const { data, headers } = await wcGet<OrderForPayment[]>("/orders", {
      after,
      before,
      page,
      per_page: perPage,
      _fields: ORDER_PAYMENT_FIELDS,
    });
    for (const order of data) {
      if (isSaleStatus(order.status)) orders.push(order);
    }

    const totalPages = Number(headers.get("x-wp-totalpages") ?? "1");
    if (page >= totalPages) break;
  }

  return orders;
}

// Fallback: só chamado quando classifyPaymentMethodFromMeta não reconhece o
// pedido. A forma de pagamento de um pedido fechado não muda — cache de 90
// dias por orderId, não 5 minutos.
async function getPaymentMethodFromNotes(orderId: number, bypass: boolean): Promise<PaymentMethod> {
  const key = `${CACHE_PREFIX.orderNotes}${orderId}`;
  if (!bypass) {
    const cached = await getCached<PaymentMethod>(key);
    if (cached) return cached;
  }

  const { data } = await wcGet<OrderNote[]>(`/orders/${orderId}/notes`);
  const noteTexts = data.map((note) => note.note ?? "");
  const method = classifyPaymentMethodFromNotes(noteTexts);
  await setCached(key, method, ORDER_METHOD_TTL);
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

// GET /payments/summary?after=&before= — busca os pedidos do período (já com
// meta_data), classifica a maioria na hora pelo meta da Netcred, e só recorre
// a /notes (com concorrência limitada) pros poucos que sobrarem sem meta
// reconhecido. Retorna já agregado (cacheado).
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

  const orders = await getOrdersForPeriod(after, before);

  const limit = pLimit(8);
  const counts: Record<PaymentMethod, number> = { PIX: 0, "Cartão de Crédito": 0, Outros: 0 };
  let processed = 0;
  let fallbackCount = 0;
  let partial = false;

  await Promise.all(
    orders.map((order) =>
      limit(async () => {
        const fromMeta = classifyPaymentMethodFromMeta(order.meta_data);
        if (fromMeta) {
          counts[fromMeta]++;
          processed++;
          return;
        }

        fallbackCount++;
        if (Date.now() - start > TIME_BUDGET_MS) {
          partial = true;
          counts.Outros++;
          return;
        }
        const method = await getPaymentMethodFromNotes(order.id, bypass);
        counts[method]++;
        processed++;
      }),
    ),
  );

  const total = orders.length;
  const percentages = Object.fromEntries(
    Object.entries(counts).map(([method, count]) => [
      method,
      total > 0 ? Number(((count / total) * 100).toFixed(1)) : 0,
    ]),
  );

  const result = { ...counts, total, percentages, partial };
  await setCached(summaryKey, result, partial ? SUMMARY_TTL_PARTIAL : SUMMARY_TTL_FULL);

  console.log(
    `[payments/summary] computed key=${summaryKey} orders=${total} processed=${processed} fallback=${fallbackCount} partial=${partial} in ${Date.now() - start}ms`,
  );

  return c.json(result);
});
