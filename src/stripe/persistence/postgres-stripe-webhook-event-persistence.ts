import { and, eq, or, sql } from "drizzle-orm";

import type { Database } from "../../persistence/database.js";
import type {
  RetainedStripeWebhookEvent,
  StoreStripeWebhookReceiptInput,
  StoreStripeWebhookReceiptResult,
  StripeWebhookClaimResult,
  StripeWebhookEventPersistence,
  StripeWebhookEventStatus,
  StripeWebhookFailureCode,
} from "../application/stripe-webhook-event-persistence.js";
import {
  StripeEventEvidenceConflict,
  StripeWebhookClaimLostError,
} from "../application/stripe-webhook-event-persistence.js";
import { stripeWebhookEvents } from "./stripe-webhook-event-schema.js";

type StripeWebhookEventRow = typeof stripeWebhookEvents.$inferSelect;

function retainedEventFromRow(
  row: StripeWebhookEventRow,
): RetainedStripeWebhookEvent {
  return {
    id: row.id,
    stripeEventId: row.stripeEventId,
    eventType: "payment_intent.succeeded",
    stripePaymentIntentId: row.stripePaymentIntentId,
    rawPayload: Buffer.from(row.rawPayload),
    receivedAt: new Date(row.receivedAt.getTime()),
    status: row.status as StripeWebhookEventStatus,
    processingToken: row.processingToken,
    processingStartedAt:
      row.processingStartedAt === null
        ? null
        : new Date(row.processingStartedAt.getTime()),
    processedAt:
      row.processedAt === null ? null : new Date(row.processedAt.getTime()),
    paymentId: row.paymentId,
    lastErrorCode: row.lastErrorCode as StripeWebhookFailureCode | null,
  };
}

function evidenceMatches(
  retained: RetainedStripeWebhookEvent,
  input: StoreStripeWebhookReceiptInput,
): boolean {
  return (
    retained.eventType === input.eventType &&
    retained.stripePaymentIntentId === input.stripePaymentIntentId &&
    retained.rawPayload.equals(input.rawPayload)
  );
}

export class PostgresStripeWebhookEventPersistence
  implements StripeWebhookEventPersistence
{
  constructor(private readonly database: Database) {}

  async storeReceipt(
    input: StoreStripeWebhookReceiptInput,
  ): Promise<StoreStripeWebhookReceiptResult> {
    return this.database.transaction(async (transaction) => {
      const [inserted] = await transaction
        .insert(stripeWebhookEvents)
        .values({
          stripeEventId: input.stripeEventId,
          eventType: input.eventType,
          stripePaymentIntentId: input.stripePaymentIntentId,
          rawPayload: Buffer.from(input.rawPayload),
          receivedAt: new Date(input.receivedAt.getTime()),
          status: "received",
        })
        .onConflictDoNothing({ target: stripeWebhookEvents.stripeEventId })
        .returning();

      const row =
        inserted ??
        (
          await transaction
            .select()
            .from(stripeWebhookEvents)
            .where(eq(stripeWebhookEvents.stripeEventId, input.stripeEventId))
            .limit(1)
        )[0];
      if (row === undefined) {
        throw new Error("Retained Stripe webhook receipt could not be loaded");
      }

      const event = retainedEventFromRow(row);
      if (!evidenceMatches(event, input)) {
        throw new StripeEventEvidenceConflict(input.stripeEventId);
      }

      return { event, outcome: inserted === undefined ? "replayed" : "stored" };
    });
  }

  async claimForProcessing(
    eventId: number,
    processingToken: string,
  ): Promise<StripeWebhookClaimResult> {
    const [claimed] = await this.database.client
      .update(stripeWebhookEvents)
      .set({
        status: "processing",
        processingToken,
        processingStartedAt: sql`clock_timestamp()`,
      })
      .where(
        and(
          eq(stripeWebhookEvents.id, eventId),
          or(
            eq(stripeWebhookEvents.status, "received"),
            and(
              eq(stripeWebhookEvents.status, "processing"),
              sql`${stripeWebhookEvents.processingStartedAt} < clock_timestamp() - interval '60 seconds'`,
            ),
          ),
        ),
      )
      .returning();

    if (claimed !== undefined) {
      return { outcome: "claimed", event: retainedEventFromRow(claimed) };
    }

    const [current] = await this.database.client
      .select({ status: stripeWebhookEvents.status })
      .from(stripeWebhookEvents)
      .where(eq(stripeWebhookEvents.id, eventId))
      .limit(1);
    if (current === undefined) {
      throw new Error("Stripe webhook event was not found while claiming");
    }
    if (current.status === "processed") {
      return { outcome: "processed" };
    }
    if (current.status === "failed") {
      return { outcome: "failed" };
    }
    return { outcome: "busy" };
  }

  async markProcessed(input: {
    readonly eventId: number;
    readonly processingToken: string;
    readonly paymentId: number;
    readonly processedAt: Date;
  }): Promise<void> {
    const updated = await this.database.client
      .update(stripeWebhookEvents)
      .set({
        status: "processed",
        processingToken: null,
        processingStartedAt: null,
        processedAt: new Date(input.processedAt.getTime()),
        paymentId: input.paymentId,
        lastErrorCode: null,
      })
      .where(
        and(
          eq(stripeWebhookEvents.id, input.eventId),
          eq(stripeWebhookEvents.status, "processing"),
          eq(stripeWebhookEvents.processingToken, input.processingToken),
        ),
      )
      .returning({ id: stripeWebhookEvents.id });
    if (updated.length !== 1) {
      throw new StripeWebhookClaimLostError(input.eventId);
    }
  }

  async markFailed(input: {
    readonly eventId: number;
    readonly processingToken: string;
    readonly errorCode: StripeWebhookFailureCode;
    readonly processedAt: Date;
  }): Promise<void> {
    const updated = await this.database.client
      .update(stripeWebhookEvents)
      .set({
        status: "failed",
        processingToken: null,
        processingStartedAt: null,
        processedAt: new Date(input.processedAt.getTime()),
        paymentId: null,
        lastErrorCode: input.errorCode,
      })
      .where(
        and(
          eq(stripeWebhookEvents.id, input.eventId),
          eq(stripeWebhookEvents.status, "processing"),
          eq(stripeWebhookEvents.processingToken, input.processingToken),
        ),
      )
      .returning({ id: stripeWebhookEvents.id });
    if (updated.length !== 1) {
      throw new StripeWebhookClaimLostError(input.eventId);
    }
  }

  async releaseForRetry(
    eventId: number,
    processingToken: string,
  ): Promise<void> {
    const updated = await this.database.client
      .update(stripeWebhookEvents)
      .set({
        status: "received",
        processingToken: null,
        processingStartedAt: null,
        processedAt: null,
        paymentId: null,
        lastErrorCode: null,
      })
      .where(
        and(
          eq(stripeWebhookEvents.id, eventId),
          eq(stripeWebhookEvents.status, "processing"),
          eq(stripeWebhookEvents.processingToken, processingToken),
        ),
      )
      .returning({ id: stripeWebhookEvents.id });
    if (updated.length !== 1) {
      throw new StripeWebhookClaimLostError(eventId);
    }
  }
}
