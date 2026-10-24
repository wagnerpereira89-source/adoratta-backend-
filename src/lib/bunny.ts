import { createHash } from "node:crypto";
import { env } from "./env.js";

const API_BASE = "https://video.bunnycdn.com";

// Validade da assinatura de upload — generosa de propósito: um vídeo de
// ~100MB numa conexão ruim pode demorar bem mais que os 10-15min "padrão"
// desse tipo de assinatura em outros serviços. 4h cobre qualquer upload
// real sem forçar a pessoa a tentar de novo no meio do caminho.
const UPLOAD_SIGNATURE_TTL_SECONDS = 4 * 60 * 60;

interface BunnyVideoCreateResponse {
  guid: string;
  title: string;
}

// Cria o OBJETO de vídeo na library do Bunny (ainda sem nenhum arquivo) —
// é esse guid que identifica o vídeo pra sempre, mesmo antes do upload
// terminar. Usa a API Key da library, que nunca sai do backend.
export async function createBunnyVideo(title: string): Promise<{ guid: string }> {
  const res = await fetch(`${API_BASE}/library/${env.bunnyLibraryId}/videos`, {
    method: "POST",
    headers: {
      AccessKey: env.bunnyApiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ title }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Bunny createVideo falhou: HTTP ${res.status} ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as BunnyVideoCreateResponse;
  return { guid: data.guid };
}

export interface TusUploadSignature {
  videoId: string;
  libraryId: string;
  authorizationSignature: string;
  authorizationExpire: number;
}

// Assinatura temporária pro protocolo TUS (upload resumível direto do
// navegador pro Bunny) — SHA-256 de libraryId + apiKey + expiração + guid.
// Isso NÃO é a API Key — é um "ticket" que só serve pra esse vídeo
// específico, até a hora de expiração, e só autoriza upload (não lê nem
// lista nada). Fórmula documentada pelo próprio Bunny Stream.
export function signTusUpload(videoId: string): TusUploadSignature {
  const authorizationExpire = Math.floor(Date.now() / 1000) + UPLOAD_SIGNATURE_TTL_SECONDS;
  const toHash = `${env.bunnyLibraryId}${env.bunnyApiKey}${authorizationExpire}${videoId}`;
  const authorizationSignature = createHash("sha256").update(toHash).digest("hex");
  return {
    videoId,
    libraryId: env.bunnyLibraryId,
    authorizationSignature,
    authorizationExpire,
  };
}

// Apaga o vídeo no Bunny (objeto + arquivo). Usado tanto quando a pessoa
// troca o vídeo (apaga o antigo) quanto quando remove de vez.
export async function deleteBunnyVideo(videoId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/library/${env.bunnyLibraryId}/videos/${videoId}`, {
    method: "DELETE",
    headers: { AccessKey: env.bunnyApiKey, Accept: "application/json" },
    signal: AbortSignal.timeout(15000),
  });
  // 404 = já não existe (ex: tentativa repetida) — trata como sucesso, não
  // como erro, pra não travar o fluxo de troca/remoção por causa disso.
  if (!res.ok && res.status !== 404) {
    const text = await res.text().catch(() => "");
    throw new Error(`Bunny deleteVideo falhou: HTTP ${res.status} ${text.slice(0, 300)}`);
  }
}
