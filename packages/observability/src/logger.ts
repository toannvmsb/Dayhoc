/** Minimal structured logger. Emits one JSON object per line (sink-agnostic). */

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export type LogFields = Record<string, unknown>;

export interface Logger {
  readonly child: (bindings: LogFields) => Logger;
  readonly debug: (msg: string, fields?: LogFields) => void;
  readonly info: (msg: string, fields?: LogFields) => void;
  readonly warn: (msg: string, fields?: LogFields) => void;
  readonly error: (msg: string, fields?: LogFields) => void;
}

export interface LoggerOptions {
  readonly level?: LogLevel;
  readonly bindings?: LogFields;
  readonly sink?: (line: string) => void;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? 'info';
  const bindings = options.bindings ?? {};
  const sink = options.sink ?? ((line) => process.stdout.write(line + '\n'));

  const emit = (lvl: LogLevel, msg: string, fields?: LogFields): void => {
    if (LEVEL_ORDER[lvl] < LEVEL_ORDER[level]) return;
    const record = {
      ts: new Date().toISOString(),
      level: lvl,
      msg,
      ...bindings,
      ...fields,
    };
    sink(JSON.stringify(record));
  };

  return {
    child: (extra) => createLogger({ level, bindings: { ...bindings, ...extra }, sink }),
    debug: (msg, fields) => emit('debug', msg, fields),
    info: (msg, fields) => emit('info', msg, fields),
    warn: (msg, fields) => emit('warn', msg, fields),
    error: (msg, fields) => emit('error', msg, fields),
  };
}
