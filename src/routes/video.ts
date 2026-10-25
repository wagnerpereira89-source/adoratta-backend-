import { Hono } from "hono";
import { createBunnyVideo, signTusUpload, deleteBunnyVideo } from "../lib/bunny.js";

export const video = new Hono();

// POST /video/create — cria o objeto de vídeo no Bunny e devolve o guid +
// uma assinatura TUS temporária. O app usa isso pra fazer upload DIRETO pro
// Bunny (tus-js-client) — a API Key nunca sai daqui.
video.post("/create", async (c) => {
  let body: { title?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Corpo da requisição precisa ser JSON" }, 400);
  }

  const title = typeof body.title === "string" && body.title.trim() ? body.title.trim() : "Vídeo sem título";

  try {
    const { guid } = await createBunnyVideo(title);
    const signature = signTusUpload(guid);
    return c.json({ guid, ...signature });
  } catch (error) {
    console.error("[video/create] falhou:", error);
    const message = error instanceof Error ? error.message : "Erro desconhecido";
    return c.json({ error: message }, 502);
  }
});

// DELETE /video/:id — apaga o vídeo no Bunny. Usado ao trocar (apaga o
// antigo) ou remover o vídeo de um produto.
video.delete("/:id", async (c) => {
  const id = c.req.param("id");
  if (!id) return c.json({ error: "ID do vídeo é obrigatório" }, 400);

  try {
    await deleteBunnyVideo(id);
    return c.json({ ok: true });
  } catch (error) {
    console.error("[video/delete] falhou:", error);
    const message = error instanceof Error ? error.message : "Erro desconhecido";
    return c.json({ error: message }, 502);
  }
});
