import { describe, expect, it } from "vitest";
import { resolveDemoResetTarget } from "../../../src/demo/reset-demo.js";

describe("demo reset safety", () => {
  it("accepts only explicit confirmation, a _demo database, and local host", () => {
    expect(resolveDemoResetTarget({ databaseUrl: "postgresql://user:pass@127.0.0.1:5432/rios_demo", confirmation: "YES" }).displayTarget).toBe("127.0.0.1:5432/rios_demo");
  });
  it.each([
    [{ databaseUrl: "postgresql://localhost/rios_demo" }, "RIOS_DEMO_RESET"],
    [{ databaseUrl: "postgresql://localhost/rios", confirmation: "YES" }, "must end with _demo"],
    [{ databaseUrl: "postgresql://db.example/rios_demo", confirmation: "YES" }, "local host"],
  ])("refuses unsafe targets", (input, message) => expect(() => resolveDemoResetTarget(input)).toThrow(message));
  it("allows an explicitly approved disposable host", () => expect(resolveDemoResetTarget({ databaseUrl: "postgresql://docker-host/rios_demo", confirmation: "YES", allowDisposableHost: "YES" }).displayTarget).toBe("docker-host:5432/rios_demo"));
});
