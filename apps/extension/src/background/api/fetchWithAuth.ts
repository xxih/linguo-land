/**
 * 带认证的 fetch 包装器
 * 实现自动刷新令牌的无感刷新逻辑
 */

import { refreshAccessToken } from './authApi';
import { Logger } from '../../utils/logger';

const logger = new Logger('fetchWithAuth');

/**
 * 带认证的 fetch 请求
 * 自动处理 401 错误并刷新令牌
 */
export async function fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
  // 1. 获取 accessToken 并添加到请求头
  const storage = await chrome.storage.local.get('accessToken');
  const accessToken = storage.accessToken;

  const headers = new Headers(options.headers);
  if (accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  }

  options.headers = headers;

  // 2. 发起请求
  let response = await fetch(url, options);

  // 3. 如果是 401 错误，并且不是刷新令牌的请求，则尝试刷新
  if (response.status === 401 && !url.includes('/auth/refresh')) {
    logger.debug('Access token expired. Attempting to refresh...');

    const refreshResult = await refreshAccessToken();

    if (refreshResult) {
      // 4. 刷新成功，用新 token 重新发起原始请求
      logger.debug('Token refreshed. Retrying original request...');
      headers.set('Authorization', `Bearer ${refreshResult.access_token}`);
      options.headers = headers;
      response = await fetch(url, options);
    } else {
      // 5. 刷新失败，用户需要重新登录
      logger.error('Failed to refresh token. User needs to login again.', new Error('Token refresh failed'));

      // 触发一个事件，通知 UI 显示登录界面
      chrome.runtime
        .sendMessage({
          type: 'AUTH_REQUIRED',
        })
        .catch(() => {
          // 如果没有接收者，忽略错误
        });
    }
  }

  return response;
}

/**
 * 带认证的 fetch 请求（返回 JSON）
 */
export async function fetchJsonWithAuth<T = any>(
  url: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetchWithAuth(url, options);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(error.message || `HTTP ${response.status}: ${response.statusText}`);
  }

  return response.json();
}
