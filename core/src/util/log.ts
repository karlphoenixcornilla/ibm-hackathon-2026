// util/log.ts — lightweight logger (Node and browser safe)

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const PREFIX = '[Reprise]';

function fmt(level: LogLevel, tag: string, message: string): string {
  return `${PREFIX} [${level.toUpperCase()}] [${tag}] ${message}`;
}

export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

export function createLogger(tag: string): Logger {
  return {
    debug(message, ...args) {
      if (isDev()) console.debug(fmt('debug', tag, message), ...args);
    },
    info(message, ...args) {
      console.info(fmt('info', tag, message), ...args);
    },
    warn(message, ...args) {
      console.warn(fmt('warn', tag, message), ...args);
    },
    error(message, ...args) {
      console.error(fmt('error', tag, message), ...args);
    },
  };
}

function isDev(): boolean {
  // Suppress debug logs in production builds. The bundler replaces this.
  return typeof process === 'undefined' || process.env['NODE_ENV'] !== 'production';
}
