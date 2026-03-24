
type LogLevel = 'info' | 'warn' | 'error' | 'debug';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  category: string;
  message: string;
  data?: any;
}

class LoggerService {
  private logs: LogEntry[] = [];
  private maxLogs: number = 1000;

  private addEntry(level: LogLevel, category: string, message: string, data?: any) {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      category,
      message,
      data
    };

    // Console output with styling
    const styles = {
      info: 'color: #10b981; font-weight: bold;',
      warn: 'color: #f59e0b; font-weight: bold;',
      error: 'color: #ef4444; font-weight: bold;',
      debug: 'color: #3b82f6; font-weight: bold;'
    };

    console.groupCollapsed(`%c[${level.toUpperCase()}] [${category}] ${message}`, styles[level]);
    if (data) console.log(data);
    console.log(`Timestamp: ${entry.timestamp}`);
    console.groupEnd();

    this.logs.unshift(entry);
    if (this.logs.length > this.maxLogs) {
      this.logs.pop();
    }
    
    // Potential expansion: persist to localStorage or send to backend
  }

  info(category: string, message: string, data?: any) {
    this.addEntry('info', category, message, data);
  }

  warn(category: string, message: string, data?: any) {
    this.addEntry('warn', category, message, data);
  }

  error(category: string, message: string, data?: any) {
    this.addEntry('error', category, message, data);
  }

  debug(category: string, message: string, data?: any) {
    this.addEntry('debug', category, message, data);
  }

  getLogs() {
    return this.logs;
  }
  
  clear() {
    this.logs = [];
  }
}

export const logger = new LoggerService();
