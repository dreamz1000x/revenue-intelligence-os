import type { FastifyInstance } from "fastify";
import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  ANALYTICS_VERSION,
  AnalyticsContractNotFoundError,
  AnalyticsRunNotFoundError,
  type ContractFinancialTimelineV1,
  type FinancialSummaryV1,
  type ReconciliationSummaryV1,
} from "../../../../src/analytics/application/analytics-queries.js";
import {
  buildApp,
  type HttpUseCases,
} from "../../../../src/interface/http/app.js";
import {
  authenticateTestRequests,
  TEST_ACCESS_TOKEN_VERIFIER,
} from "../../../helpers/http-auth.js";

const START = new Date("2026-05-01T00:00:00Z");
const END = new Date("2026-09-01T00:00:00Z");
const AS_OF = new Date("2026-09-02T00:00:00Z");

const financial: FinancialSummaryV1 = {
  version: ANALYTICS_VERSION,
  currency: "EUR",
  periodStart: START,
  periodEnd: END,
  asOf: AS_OF,
  contractedCents: 27_000,
  scheduledDueCents: 27_000,
  grossRecordedPaymentsCents: 19_000,
  refundsCents: 3_000,
  netRecordedPaymentsCents: 16_000,
  bankSettledGrossCents: 15_500,
  bankRefundOutflowsCents: 3_000,
  bankSettledNetCents: 12_500,
  outstandingExposureCents: 11_000,
  overdueExposureCents: 11_000,
};

const timeline: ContractFinancialTimelineV1 = {
  version: ANALYTICS_VERSION,
  currency: "EUR",
  contractId: 1,
  customerId: 1,
  totalAmountCents: 12_000,
  asOf: AS_OF,
  events: [
    {
      type: "payment_recorded",
      entityId: 1,
      effectiveAt: "2026-06-01T09:00:00.000Z",
      amountCents: 12_000,
    },
  ],
};

const reconciliation: ReconciliationSummaryV1 = {
  version: ANALYTICS_VERSION,
  runId: 1,
  cutoff: new Date("2026-08-31T23:59:59.999Z"),
  ruleSetVersion: "reconciliation-v1",
  statusAsOf: AS_OF,
  totalFindings: 3,
  openFindings: 1,
  byRule: {
    INTERNAL_PAYMENT_MISSING_BANK_SETTLEMENT: 1,
  },
  bySeverity: {
    warning: 2,
    critical: 1,
  },
  byStatus: {
    open: 1,
    acknowledged: 0,
    resolved: 1,
    ignored: 1,
  },
};

const apps: FastifyInstance[] = [];

function app(
  overrides: Partial<HttpUseCases> = {},
): FastifyInstance {
  const unexpected = async () => {
    throw new Error("Unexpected route");
  };

  const built = buildApp({
    createCustomer: unexpected,
    getCustomerById: unexpected,
    createContract: unexpected,
    getContractById: unexpected,
    recordPayment: unexpected,
    getPaymentById: unexpected,
    recordRefund: unexpected,
    getRefundById: unexpected,
    processStripeWebhook: unexpected,

    stripeWebhookClock: {
      now: () => AS_OF,
    },

    verifyStripeSignature: () => {
      throw new Error("Unexpected route");
    },

    accessTokenVerifier: TEST_ACCESS_TOKEN_VERIFIER,

    getFinancialSummaryV1: async () => financial,
    getContractFinancialTimelineV1: async () =>
      timeline,
    getReconciliationSummaryV1: async () =>
      reconciliation,

    ...overrides,
  } as HttpUseCases);

  authenticateTestRequests(built);

  apps.push(built);

  return built;
}

afterEach(async () => {
  await Promise.all(
    apps.splice(0).map((item) => item.close()),
  );
});

describe("Analytics HTTP interface", () => {
  it(
    "serializes a financial summary and exact filters",
    async () => {
      let input: unknown;

      const response = await app({
        getFinancialSummaryV1: async (value) => {
          input = value;
          return financial;
        },
      }).inject({
        method: "GET",
        url:
          "/analytics/financial-summary" +
          "?periodStart=2026-05-01T00%3A00%3A00Z" +
          "&periodEnd=2026-09-01T00%3A00%3A00Z" +
          "&asOf=2026-09-02T00%3A00%3A00Z" +
          "&customerId=2",
      });

      expect(response.statusCode).toBe(200);

      expect(input).toMatchObject({
        customerId: 2,
      });

      expect(response.json()).toMatchObject({
        periodStart: START.toISOString(),
        netRecordedPaymentsCents: 16_000,
      });
    },
  );

  it(
    "serializes the ordered Contract timeline",
    async () => {
      const response = await app().inject({
        method: "GET",
        url:
          "/analytics/contracts/1/timeline" +
          "?asOf=2026-09-02T00%3A00%3A00Z",
      });

      expect(response.statusCode).toBe(200);

      expect(response.json()).toEqual({
        ...timeline,
        asOf: AS_OF.toISOString(),
      });
    },
  );

  it(
    "serializes reconciliation counts",
    async () => {
      const response = await app().inject({
        method: "GET",
        url:
          "/analytics/reconciliation-summary" +
          "?runId=1" +
          "&statusAsOf=2026-09-02T00%3A00%3A00Z",
      });

      expect(response.statusCode).toBe(200);

      expect(response.json()).toMatchObject({
        runId: 1,
        cutoff: "2026-08-31T23:59:59.999Z",
        openFindings: 1,
      });
    },
  );

  it.each([
    "/analytics/financial-summary?periodStart=x&periodEnd=2026-09-01T00%3A00%3A00Z&asOf=2026-09-02T00%3A00%3A00Z",
    "/analytics/contracts/no/timeline?asOf=2026-09-02T00%3A00%3A00Z",
    "/analytics/reconciliation-summary?runId=1&statusAsOf=x",
    "/analytics/reconciliation-summary?runId=1&statusAsOf=2026-09-02T00%3A00%3A00Z&extra=x",
  ])(
    "rejects malformed strict request %s",
    async (url) => {
      const response = await app().inject({
        method: "GET",
        url,
      });

      expect(response.statusCode).toBe(400);
    },
  );

  it.each([
    [
      new AnalyticsContractNotFoundError(9),
      "getContractFinancialTimelineV1",
      "ANALYTICS_CONTRACT_NOT_FOUND",
    ],
    [
      new AnalyticsRunNotFoundError(9),
      "getReconciliationSummaryV1",
      "ANALYTICS_RUN_NOT_FOUND",
    ],
  ] as const)(
    "maps dedicated missing-resource errors",
    async (error, key, code) => {
      const overrides =
        key === "getContractFinancialTimelineV1"
          ? {
              getContractFinancialTimelineV1:
                async () => {
                  throw error;
                },
            }
          : {
              getReconciliationSummaryV1:
                async () => {
                  throw error;
                },
            };

      const url =
        key === "getContractFinancialTimelineV1"
          ? "/analytics/contracts/9/timeline?asOf=2026-09-02T00%3A00%3A00Z"
          : "/analytics/reconciliation-summary?runId=9&statusAsOf=2026-09-02T00%3A00%3A00Z";

      const response = await app(
        overrides,
      ).inject({
        method: "GET",
        url,
      });

      expect(response.statusCode).toBe(404);

      expect(response.json().error.code).toBe(
        code,
      );
    },
  );
});