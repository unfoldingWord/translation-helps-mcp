/**
 * Structured JSON logger.
 * Every log line is a single-line JSON object with stable fields,
 * making it trivially parseable by Workers Logs, Logpush, and the
 * GitHub Actions error→issue cron.
 *
 * Params are intentionally EXCLUDED from log lines to avoid leaking
 * user data to log aggregators; they are only included at "debug" level
 * when explicitly requested.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  level: LogLevel;
  /** Stable machine-readable error code (matches ErrorCode enum). */
  code?: string;
  /** MCP tool name that produced this log entry. */
  tool?: string;
  /** Per-request trace ID, propagated from the MCP requestId. */
  requestId?: string;
  message: string;
  ts: string;
  [key: string]: unknown;
}

function emit(entry: LogEntry): void {
  const line = JSON.stringify(entry);
  if (entry.level === "error" || entry.level === "warn") {
    console.error(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  debug(
    message: string,
    ctx?: Omit<LogEntry, "level" | "message" | "ts">,
  ): void {
    emit({ level: "debug", message, ts: new Date().toISOString(), ...ctx });
  },
  info(
    message: string,
    ctx?: Omit<LogEntry, "level" | "message" | "ts">,
  ): void {
    emit({ level: "info", message, ts: new Date().toISOString(), ...ctx });
  },
  warn(
    message: string,
    ctx?: Omit<LogEntry, "level" | "message" | "ts">,
  ): void {
    emit({ level: "warn", message, ts: new Date().toISOString(), ...ctx });
  },
  error(
    message: string,
    ctx?: Omit<LogEntry, "level" | "message" | "ts">,
  ): void {
    emit({ level: "error", message, ts: new Date().toISOString(), ...ctx });
  },
};
