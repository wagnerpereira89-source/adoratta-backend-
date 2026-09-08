import { Redis } from "@upstash/redis";
import { env } from "./env.js";

const REDIS_TIMEOUT_MS = 3_000;

let client: Redis | null = null;

function getClient(): Redis {
  if (!client) {
    client = new Redis({
      url: env.upstashUrl,
      token: env.upstashToken,
      // Chamado a cada requisição: garante timeout de 3s em TODA chamada ao Redis,
      // mesmo em sequências de retry internas do cliente.
      signal: () => AbortSignal.timeout(REDIS_TIMEOUT_MS),
    });
  }
  return client;
}

function logRedisError(operation: string, error: unknown): void {
  console.error(`[redis] ${operation} failed:`, error);
}

// Chaves de cache usadas pelas rotas de leitura, para permitir invalidação em massa
// depois de uma escrita (ver seção 5 do documento de contexto).
export const CACHE_PREFIX = {
  ordersCounts: "orders:counts",
  ordersList: "orders:list:",
  ordersAll: "orders:all:",
  orderNotes: "orders:notes:",
  paymentsSummary: "payments:summary:",
} as const;

// Se o Redis falhar ou estourar o timeout, trata como cache miss em vez de
// derrubar a requisição — o app deve continuar funcionando sem cache.
export async function getCached<T>(key: string): Promise<T | null> {
  try {
    const value = await getClient().get<T>(key);
    return value ?? null;
  } catch (error) {
    logRedisError(`get "${key}"`, error);
    return null;
  }
}

// Falha ao escrever no cache não deve derrubar a resposta — só loga.
export async function setCached<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
  try {
    await getClient().set(key, value, { ex: ttlSeconds });
  } catch (error) {
    logRedisError(`set "${key}"`, error);
  }
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
// para que listas/contagens/período nunca fiquem com dado velho. A escrita no
// WooCommerce já aconteceu nesse ponto, então uma falha aqui só loga e segue —
// o pior caso é o cache ficar stale até expirar pelo TTL.
export async function invalidateByPrefix(prefix: string): Promise<void> {
  try {
    const redis = getClient();
    let cursor = 0;
    do {
      const [nextCursor, keys] = await redis.scan(cursor, { match: `${prefix}*`, count: 100 });
      cursor = Number(nextCursor);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } while (cursor !== 0);
  } catch (error) {
    logRedisError(`invalidate "${prefix}*"`, error);
  }
}

export async function invalidateOrderCaches(): Promise<void> {
  await Promise.all([
    invalidateByPrefix(CACHE_PREFIX.ordersCounts),
    invalidateByPrefix(CACHE_PREFIX.ordersList),
    invalidateByPrefix(CACHE_PREFIX.ordersAll),
  ]);
}

export type RedisHealth = { ok: true } | { ok: false; error: string };

// Usado pelo /api/health — nunca lança, sempre resolve rápido (timeout de 3s).
export async function checkRedisHealth(): Promise<RedisHealth> {
  try {
    await getClient().ping();
    return { ok: true };
  } catch (error) {
    logRedisError("ping", error);
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
