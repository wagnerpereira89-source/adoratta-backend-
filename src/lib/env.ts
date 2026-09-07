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
};
