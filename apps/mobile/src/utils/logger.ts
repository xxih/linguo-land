/**
 * 移动端 logger。RN 上 console.log 是允许直用的（CLAUDE.md 的 logger 强制规则
 * 只针对 apps/extension），但仍包一层做：
 *   1. 生产构建（__DEV__ === false）静默 debug/log
 *   2. 标准化前缀，便于 Metro / 设备日志检索
 */
const isDev = typeof __DEV__ !== 'undefined' ? __DEV__ : true;

function format(level: string, scope: string, args: unknown[]): unknown[] {
  return [`[${level}][${scope}]`, ...args];
}

export function createLogger(scope: string) {
  return {
    debug: (...args: unknown[]) => {
      if (!isDev) return;
      console.log(...format('debug', scope, args));
    },
    info: (...args: unknown[]) => {
      console.log(...format('info', scope, args));
    },
    warn: (...args: unknown[]) => {
      console.warn(...format('warn', scope, args));
    },
    error: (...args: unknown[]) => {
      console.error(...format('error', scope, args));
    },
  };
}
