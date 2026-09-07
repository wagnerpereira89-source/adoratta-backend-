import { handle } from "hono/vercel";
import { app } from "../src/app.js";

// Vercel's default (Node.js) runtime invokes functions with the classic
// (req, res) => void signature and ignores a returned Response. The Edge
// runtime speaks the Web Fetch API natively, which is what handle(app) returns.
export const config = {
  runtime: "edge",
};

export default handle(app);
