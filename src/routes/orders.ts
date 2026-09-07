import { Hono } from "hono";
import pLimit from "p-limit";
import { wcGet, wcWrite } from "../lib/woocommerce.js";
import { withCache, invalidateOrderCaches, CACHE_PREFIX } from "../lib/redis.js";
import { ORDER_STATUS_FLOW, ORDER_LIST_FIELDS, ORDER_ALL_FIELDS, isSaleStatus } from "../lib/status.js";

export const orders = new Hono();

function shouldBypassCache(c: { req: { header: (name: string) => string | undefined } }): boolean {
  return c.req.header("x-refresh") === "1";
}

// GET /orders?status=&search=&cpf=&include=
orders.get("/", async (c) => {
  const status = c.req.query("status");
  const search = c.req.query("search");
  const cpf = c.req.query("cpf");
  const include = c.req.query("include");

  const cacheKey = `${CACHE_PREFIX.ordersList}${JSON.stringify({ status, search, cpf, include })}`;

  const data = await withCache(
    cacheKey,
    20,
    async () => {
      const { data } = await wcGet<unknown[]>("/orders", {
        status,
        search: search ?? cpf,
        include,
        _fields: ORDER_LIST_FIELDS,
        per_page: 100,
      });
      return data;
    },
    { bypass: shouldBypassCache(c) },
  );

  return c.json({ orders: data });
});

// GET /orders/counts — contagem por status, para os badges.
orders.get("/counts", async (c) => {
  const data = await withCache(
    CACHE_PREFIX.ordersCounts,
    30,
    async () => {
      const limit = pLimit(5);
      const entries = await Promise.all(
        ORDER_STATUS_FLOW.map(({ status, label }) =>
          limit(async () => {
            const { headers } = await wcGet<unknown[]>("/orders", {
              status,
              per_page: 1,
              _fields: "id",
            });
            const total = Number(headers.get("x-wp-total") ?? "0");
            return [status, { label, total }] as const;
          }),
        ),
      );
      return Object.fromEntries(entries);
    },
    { bypass: shouldBypassCache(c) },
  );

  return c.json({ counts: data });
});

// GET /orders/all?after=&before() — todos os pedidos de um período, paginando.
orders.get("/all", async (c) => {
  const after = c.req.query("after");
  const before = c.req.query("before");

  const cacheKey = `${CACHE_PREFIX.ordersAll}${JSON.stringify({ after, before })}`;

  const data = await withCache(
    cacheKey,
    30,
    async () => {
      const perPage = 100;
      const maxPages = 10;
      const all: any[] = [];

      for (let page = 1; page <= maxPages; page++) {
        const { data, headers } = await wcGet<any[]>("/orders", {
          after,
          before,
          page,
          per_page: perPage,
          _fields: ORDER_ALL_FIELDS,
        });
        all.push(...data);

        const totalPages = Number(headers.get("x-wp-totalpages") ?? "1");
        if (page >= totalPages) break;
      }

      return all.filter((order) => isSaleStatus(order.status));
    },
    { bypass: shouldBypassCache(c) },
  );

  return c.json({ orders: data });
});

// PUT /orders/:id/status — sem cache; invalida caches de leitura após sucesso.
orders.put("/:id/status", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{ status: string }>();

  const updated = await wcWrite(`/orders/${id}`, "PUT", { status: body.status });
  await invalidateOrderCaches();

  return c.json({ order: updated });
});

// POST /orders/batch-status — atualização em massa; mesma invalidação.
orders.post("/batch-status", async (c) => {
  const body = await c.req.json<{ ids: number[]; status: string }>();

  const limit = pLimit(5);
  const results = await Promise.all(
    body.ids.map((id) => limit(() => wcWrite(`/orders/${id}`, "PUT", { status: body.status }))),
  );
  await invalidateOrderCaches();

  return c.json({ orders: results });
});
