import { z } from "zod";

const databaseUrl = z.string().min(1).refine((value) => {
  try {
    return ["postgres:", "postgresql:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
});

const auth0Issuer = z.string().min(1).refine((value) => {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
});

const port = z
  .string()
  .regex(/^\d+$/)
  .transform(Number)
  .pipe(z.number().int().min(1).max(65_535));

const runtimeEnvironment = z.object({
  DATABASE_URL: databaseUrl,
  STRIPE_WEBHOOK_SECRET: z.string().min(1),
  AUTH0_ISSUER: auth0Issuer,
  AUTH0_AUDIENCE: z.string().min(1),
  AUTH0_ROLES_CLAIM: z.string().min(1),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  HOST: z.string().min(1).default("0.0.0.0"),
  PORT: port.default(3000),
});

export interface RuntimeConfig {
  readonly databaseUrl: string;
  readonly stripeWebhookSecret: string;
  readonly auth0Issuer: string;
  readonly auth0Audience: string;
  readonly auth0RolesClaim: string;
  readonly logLevel: "debug" | "info" | "warn" | "error";
  readonly host: string;
  readonly port: number;
}

export class RuntimeConfigError extends Error {
  override readonly name = "RuntimeConfigError";
}

export function loadRuntimeConfig(env: NodeJS.ProcessEnv): RuntimeConfig {
  const result = runtimeEnvironment.safeParse(env);

  if (!result.success) {
    const variable = result.error.issues[0]?.path[0];
    throw new RuntimeConfigError(
      typeof variable === "string"
        ? `${variable} is invalid`
        : "Runtime configuration is invalid",
    );
  }

  return {
    databaseUrl: result.data.DATABASE_URL,
    stripeWebhookSecret: result.data.STRIPE_WEBHOOK_SECRET,
    auth0Issuer: result.data.AUTH0_ISSUER,
    auth0Audience: result.data.AUTH0_AUDIENCE,
    auth0RolesClaim: result.data.AUTH0_ROLES_CLAIM,
    logLevel: result.data.LOG_LEVEL,
    host: result.data.HOST,
    port: result.data.PORT,
  };
}
