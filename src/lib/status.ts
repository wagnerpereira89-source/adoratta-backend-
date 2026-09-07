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
