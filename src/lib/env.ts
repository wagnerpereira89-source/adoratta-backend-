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
  get allowedOrigin() {
    return process.env.ALLOWED_ORIGIN ?? "*";
  },
  get appSharedToken() {
    return process.env.APP_SHARED_TOKEN ?? null;
  },
};
