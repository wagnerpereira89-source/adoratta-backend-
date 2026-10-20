function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  get wcBaseUrl() {
    return required("WC_BASE_URL").replace(/\/+$/, "");
  },
  get wcConsumerKey() {
    return required("WC_CONSUMER_KEY");
  },
  get wcConsumerSecret() {
    return required("WC_CONSUMER_SECRET");
  },
  get upstashUrl() {
    return required("UPSTASH_REDIS_REST_URL");
  },
  get upstashToken() {
    return required("UPSTASH_REDIS_REST_TOKEN");
  },
  // Lista de origens permitidas (CORS), separadas por vírgula — ex.:
  // "https://adoratta-app.vercel.app,http://localhost:5173". Sem a env var,
  // libera geral (comportamento anterior).
  get allowedOrigins() {
    const raw = process.env.ALLOWED_ORIGIN ?? "*";
    if (raw === "*") return "*";
    return raw.split(",").map((origin) => origin.trim()).filter(Boolean);
  },
  get appSharedToken() {
    return process.env.APP_SHARED_TOKEN ?? null;
  },
  get ga4PropertyId() {
    return required("GA4_PROPERTY_ID");
  },
  // Conteúdo INTEIRO do JSON da service account, como string — nunca lido de
  // arquivo (serverless/Vercel não tem disco persistente). Parseado aqui, não
  // guardado em lugar nenhum do código-fonte.
  get ga4Credentials(): Record<string, unknown> {
    const raw = required("GA4_CREDENTIALS_JSON");
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error("GA4_CREDENTIALS_JSON não é um JSON válido");
    }
  },
};
