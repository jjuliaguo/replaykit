/**
 * Minimal structured logger. The mock server and the runner log through this
 * interface so tests can capture entries in memory instead of reading stdout.
 */
export type LogLevel = "info" | "warn" | "error";

export interface LogEntry {
  level: LogLevel;
  message: string;
  data?: Record<string, unknown>;
  at: string;
}

export interface Logger {
  log(level: LogLevel, message: string, data?: Record<string, unknown>): void;
}

export function createConsoleLogger(prefix = "replay"): Logger {
  return {
    log(level, message, data) {
      const line = `[${prefix}] ${level.toUpperCase()} ${message}`;
      const out = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
      if (data && Object.keys(data).length > 0) out(line, JSON.stringify(data));
      else out(line);
    },
  };
}

export function createMemoryLogger(): Logger & { entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  return {
    entries,
    log(level, message, data) {
      entries.push({ level, message, data, at: new Date().toISOString() });
    },
  };
}

export function createTeeLogger(...loggers: Logger[]): Logger {
  return {
    log(level, message, data) {
      for (const l of loggers) l.log(level, message, data);
    },
  };
}
