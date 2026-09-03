/**
 * order_messages CRUD (db/migrations/111_order_messages.sql) — the customer
 * reply thread under an order.
 */
import catalogueMin from "@/data/catalogue.min.json";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createOrder } from "@/lib/orders";
import { addMessage, listMessages } from "@/lib/order-messages";
import { setupDb, teardownDb, truncateAll, TEST_SECRET } from "./helpers";

type Min = { id: string; s: string };
const product = (catalogueMin as Min[]).find((p) => p.s === "in")!;

async function makeOrder() {
  return createOrder({
    lang: "RU",
    items: [{ id: product.id, qty: 1 }],
    customer: { name: "Test Ostja", email: "test@example.com", phone: "+372 5555 5555" },
    shipping: { method: "parcel", country: "EE", pointId: "1", pointName: "Kristiine" },
  });
}

describe("order_messages", () => {
  beforeAll(async () => {
    process.env.SESSION_SECRET = TEST_SECRET;
    await setupDb();
  });
  afterAll(teardownDb);
  beforeEach(truncateAll);

  it("addMessage + listMessages round-trip, oldest first", async () => {
    const order = await makeOrder();
    await addMessage(order.id, "in", "Когда придёт заказ?");
    await addMessage(order.id, "out", "Здравствуйте! Заказ уже собран.");

    const thread = await listMessages(order.id);
    expect(thread).toHaveLength(2);
    expect(thread[0].direction).toBe("in");
    expect(thread[0].body).toBe("Когда придёт заказ?");
    expect(thread[1].direction).toBe("out");
    expect(thread[1].body).toBe("Здравствуйте! Заказ уже собран.");
    expect(new Date(thread[0].createdAt).getTime()).toBeLessThanOrEqual(new Date(thread[1].createdAt).getTime());
  });

  it("carries meta (e.g. the Resend message id) through untouched", async () => {
    const order = await makeOrder();
    await addMessage(order.id, "out", "Ответ", { subject: "Re: заказ R-1", resendId: "abc-123" });
    const [msg] = await listMessages(order.id);
    expect(msg.meta).toEqual({ subject: "Re: заказ R-1", resendId: "abc-123" });
  });

  it("defaults meta to {} when not given", async () => {
    const order = await makeOrder();
    await addMessage(order.id, "in", "Привет");
    const [msg] = await listMessages(order.id);
    expect(msg.meta).toEqual({});
  });

  it("rejects an empty body", async () => {
    const order = await makeOrder();
    await expect(addMessage(order.id, "in", "")).rejects.toThrow();
    await expect(addMessage(order.id, "in", "   ")).rejects.toThrow();
  });

  it("rejects a direction other than 'in'/'out'", async () => {
    const order = await makeOrder();
    // @ts-expect-error deliberately invalid direction for the runtime check
    await expect(addMessage(order.id, "sideways", "hi")).rejects.toThrow();
  });

  it("one order's thread never leaks into another's", async () => {
    const orderA = await makeOrder();
    const orderB = await makeOrder();
    await addMessage(orderA.id, "in", "A's message");
    await addMessage(orderB.id, "in", "B's message");

    expect(await listMessages(orderA.id)).toHaveLength(1);
    expect(await listMessages(orderB.id)).toHaveLength(1);
    expect((await listMessages(orderA.id))[0].body).toBe("A's message");
  });

  it("an order with no messages yet has an empty thread, not an error", async () => {
    const order = await makeOrder();
    expect(await listMessages(order.id)).toEqual([]);
  });

  it("a long body is capped, not rejected", async () => {
    const order = await makeOrder();
    const long = "a".repeat(9000);
    const msg = await addMessage(order.id, "in", long);
    expect(msg.body.length).toBeLessThanOrEqual(8000);
  });
});
