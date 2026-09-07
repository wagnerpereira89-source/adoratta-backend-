import { env } from "./env.js";

const TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 300;

export class WooCommerceError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "WooCommerceError";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildUrl(path: string, params: Record<string, string | number | undefined> = {}): string {
  const url = new URL(`/wp-json/wc/v3${path}`, env.wcBaseUrl);
  url.searchParams.set("consumer_key", env.wcConsumerKey);
  url.searchParams.set("consumer_secret", env.wcConsumerSecret);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

// Chamadas de leitura: retry com backoff em erro de rede/5xx.
// Escritas (POST/PUT) nunca são repetidas, para não duplicar efeitos colaterais.
async function requestWithRetry(
  url: string,
  init: RequestInit,
  { retryable }: { retryable: boolean },
): Promise<Response> {
  let lastError: unknown;

  const attempts = retryable ? MAX_RETRIES : 1;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timeout);

      if (response.status >= 500 && retryable && attempt < attempts) {
        await sleep(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
        continue;
      }
      return response;
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;
      if (retryable && attempt < attempts) {
        await sleep(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

export interface WcResponse<T> {
  data: T;
  headers: Headers;
}

export async function wcGet<T>(
  path: string,
  params?: Record<string, string | number | undefined>,
): Promise<WcResponse<T>> {
  const url = buildUrl(path, params);
  const response = await requestWithRetry(url, { method: "GET" }, { retryable: true });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new WooCommerceError(`WooCommerce GET ${path} failed: ${response.status} ${body}`, response.status);
  }

  const data = (await response.json()) as T;
  return { data, headers: response.headers };
}

export async function wcWrite<T>(
  path: string,
  method: "POST" | "PUT",
  body: unknown,
): Promise<T> {
  const url = buildUrl(path);
  const response = await requestWithRetry(
    url,
    {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    { retryable: false },
  );

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new WooCommerceError(`WooCommerce ${method} ${path} failed: ${response.status} ${text}`, response.status);
  }

  return (await response.json()) as T;
}
