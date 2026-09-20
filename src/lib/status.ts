// Regras de negócio da Adoratta — ver documento de contexto, seção 3.

export const ORDER_STATUS_FLOW = [
  { status: "processing", label: "Pago" },
  { status: "embalado", label: "Embalado" },
  { status: "pronto-retirada", label: "Pronto para retirar" },
  { status: "pronto-envio", label: "Pronto para envio" },
  { status: "retirado", label: "Retirado" },
  { status: "enviado", label: "Enviado" },
  { status: "completed", label: "Concluído" },
] as const;

export type OrderStatus = (typeof ORDER_STATUS_FLOW)[number]["status"];

export const ORDER_STATUS_LABELS: Record<string, string> = Object.fromEntries(
  ORDER_STATUS_FLOW.map((s) => [s.status, s.label]),
);

// Status que não contam como venda — excluir de métricas.
export const EXCLUDED_STATUSES = [
  "cancelled",
  "failed",
  "refunded",
  "pending",
  "trash",
  "draft",
  "auto-draft",
  "checkout-draft",
] as const;

export function isSaleStatus(status: string): boolean {
  return !(EXCLUDED_STATUSES as readonly string[]).includes(status);
}

export type DeliveryType = "motoboy" | "retirada" | "envio";

interface ShippingLine {
  method_title?: string | null;
  method_id?: string | null;
}

export function getDeliveryType(shippingLines: ShippingLine[] | undefined | null): DeliveryType {
  const lines = shippingLines ?? [];
  for (const line of lines) {
    const title = (line.method_title ?? "").toLowerCase();
    const id = (line.method_id ?? "").toLowerCase();
    const combined = `${title} ${id}`;

    if (combined.includes("motoboy")) return "motoboy";
    if (combined.includes("retirada") || combined.includes("retira") || id === "local_pickup") {
      return "retirada";
    }
  }
  return "envio";
}

export type PaymentMethod = "PIX" | "Cartão de Crédito" | "Outros";

interface OrderMetaEntry {
  key?: string;
}

// Caminho PRINCIPAL de classificação: a Netcred (único gateway em uso na loja)
// grava metas exclusivas de cada forma de pagamento no próprio pedido
// (_netcred_pix_copy_paste, _netcred_pix_discount_rate... vs
// _netcred_card_installments, _netcred_card_total_paid...) — já vem junto
// com a listagem de pedidos, sem precisar abrir /notes de cada um. Retorna
// null quando não reconhece nenhum dos dois (gateway diferente da Netcred,
// ou pedido sem essas metas) — nesse caso quem chama decide se cai no
// fallback de notas, não vira "Outros" direto.
export function classifyPaymentMethodFromMeta(metaData: OrderMetaEntry[] | undefined): PaymentMethod | null {
  const keys = (metaData ?? []).map((m) => m.key ?? "");
  if (keys.some((k) => k.startsWith("_netcred_pix_"))) return "PIX";
  if (keys.some((k) => k.startsWith("_netcred_card_"))) return "Cartão de Crédito";
  return null;
}

// Fallback: usado só quando classifyPaymentMethodFromMeta não reconhece o
// pedido (gateway futuro diferente da Netcred). Mantido pra não depender de
// um único fornecedor de pagamento pra sempre.
export function classifyPaymentMethodFromNotes(notes: string[]): PaymentMethod {
  const text = notes.join(" \n ").toLowerCase();

  if (text.includes("pix")) return "PIX";
  if (text.includes("cartão") || text.includes("cartao") || text.includes("credit")) {
    return "Cartão de Crédito";
  }
  return "Outros";
}

// Campos repassados ao WooCommerce via `_fields`, para encolher a resposta.
export const ORDER_LIST_FIELDS = [
  "id",
  "number",
  "status",
  "date_created",
  "total",
  "billing",
  "shipping_lines",
  "line_items",
  "payment_method",
  "payment_method_title",
].join(",");

export const ORDER_ALL_FIELDS = [
  "id",
  "status",
  "total",
  "date_created",
  "billing",
  "shipping",
  "shipping_lines",
  "line_items",
  "payment_method_title",
].join(",");

// Campos usados só por /payments/summary — meta_data é pesado (~1,3KB/pedido
// de média) e a maior parte é ruído não relacionado a pagamento (rastreio dos
// Correios, tracking de eventos etc.), então fica de fora do ORDER_ALL_FIELDS
// pra não inflar a resposta de /orders/all, que não precisa disso.
export const ORDER_PAYMENT_FIELDS = ["id", "status", "meta_data"].join(",");
