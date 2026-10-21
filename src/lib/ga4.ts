import { BetaAnalyticsDataClient } from "@google-analytics/data";
import { env } from "./env.js";

let client: BetaAnalyticsDataClient | null = null;

// Nunca loga o CONTEÚDO da credencial — só se ela chegou e se o parse/client
// foram construídos sem exceção, pra diagnosticar sem expor segredo nenhum.
// Isolado em try/catch PRÓPRIO (separado de qualquer falha de rede/auth que
// vem depois) pra dizer com certeza se o problema é o parse do JSON em si.
function getClient(): BetaAnalyticsDataClient {
  if (!client) {
    let creds: Record<string, unknown>;
    try {
      creds = env.ga4Credentials as Record<string, unknown>;
      console.log(
        "[ga4] credencial parseada OK — client_email presente:",
        typeof creds.client_email === "string" && creds.client_email.length > 0,
        "| private_key presente:",
        typeof creds.private_key === "string" && creds.private_key.length > 0,
        "| private_key começa com '-----BEGIN':",
        typeof creds.private_key === "string" && creds.private_key.startsWith("-----BEGIN"),
      );
    } catch (error) {
      console.error(
        "[ga4] credencial FALHOU no parse:",
        error instanceof Error ? error.constructor.name + ": " + error.message : String(error),
      );
      throw error;
    }

    // fallback:true força a lib a usar REST (HTTP/1.1) em vez de gRPC. Local
    // funciona com os dois, mas gRPC (HTTP/2, conexão de longa duração) é um
    // padrão conhecido de travar em sandboxes serverless que congelam a
    // função entre handshakes — REST é stateless, uma chamada por request,
    // sem esse risco.
    try {
      client = new BetaAnalyticsDataClient({ credentials: creds as any, fallback: true });
      console.log("[ga4] BetaAnalyticsDataClient construído OK");
    } catch (error) {
      console.error(
        "[ga4] BetaAnalyticsDataClient FALHOU ao construir:",
        error instanceof Error ? error.constructor.name + ": " + error.message : String(error),
      );
      throw error;
    }
  }
  return client;
}

// Promise.race pra nunca deixar a rota pendurada esperando o GA4 pra sempre —
// se a chamada gRPC travar (ex: handshake preso), a rota recebe o erro do
// timeout e responde em vez de a função serverless estourar o próprio limite
// sem nenhum log útil.
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`[ga4] timeout de ${ms}ms em: ${label}`)), ms);
    }),
  ]);
}

export interface TrafficSource {
  channel: string;
  sessions: number;
}

export interface GA4Summary {
  activeUsers: number;
  screenPageViews: number;
  addToCart: number;
  beginCheckout: number;
  purchase: number;
  conversionRate: number; // 0-100, purchase / activeUsers; 0 se activeUsers for 0
  trafficSources: TrafficSource[];
  // true só quando a chamada ao GA4 falhou e isto é o fallback zerado — nunca
  // true num resumo real (mesmo com todas as métricas em 0 de verdade).
  partial: boolean;
}

export const EMPTY_GA4_SUMMARY: GA4Summary = {
  activeUsers: 0,
  screenPageViews: 0,
  addToCart: 0,
  beginCheckout: 0,
  purchase: 0,
  conversionRate: 0,
  trafficSources: [],
  partial: true,
};

// GA4 aceita data no formato YYYY-MM-DD (ou termos relativos como "today",
// que não usamos aqui porque o app já manda after/before explícitos, no
// mesmo padrão que /payments/summary usa).
function toGA4Date(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return fallback;
  return d.toISOString().slice(0, 10);
}

function todayISODate(): string {
  return new Date().toISOString().slice(0, 10);
}

function sevenDaysAgoISODate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d.toISOString().slice(0, 10);
}

// Divisão seguro: nunca retorna Infinity/NaN — 0 quando o denominador é 0.
function safeRate(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  const pct = (numerator / denominator) * 100;
  return Number.isFinite(pct) ? Number(pct.toFixed(1)) : 0;
}

