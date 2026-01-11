// apps/extension/src/utils/logger.ts

type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

// 判断是否为生产环境（Vite在构建时会处理这个变量）
const isDevelopment = import.meta.env.MODE === 'development';

export class Logger {
  private componentName: string;

  constructor(componentName: string) {
    this.componentName = componentName;
  }

  public debug(message: string, context?: Record<string, any>): void {
    // 在生产环境中，debug日志不执行任何操作，实现零成本
    if (!isDevelopment) {
      return;
    }
    this.log('DEBUG', message, context);
  }

  public info(message: string, context?: Record<string, any>): void {
    if (!isDevelopment) {
      return;
    }
    this.log('INFO', message, context);
  }

  public warn(message: string, context?: Record<string, any>): void {
    this.log('WARN', message, context);
  }

  public error(message: string, error?: Error, context?: Record<string, any>): void {
    const errorContext = {
      ...context,
      errorMessage: error?.message,
      stack: error?.stack?.split('\n').map((line) => line.trim()),
    };
    this.log('ERROR', message, errorContext);
  }

  private log(level: LogLevel, message: string, context: Record<string, any> = {}): void {
    if (!isDevelopment) {
      return;
    }
    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      component: this.componentName,
      message,
      ...context,
    };

    // 根据级别选择不同的 console 方法
    switch (level) {
      case 'DEBUG':
        console.debug(JSON.stringify(logEntry));
        break;
      case 'INFO':
        console.info(JSON.stringify(logEntry));
        break;
      case 'WARN':
        console.warn(JSON.stringify(logEntry));
        break;
      case 'ERROR':
        console.error(JSON.stringify(logEntry));
        break;
    }
  }
}

export const logger = new Logger('Logger');
