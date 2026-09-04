import type { FastifyInstance } from "fastify";

import {
  parseStripeEventEnvelope,
  STRIPE_PAYMENT_INTENT_SUCCEEDED,
  StripeWebhookPermanentError,
} from "../../stripe/application/stripe-webhook-event.js";
import type { HttpUseCases } from "./app.js";
import { PublicHttpError } from "./error-handler.js";
import { requireStripeSignature } from "./request-validation.js";
import { PUBLIC_AUTH_POLICY } from "./security/auth-policies.js";
import {
  StripeSignatureVerificationFailed,
  StripeVerifiedPayloadParseFailed,
} from "./stripe-signature-verifier.js";

export const STRIPE_WEBHOOK_BODY_LIMIT = 1_048_576;

export function registerStripeWebhookRoutes(
  app: FastifyInstance,
  dependencies: Pick<
    HttpUseCases,
    "processStripeWebhook" | "stripeWebhookClock" | "verifyStripeSignature"
  >,
): void {
  app.register(async (stripeScope) => {
    stripeScope.removeContentTypeParser("application/json");
    stripeScope.addContentTypeParser(
      "application/json",
      { parseAs: "buffer", bodyLimit: STRIPE_WEBHOOK_BODY_LIMIT },
      (_request, body, done) => done(null, body),
    );

    stripeScope.post(
      "/webhooks/stripe",
      {
        config: {
          auth: PUBLIC_AUTH_POLICY,
          rateLimit: false,
        },
      },
      async (request, reply) => {
        const signature = requireStripeSignature(request);

        if (!Buffer.isBuffer(request.body)) {
          throw new PublicHttpError(
            400,
            "INVALID_STRIPE_EVENT",
            "Invalid Stripe event",
          );
        }

        let verifiedEvent: unknown;

        try {
          verifiedEvent = dependencies.verifyStripeSignature(
            request.body,
            signature,
          );
        } catch (error) {
          if (error instanceof StripeSignatureVerificationFailed) {
            throw new PublicHttpError(
              400,
              "INVALID_STRIPE_SIGNATURE",
              "Invalid Stripe signature",
            );
          }

          if (error instanceof StripeVerifiedPayloadParseFailed) {
            throw new PublicHttpError(
              400,
              "INVALID_STRIPE_EVENT",
              "Invalid Stripe event",
            );
          }

          throw error;
        }

        let envelope;

        try {
          envelope = parseStripeEventEnvelope(verifiedEvent);
        } catch (error) {
          if (error instanceof StripeWebhookPermanentError) {
            throw new PublicHttpError(
              400,
              "INVALID_STRIPE_EVENT",
              "Invalid Stripe event",
            );
          }

          throw error;
        }

        if (envelope.livemode) {
          throw new PublicHttpError(
            400,
            "LIVE_STRIPE_EVENT_NOT_ALLOWED",
            "Live Stripe events are not allowed",
          );
        }

        if (envelope.type !== STRIPE_PAYMENT_INTENT_SUCCEEDED) {
          request.log.info(
            {
              event: "stripe_webhook_processed",
              provider: "stripe",
              providerEventId: envelope.id,
              providerEventType: envelope.type,
              outcome: "ignored",
            },
            "Stripe webhook handled",
          );
          return reply.status(200).send({ received: true });
        }

        const result = await dependencies.processStripeWebhook({
          verifiedEvent,
          stripeEventId: envelope.id,
          rawPayload: Buffer.from(request.body),
          receivedAt: dependencies.stripeWebhookClock.now(),
        });

        if (result.outcome === "busy") {
          request.log.warn(
            {
              event: "stripe_webhook_processed",
              provider: "stripe",
              providerEventId: envelope.id,
              providerEventType: envelope.type,
              outcome: "busy",
            },
            "Stripe webhook handling deferred",
          );
          throw new PublicHttpError(
            503,
            "STRIPE_EVENT_PROCESSING",
            "Stripe event is already being processed",
          );
        }

        if (result.outcome === "processed") {
          request.log.info(
            {
              event: "stripe_webhook_processed",
              provider: "stripe",
              providerEventId: envelope.id,
              providerEventType: envelope.type,
              outcome: "processed",
            },
            "Stripe webhook handled",
          );
        }

        return reply.status(200).send({ received: true });
      },
    );
  });
}
