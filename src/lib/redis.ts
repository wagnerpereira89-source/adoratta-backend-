import { Redis } from "@upstash/redis";
import { env } from "./env.js";

let client: Redis | null = null;

function getClient(): Redis {
  if (!client) {
    client = new Redis({ url: env.upstashUrl, token: env.upstashToken });
  }
  return client;
}

// Chaves de cache usadas pelas rotas de leitura, para permitir invalidação em massa
// depois de uma escrita (ver seção 5 do documento de contexto).
export const CACHE_PREFIX = {
  ordersCounts: "orders:counts",
  ordersList: "orders:list:",
  ordersAll: "orders:all:",
  orderNotes: "orders:notes:",
} as const;

export async function getCached<T>(key: string): Promise<T | null> {
  const value = await getClient().get<T>(key);
  return value ?? null;
}

export async function setCached<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
  await getClient().set(key, value, { ex: ttlSeconds });
}

// Busca `fetcher` e cacheia, a menos que `bypass` seja true (usado pelo header x-refresh).
export async function withCache<T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>,
  options: { bypass?: boolean } = {},
): Promise<T> {
  if (!options.bypass) {
    const cached = await getCached<T>(key);
    if (cached !== null) return cached;
  }

  const fresh = await fetcher();
  await setCached(key, fresh, ttlSeconds);
  return fresh;
}

// Invalida todas as chaves com um dado prefixo. Usado após escritas de status,
// para que listas/contagens/período nunca fiquem com dado velho.
export async function invalidateByPrefix(prefix: string): Promise<void> {
  const redis = getClient();
  let cursor = 0;
  do {
    const [nextCursor, keys] = await redis.scan(cursor, { match: `${prefix}*`, count: 100 });
    cursor = Number(nextCursor);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } while (cursor !== 0);
}

export async function invalidateOrderCaches(): Promise<void> {
  await Promise.all([
    invalidateByPrefix(CACHE_PREFIX.ordersCounts),
    invalidateByPrefix(CACHE_PREFIX.ordersList),
    invalidateByPrefix(CACHE_PREFIX.ordersAll),
  ]);
}
