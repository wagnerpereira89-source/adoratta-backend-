import { BetaAnalyticsDataClient } from "@google-analytics/data";
import { env } from "./env.js";

let client: BetaAnalyticsDataClient | null = null;

function getClient(): BetaAnalyticsDataClient {
  if (!client) {
    // credentials vem inteiro da env var GA4_CREDENTIALS_JSON — nunca de arquivo.
    client = new BetaAnalyticsDataClient({ credentials: env.ga4Credentials as any });
  }
  return client;
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

export async function getGA4Summary(after: string | undefined, before: string | undefined): Promise<GA4Summary> {
  const startDate = toGA4Date(after, sevenDaysAgoISODate());
  const endDate = toGA4Date(before, todayISODate());
  const property = `properties/${env.ga4PropertyId}`;
  const dateRanges = [{ startDate, endDate }];
  const c = getClient();

  // 3 chamadas em paralelo: totais, eventos nomeados, origem de tráfego.
  // Qualquer uma pode voltar sem `rows` (propriedade nova, sem dado ainda) —
  // tratado explicitamente, nunca acessa rows[0] sem checar.
  const [totalsRes, eventsRes, trafficRes] = await Promise.all([
    c.runReport({
      property,
      dateRanges,
      metrics: [{ name: "activeUsers" }, { name: "screenPageViews" }],
    }),
    c.runReport({
      property,
      dateRanges,
      dimensions: [{ name: "eventName" }],
      metrics: [{ name: "eventCount" }],
    }),
    c.runReport({
      property,
      dateRanges,
      dimensions: [{ name: "sessionDefaultChannelGroup" }],
      metrics: [{ name: "sessions" }],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
    }),
  ]);

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
