import winston from 'winston';
import 'winston-daily-rotate-file';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import { eventBusService, KernelEventType } from './eventBusService.js';
import { randomUUID } from 'crypto';

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
  TOOL = 'TOOL',
  MONITORING = 'MONITORING'
}

class LoggerService {
  private logger: winston.Logger;
  private categoryLevels: Map<LogCategory | string, LogLevel> = new Map();
  private defaultLevel: LogLevel = 'debug';
  private logDir: string;

  constructor() {
    this.logDir = path.join(app.getPath('userData'), 'logs');
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }

    const transport = new winston.transports.DailyRotateFile({
      filename: path.join(this.logDir, 'application-%DATE%.log'),
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
    const logEntry = { 
        id: randomUUID(),
        timestamp: new Date().toISOString(), 
        level, 
        category, 
        message, 
        ...meta 
    };
    
    if (this.shouldLog(category, level)) {
      this.logger.log(level, message, { category, ...meta });
    }
    
    // Always emit to bus for the UI log viewer
    eventBusService.emitKernelEvent(KernelEventType.SYSTEM_LOG, logEntry);
  }

  async getRecentLogs(limit: number = 100): Promise<any[]> {
    try {
        const files = fs.readdirSync(this.logDir)
            .filter(f => f.startsWith('application-') && f.endsWith('.log'))
            .sort((a, b) => b.localeCompare(a)); // Newest first

        if (files.length === 0) return [];

        const latestFile = path.join(this.logDir, files[0]);
        const content = fs.readFileSync(latestFile, 'utf8');
        const lines = content.trim().split('\n');
        
        return lines.slice(-limit).map(line => {
            try {
                return JSON.parse(line);
            } catch (e) {
                return { message: line, level: 'info', category: 'SYSTEM' };
            }
        });
    } catch (error) {
        console.error("Failed to read recent logs", error);
        return [];
    }
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
