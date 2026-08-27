import Stripe from "stripe";

export class StripeSignatureVerificationFailed extends Error {
  override readonly name = "StripeSignatureVerificationFailed";
}

export class StripeVerifiedPayloadParseFailed extends Error {
  override readonly name = "StripeVerifiedPayloadParseFailed";
}

export type StripeSignatureVerifier = (
  rawPayload: Buffer,
  signature: string,
) => unknown;

export function createStripeSignatureVerifier(
  signingSecret: string,
): StripeSignatureVerifier {
  return (rawPayload, signature) => {
    try {
      return Stripe.webhooks.constructEvent(
        rawPayload,
        signature,
        signingSecret,
      );
    } catch (error) {
      if (error instanceof Stripe.errors.StripeSignatureVerificationError) {
        throw new StripeSignatureVerificationFailed();
      }
      if (error instanceof SyntaxError) {
        throw new StripeVerifiedPayloadParseFailed();
      }
      throw error;
    }
  };
}
