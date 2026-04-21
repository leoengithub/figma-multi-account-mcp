import pino, { type Logger } from 'pino';

const FIGMA_TOKEN_RE = /figd_[a-zA-Z0-9_-]+/g;

export function redactFigmaTokens(input: string): string {
  return input.replaceAll(FIGMA_TOKEN_RE, 'figd_[REDACTED]');
}

export function createLogger(): Logger {
  return pino({
    level: process.env.LOG_LEVEL ?? 'info',
    hooks: {
      logMethod(args, method) {
        const redacted = args.map((arg) => {
          if (typeof arg === 'string') return redactFigmaTokens(arg);
          return arg;
        });
        // @ts-expect-error pino internal typing
        method.apply(this, redacted);
      },
    },
  });
}

