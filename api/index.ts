import { handle } from "@hono/node-server/vercel";
import { app } from "../src/app.js";

// `hono/vercel`'s handle(app) is (req: Request) => app.fetch(req) — a bare
// Fetch API handler, which ONLY the Edge runtime invokes directly. Vercel's
// Node.js runtime actually DOES still expect the classic (req, res) => void
// signature (confirmed via a real runtime failure: "Invalid export... must
// be a function or server" + "returns are ignored"), so plugging a
// Fetch-style handler in there breaks it at runtime, not build time.
//
// `@hono/node-server/vercel`'s handle(app) is the correct adapter for Node:
// under the hood it's getRequestListener(app.fetch), which returns exactly
// an async (req, res) => {...} — it translates the Node http objects to/from
// the Fetch Request/Response that Hono's app.fetch expects, both ways.
//
// Node is required here (not Edge): @google-analytics/data pulls in
// google-gax (gRPC), which needs Node built-ins (stream, events, crypto,
// net...) that don't exist on Edge and fail the build there.
export const config = {
  runtime: "nodejs",
};

export default handle(app);
