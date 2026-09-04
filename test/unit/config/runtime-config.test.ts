import { describe, expect, it } from "vitest";

import {
  loadRuntimeConfig,
  RuntimeConfigError,
} from "../../../src/config/runtime-config.js";

const validEnvironment = (): NodeJS.ProcessEnv => ({
  DATABASE_URL: "postgresql://rios:local@127.0.0.1:5432/rios",
  STRIPE_WEBHOOK_SECRET: "whsec_test_only",
  AUTH0_ISSUER: "https://tenant.example/",
  AUTH0_AUDIENCE: "rios-api",
  AUTH0_ROLES_CLAIM: "roles",
  LOG_LEVEL: "debug",
  HOST: "127.0.0.1",
  PORT: "4000",
});

function expectInvalid(variable: string, value: string | undefined): void {
  const env = validEnvironment();
  if (value === undefined) {
    delete env[variable];
  } else {
    env[variable] = value;
  }

  expect(() => loadRuntimeConfig(env)).toThrowError(
    new RuntimeConfigError(`${variable} is invalid`),
  );
}

describe("runtime configuration", () => {
  it("parses a complete valid configuration", () => {
    expect(loadRuntimeConfig(validEnvironment())).toEqual({
      databaseUrl: "postgresql://rios:local@127.0.0.1:5432/rios",
      stripeWebhookSecret: "whsec_test_only",
      auth0Issuer: "https://tenant.example/",
      auth0Audience: "rios-api",
      auth0RolesClaim: "roles",
      logLevel: "debug",
      host: "127.0.0.1",
      port: 4000,
    });
  });

  it("applies LOG_LEVEL, HOST and PORT defaults", () => {
    const env = validEnvironment();
    delete env.LOG_LEVEL;
    delete env.HOST;
    delete env.PORT;

    expect(loadRuntimeConfig(env)).toMatchObject({
      logLevel: "info",
      host: "0.0.0.0",
      port: 3000,
    });
  });

  it.each(["debug", "info", "warn", "error"])(
    "accepts LOG_LEVEL %s",
    (value) => {
      expect(loadRuntimeConfig({ ...validEnvironment(), LOG_LEVEL: value }).logLevel)
        .toBe(value);
    },
  );

  it("rejects an unsupported LOG_LEVEL", () => {
    expectInvalid("LOG_LEVEL", "trace");
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["malformed", "not-a-url"],
    ["wrong protocol", "https://database.example/rios"],
  ])("rejects a %s DATABASE_URL", (_case, value) => {
    expectInvalid("DATABASE_URL", value);
  });

  it.each([
    "postgres://rios@localhost/rios",
    "postgresql://rios@localhost/rios",
  ])("accepts PostgreSQL DATABASE_URL %s", (value) => {
    expect(loadRuntimeConfig({ ...validEnvironment(), DATABASE_URL: value }).databaseUrl)
      .toBe(value);
  });

  it.each([undefined, ""])(
    "rejects a missing or empty STRIPE_WEBHOOK_SECRET",
    (value) => {
      expectInvalid("STRIPE_WEBHOOK_SECRET", value);
    },
  );

  it.each([
    ["AUTH0_ISSUER", undefined],
    ["AUTH0_ISSUER", ""],
    ["AUTH0_ISSUER", "not-a-url"],
    ["AUTH0_ISSUER", "http://tenant.example/"],
    ["AUTH0_AUDIENCE", undefined],
    ["AUTH0_AUDIENCE", ""],
    ["AUTH0_ROLES_CLAIM", undefined],
    ["AUTH0_ROLES_CLAIM", ""],
  ])("rejects invalid %s configuration", (variable, value) => {
    expectInvalid(variable, value);
  });

  it("preserves the supplied HTTPS Auth0 issuer", () => {
    const issuer = "https://tenant.example/custom-path/";
    expect(loadRuntimeConfig({ ...validEnvironment(), AUTH0_ISSUER: issuer }).auth0Issuer)
      .toBe(issuer);
  });

  it.each(["not-a-number", "1.5", "0", "65536"])(
    "rejects invalid PORT %s",
    (value) => {
      expectInvalid("PORT", value);
    },
  );

  it("accepts a valid integer PORT", () => {
    expect(loadRuntimeConfig({ ...validEnvironment(), PORT: "65535" }).port)
      .toBe(65_535);
  });

  it("does not expose database or Stripe secret values in validation errors", () => {
    const databaseUrl = "https://user:private-password@database.example/rios";
    const stripeSecret = "whsec_must_not_appear";

    let failure: unknown;
    try {
      loadRuntimeConfig({
        ...validEnvironment(),
        DATABASE_URL: databaseUrl,
        STRIPE_WEBHOOK_SECRET: stripeSecret,
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(RuntimeConfigError);
    expect(String(failure)).not.toContain(databaseUrl);
    expect(String(failure)).not.toContain(stripeSecret);
  });
});
