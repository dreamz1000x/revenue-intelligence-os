import { describe, expect, it, vi } from "vitest";

import {
  createGracefulShutdown,
  registerGracefulShutdownSignals,
  type GracefulShutdown,
  type ShutdownSignal,
} from "../../../src/runtime/graceful-shutdown.js";

describe("graceful shutdown lifecycle", () => {
  it("closes exactly once when shutdown is requested repeatedly", async () => {
    const close = vi.fn(async () => undefined);
    const reportFailure = vi.fn();
    const setExitCode = vi.fn();
    const shutdown = createGracefulShutdown({
      close,
      reportFailure,
      setExitCode,
    });

    await Promise.all([shutdown(), shutdown(), shutdown()]);

    expect(close).toHaveBeenCalledOnce();
    expect(reportFailure).not.toHaveBeenCalled();
    expect(setExitCode).not.toHaveBeenCalled();
  });

  it("reports a fixed failure and sets a non-zero exit code", async () => {
    const secretError = new Error("secret-database-shutdown-detail");
    const reportFailure = vi.fn();
    const setExitCode = vi.fn();
    const shutdown = createGracefulShutdown({
      close: async () => Promise.reject(secretError),
      reportFailure,
      setExitCode,
    });

    await shutdown();

    expect(reportFailure).toHaveBeenCalledOnce();
    expect(reportFailure).toHaveBeenCalledWith();
    expect(setExitCode).toHaveBeenCalledOnce();
    expect(setExitCode).toHaveBeenCalledWith(1);
  });

  it("wires SIGTERM and SIGINT to the same idempotent shutdown", async () => {
    const close = vi.fn(async () => undefined);
    const shutdown = createGracefulShutdown({
      close,
      reportFailure: vi.fn(),
      setExitCode: vi.fn(),
    });
    const listeners = new Map<ShutdownSignal, GracefulShutdown>();

    registerGracefulShutdownSignals(
      shutdown,
      (signal, listener) => listeners.set(signal, listener),
    );

    expect(listeners.get("SIGTERM")).toBe(shutdown);
    expect(listeners.get("SIGINT")).toBe(shutdown);
    await Promise.all([
      listeners.get("SIGTERM")!(),
      listeners.get("SIGINT")!(),
    ]);
    expect(close).toHaveBeenCalledOnce();
  });
});
