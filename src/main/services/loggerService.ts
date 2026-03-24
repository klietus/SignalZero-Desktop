
import winston from 'winston';
import 'winston-daily-rotate-file';
import path from 'path';
import { app } from 'electron';
import { eventBusService, KernelEventType } from './eventBusService.js';

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

export enum LogCategory {
  KERNEL = 'KERNEL',
  INFERENCE = 'INFERENCE',
  DOMAIN = 'DOMAIN',
  UI = 'UI',
  SQLITE = 'SQLITE',
  LANCEDB = 'LANCEDB',
  MCP = 'MCP',
  SYSTEM = 'SYSTEM',
  AGENT = 'AGENT',
  VOICE = 'VOICE',
  TOOL = 'TOOL'
}

class LoggerService {
  private logger: winston.Logger;
  private categoryLevels: Map<LogCategory | string, LogLevel> = new Map();
  private defaultLevel: LogLevel = 'debug';

  constructor() {
    const logDir = path.join(app.getPath('userData'), 'logs');

    const transport = new winston.transports.DailyRotateFile({
      filename: path.join(logDir, 'application-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '50m',
      maxFiles: '14d',
    });

    this.logger = winston.createLogger({
      level: 'debug',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      transports: [
        transport,
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.printf(({ timestamp, level, message, category, ...meta }) => {
              const catStr = category ? `[${category}] ` : '';
              const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
              return `${timestamp} ${level}: ${catStr}${message}${metaStr}`;
            })
          ),
        }),
      ],
    });
  }

  setCategoryLevel(category: LogCategory | string, level: LogLevel) {
    this.categoryLevels.set(category, level);
  }

  setDefaultLevel(level: LogLevel) {
    this.defaultLevel = level;
  }

  private shouldLog(category: LogCategory | string, level: LogLevel): boolean {
    const targetLevel = this.categoryLevels.get(category) || this.defaultLevel;
    const levels: LogLevel[] = ['error', 'warn', 'info', 'debug'];
    const targetIdx = levels.indexOf(targetLevel);
    const currentIdx = levels.indexOf(level);
    return currentIdx <= targetIdx;
  }

  log(level: LogLevel, category: LogCategory | string, message: string, meta?: any) {
    const logEntry = { timestamp: new Date().toISOString(), level, category, message, ...meta };
    if (this.shouldLog(category, level)) {
      this.logger.log(level, message, { category, ...meta });
    }
    // Always emit to bus for the UI log viewer
    eventBusService.emitKernelEvent(KernelEventType.SYSTEM_LOG as any, logEntry);
  }

  catInfo(category: LogCategory | string, message: string, meta?: any) {
    this.log('info', category, message, meta);
  }

  catError(category: LogCategory | string, message: string, meta?: any) {
    this.log('error', category, message, meta);
  }
  
  catWarn(category: LogCategory | string, message: string, meta?: any) {
    this.log('warn', category, message, meta);
  }

  catDebug(category: LogCategory | string, message: string, meta?: any) {
    this.log('debug', category, message, meta);
  }

  info(message: string, meta?: any) { this.catInfo(LogCategory.SYSTEM, message, meta); }
  error(message: string, meta?: any) { this.catError(LogCategory.SYSTEM, message, meta); }
  warn(message: string, meta?: any) { this.catWarn(LogCategory.SYSTEM, message, meta); }
  debug(message: string, meta?: any) { this.catDebug(LogCategory.SYSTEM, message, meta); }
}

export const loggerService = new LoggerService();
