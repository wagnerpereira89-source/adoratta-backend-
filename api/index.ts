import { handle } from "hono/vercel";
import { app } from "../src/app.js";

// hono/vercel's handle(app) is (req: Request) => app.fetch(req) — a plain
// Web Fetch API handler. Vercel's Node.js runtime (not just Edge) accepts
// this signature directly, so Node works here too — and Node is REQUIRED
// now: @google-analytics/data pulls in google-gax (gRPC), which needs
// Node built-ins (stream, events, crypto, net...) that don't exist on Edge
// and fail the build there (esbuild can't resolve them for that platform).
export const config = {
  runtime: "nodejs",
};

export default handle(app);