function toNumber(value: string | null | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

const GA4_CALL_TIMEOUT_MS = 10_000;

export async function getGA4Summary(after: string | undefined, before: string | undefined): Promise<GA4Summary> {
  console.log("[ga4] getGA4Summary: início — after:", after, "| before:", before);
  const startDate = toGA4Date(after, sevenDaysAgoISODate());
  const endDate = toGA4Date(before, todayISODate());
  const property = `properties/${env.ga4PropertyId}`;
  const dateRanges = [{ startDate, endDate }];
  console.log("[ga4] property:", property, "| startDate:", startDate, "| endDate:", endDate);

  const c = getClient();

  console.log("[ga4] disparando as 3 chamadas runReport (timeout de", GA4_CALL_TIMEOUT_MS, "ms cada)...");
  // 3 chamadas em paralelo: totais, eventos nomeados, origem de tráfego.
  // Qualquer uma pode voltar sem `rows` (propriedade nova, sem dado ainda) —
  // tratado explicitamente, nunca acessa rows[0] sem checar. Cada uma tem seu
  // próprio timeout — se o gRPC travar, isso rejeita em vez de pendurar a rota.
  const logErr = (label: string) => (error: unknown) => {
    console.error(
      `[ga4] ${label} FALHOU:`,
      error instanceof Error ? error.constructor.name + ": " + error.message : String(error),
    );
    throw error;
  };

  const [totalsRes, eventsRes, trafficRes] = await Promise.all([
    withTimeout(
      c.runReport({ property, dateRanges, metrics: [{ name: "activeUsers" }, { name: "screenPageViews" }] }),
      GA4_CALL_TIMEOUT_MS,
      "runReport(totais)",
    ).then((r) => { console.log("[ga4] runReport(totais) respondeu"); return r; }, logErr("runReport(totais)")),
    withTimeout(
      c.runReport({
        property,
        dateRanges,
        dimensions: [{ name: "eventName" }],
        metrics: [{ name: "eventCount" }],
      }),
      GA4_CALL_TIMEOUT_MS,
      "runReport(eventos)",
    ).then((r) => { console.log("[ga4] runReport(eventos) respondeu"); return r; }, logErr("runReport(eventos)")),
    withTimeout(
      c.runReport({
        property,
        dateRanges,
        dimensions: [{ name: "sessionDefaultChannelGroup" }],
        metrics: [{ name: "sessions" }],
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      }),
      GA4_CALL_TIMEOUT_MS,
      "runReport(trafego)",
    ).then((r) => { console.log("[ga4] runReport(trafego) respondeu"); return r; }, logErr("runReport(trafego)")),
  ]);
  console.log("[ga4] as 3 chamadas voltaram — montando o resumo");

  const totalsRow = totalsRes[0]?.rows?.[0];
  const activeUsers = toNumber(totalsRow?.metricValues?.[0]?.value);
  const screenPageViews = toNumber(totalsRow?.metricValues?.[1]?.value);

  const eventCounts: Record<string, number> = {};
  for (const row of eventsRes[0]?.rows ?? []) {
    const name = row.dimensionValues?.[0]?.value;
    if (!name) continue;
    eventCounts[name] = toNumber(row.metricValues?.[0]?.value);
  }
  // ?? 0 garante as 3 métricas mesmo que o GA4 ainda não tenha nenhum desses
  // eventos registrado (propriedade nova, zerada).
  const addToCart = eventCounts["add_to_cart"] ?? 0;
  const beginCheckout = eventCounts["begin_checkout"] ?? 0;
  const purchase = eventCounts["purchase"] ?? 0;

  const trafficSources: TrafficSource[] = (trafficRes[0]?.rows ?? []).map((row) => ({
    channel: row.dimensionValues?.[0]?.value || "Desconhecido",
    sessions: toNumber(row.metricValues?.[0]?.value),
  }));

  return {
    activeUsers,
    screenPageViews,
    addToCart,
    beginCheckout,
    purchase,
    conversionRate: safeRate(purchase, activeUsers),
    trafficSources,
    partial: false,
  };
}
