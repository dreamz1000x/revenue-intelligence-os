export type ShutdownSignal = "SIGTERM" | "SIGINT";

export interface GracefulShutdownDependencies {
  readonly close: () => Promise<void>;
  readonly reportFailure: () => void;
  readonly setExitCode: (code: number) => void;
}

export type GracefulShutdown = () => Promise<void>;
export type SignalSubscriber = (
  signal: ShutdownSignal,
  listener: GracefulShutdown,
) => void;

export function createGracefulShutdown(
  dependencies: GracefulShutdownDependencies,
): GracefulShutdown {
  let shutdownPromise: Promise<void> | undefined;

  return () => {
    shutdownPromise ??= (async () => {
      try {
        await dependencies.close();
      } catch {
        dependencies.reportFailure();
        dependencies.setExitCode(1);
      }
    })();

    return shutdownPromise;
  };
}

export function registerGracefulShutdownSignals(
  shutdown: GracefulShutdown,
  subscribe: SignalSubscriber = (signal, listener) => {
    process.on(signal, listener);
  },
): void {
  subscribe("SIGTERM", shutdown);
  subscribe("SIGINT", shutdown);
}
