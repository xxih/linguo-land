/**
 * 认证 API
 */

import { getApiBaseUrl } from './apiConfig';
import { Logger } from '../../utils/logger';

const logger = new Logger('authApi');

// localhost 来判断
const isDevelopment = window.location.hostname === 'localhost';

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
}

export interface AuthResponse {
  access_token: string;
  refresh_token: string;
  user: {
    id: number;
    email: string;
  };
}

export interface RefreshTokenRequest {
  refreshToken: string;
}

/**
 * 把 fetch Response 解析成 JSON；body 为空或非 JSON 时抛带 HTTP 状态的友好错误，
 * 而不是把原始 "Unexpected end of JSON input" 暴露给用户。
 */
async function readJsonOrThrow<T>(response: Response, fallbackMessage: string): Promise<T> {
  const text = await response.text();
  let parsed: any = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      // 非 JSON：例如 nginx 的 502 HTML、连接被中间层截断
      if (!response.ok) {
        throw new Error(`${fallbackMessage}（HTTP ${response.status}）`);
      }
      throw new Error(`${fallbackMessage}：服务器返回非 JSON 响应（HTTP ${response.status}）`);
    }
  }

  if (!response.ok) {
    const message = parsed?.message ?? `${fallbackMessage}（HTTP ${response.status}）`;
    throw new Error(Array.isArray(message) ? message.join('；') : message);
  }

  if (parsed === null) {
    throw new Error(`${fallbackMessage}：服务器返回了空响应`);
  }
  return parsed as T;
}

/**
 * 用户注册
 */
export async function register(data: RegisterRequest): Promise<AuthResponse> {
  const API_BASE_URL = await getApiBaseUrl();
  const response = await fetch(`${API_BASE_URL}/auth/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });

  return readJsonOrThrow<AuthResponse>(response, '注册失败');
}

/**
 * 用户登录
 */
export async function login(data: LoginRequest): Promise<AuthResponse> {
  const API_BASE_URL = await getApiBaseUrl();
  const response = await fetch(`${API_BASE_URL}/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });

  const result = await readJsonOrThrow<AuthResponse>(response, '登录失败');

  // 保存令牌到 chrome.storage
  await chrome.storage?.local.set({
    accessToken: result.access_token,
    refreshToken: result.refresh_token,
    user: result.user,
  });

  return result;
}

/**
 * 刷新访问令牌
 */
export async function refreshAccessToken(): Promise<AuthResponse | null> {
  try {
    const API_BASE_URL = await getApiBaseUrl();
    // 获取 refresh token
    const storage = await chrome.storage?.local.get('refreshToken');
    const refreshToken = storage.refreshToken;

    if (!refreshToken) {
      logger.error('No refresh token found', new Error('No refresh token found'));
      return null;
    }

    const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ refreshToken }),
    });

    if (!response.ok) {
      // 刷新令牌也失效了，需要重新登录
      await clearAuth();
      return null;
    }

    const result = await response.json();

    // 保存新的令牌
    await chrome.storage.local.set({
      accessToken: result.access_token,
      refreshToken: result.refresh_token,
    });

    return result;
  } catch (error) {
    logger.error('Failed to refresh access token', error as Error);
    await clearAuth();
    return null;
  }
}

/**
 * 退出登录
 */
export async function logout(): Promise<void> {
  await clearAuth();
}

/**
 * 清除认证信息
 */
async function clearAuth(): Promise<void> {
  await chrome.storage.local.remove(['accessToken', 'refreshToken', 'user']);
}

/**
 * 检查是否已登录
 */
export async function isAuthenticated(): Promise<boolean> {
  const storage = await chrome.storage?.local.get(['accessToken', 'refreshToken']);
  // meta develepment
  if (isDevelopment) {
    return true;
  }
  // 至少需要有 refresh token，因为 access token 可以通过 refresh token 刷新
  return !!storage.refreshToken;
}

/**
 * 获取当前用户信息
 */
export async function getCurrentUser(): Promise<{
  id: number;
  email: string;
} | null> {
  const storage = await chrome.storage?.local.get('user');
  return storage.user || null;
}
