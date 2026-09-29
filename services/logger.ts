import fs from 'node:fs';
import path from 'node:path';
import winston from 'winston';
import {
  createReliabilityEvent,
  ReliabilityEventName,
  ReliabilityRoute,
  validateReliabilityEvent,
} from './observability/event-schema';

const logDir = path.resolve(process.cwd(), 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
  ),
  defaultMeta: { service: 'atlas-knowledge' },
  transports: [
    new winston.transports.File({ 
      filename: path.join(logDir, 'error.log'), 
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }),
    new winston.transports.File({ 
      filename: path.join(logDir, 'combined.log'),
      maxsize: 5242880,
      maxFiles: 10
    })
  ]
});

// Add console transport in development
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    )
  }));
}

export default logger;

export interface ReliabilityLogInput {
  eventName: ReliabilityEventName;
  requestId: string;
  route: ReliabilityRoute;
  reliability: {
    errorClass?:
      | 'TRANSIENT_PROVIDER'
      | 'TRANSIENT_EXHAUSTED'
      | 'TERMINAL_PROVIDER'
      | 'TERMINAL_REQUEST'
      | 'INTERNAL_UNKNOWN';
    code?: string;
    degraded?: boolean;
    retryable?: boolean;
    retryAfterMs?: number;
    attemptsUsed?: number;
    fallbackServed?: boolean;
    status?: number;
    latencyMs?: number;
    severity?: 'warning' | 'critical' | 'none';
  };
  level?: 'info' | 'warn' | 'error';
  extra?: Record<string, unknown>;
}

export function logReliabilityEvent(input: ReliabilityLogInput): void {
  const event = createReliabilityEvent({
    eventName: input.eventName,
    requestId: input.requestId,
    route: input.route,
    reliability: input.reliability,
  });
  const validation = validateReliabilityEvent(event);

  if (!validation.valid) {
    logger.warn('reliability_event_invalid', {
      requestId: input.requestId,
      eventName: input.eventName,
      errors: validation.errors,
    });
  }

  const level = input.level ?? 'info';
  logger.log(level, input.eventName, {
    ...event,
    ...(input.extra ?? {}),
  });
}
