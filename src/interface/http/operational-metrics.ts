export interface OperationalMetricsSnapshot {
  readonly uptimeSeconds: number;
  readonly http: {
    readonly completedRequestsTotal: number;
    readonly responsesByStatusClass: {
      readonly "2xx": number;
      readonly "3xx": number;
      readonly "4xx": number;
      readonly "5xx": number;
      readonly other: number;
    };
  };
}

export interface OperationalMetrics {
  recordResponse(statusCode: number): void;
  snapshot(): OperationalMetricsSnapshot;
}

export function createOperationalMetrics(): OperationalMetrics {
  let completedRequestsTotal = 0;
  const responsesByStatusClass = {
    "2xx": 0,
    "3xx": 0,
    "4xx": 0,
    "5xx": 0,
    other: 0,
  };

  return {
    recordResponse: (statusCode) => {
      completedRequestsTotal += 1;

      if (statusCode >= 200 && statusCode <= 299) {
        responsesByStatusClass["2xx"] += 1;
      } else if (statusCode >= 300 && statusCode <= 399) {
        responsesByStatusClass["3xx"] += 1;
      } else if (statusCode >= 400 && statusCode <= 499) {
        responsesByStatusClass["4xx"] += 1;
      } else if (statusCode >= 500 && statusCode <= 599) {
        responsesByStatusClass["5xx"] += 1;
      } else {
        responsesByStatusClass.other += 1;
      }
    },
    snapshot: () => ({
      uptimeSeconds: Math.max(0, Math.floor(process.uptime())),
      http: {
        completedRequestsTotal,
        responsesByStatusClass: { ...responsesByStatusClass },
      },
    }),
  };
}
