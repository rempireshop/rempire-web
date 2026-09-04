/**
 * The customer-reply thread under an order — db/migrations/111_order_messages.sql.
 *
 * Not part of src/lib/orders.ts on purpose (that file is shared/owned by
 * backend-core, docs/build-contracts.md — "others import, don't edit"); this
 * is its own small module, imported by the reply-thread routes.
 */
import { jsonbParam, query } from "@/lib/db";

export type MessageDirection = "in" | "out";

export type OrderMessage = {
  id: number;
  orderId: string;
  direction: MessageDirection;
  body: string;
  meta: Record<string, unknown>;
  createdAt: string;
};

type Row = {
  id: string | number;
  order_id: string;
  direction: MessageDirection;
  body: string;
  meta: unknown;
  created_at: string | Date;
};

function jsonOf(v: unknown): Record<string, unknown> {
  if (v == null) return {};
  if (typeof v === "string") {
    try {
      const p = JSON.parse(v);
      return p && typeof p === "object" ? p : {};
    } catch {
      return {};
    }
  }
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

function toMessage(r: Row): OrderMessage {
  return {
    id: Number(r.id),
    orderId: r.order_id,
    direction: r.direction,
    body: r.body,
    meta: jsonOf(r.meta),
    createdAt: new Date(r.created_at as string).toISOString(),
  };
}

const MAX_BODY = 8000;

/** The whole thread for one order, oldest first — how it reads as a conversation. */
export async function listMessages(orderId: string): Promise<OrderMessage[]> {
  const rows = await query<Row>(
    `select id, order_id, direction, body, meta, created_at from order_messages
     where order_id = $1 order by created_at asc, id asc`,
    [orderId],
  );
  return rows.map(toMessage);
}

/** One row. `body` is required and non-empty; a message nobody wrote is not a message. */
export async function addMessage(
  orderId: string,
  direction: MessageDirection,
  body: string,
  meta: Record<string, unknown> = {},
): Promise<OrderMessage> {
  const text = String(body ?? "").trim().slice(0, MAX_BODY);
  if (!text) throw new Error("empty_body");
  if (direction !== "in" && direction !== "out") throw new Error("bad_direction");
  const rows = await query<Row>(
    `insert into order_messages (order_id, direction, body, meta)
     values ($1, $2, $3, $4::jsonb) returning id, order_id, direction, body, meta, created_at`,
    [orderId, direction, text, jsonbParam(meta ?? {})],
  );
  return toMessage(rows[0]);
}
