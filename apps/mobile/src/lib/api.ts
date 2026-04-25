/**
 * 移动端 axios 实例 + 鉴权拦截器。
 *
 * - baseURL 来自 EXPO_PUBLIC_API_BASE_URL（运行时可改，写到 SecureStore 覆盖）
 * - 请求拦截：注入 Authorization
 * - 响应拦截：401 → 尝试 /auth/refresh 一次；refresh 失败 → 清 token + 通知 auth store
 */
import axios, {
  AxiosError,
  AxiosHeaders,
  type AxiosInstance,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig,
} from 'axios';
import { readSecure, writeSecure, deleteSecure } from './secure-storage';
import { createLogger } from '../utils/logger';

const log = createLogger('api');

export const ACCESS_TOKEN_KEY = 'linguoland.access_token';
export const REFRESH_TOKEN_KEY = 'linguoland.refresh_token';
export const API_BASE_URL_KEY = 'linguoland.api_base_url';

const DEFAULT_BASE_URL =
  (process.env.EXPO_PUBLIC_API_BASE_URL as string | undefined) ??
  'http://10.0.2.2:3000';

let cachedBaseUrl: string | null = null;

export async function getApiBaseUrl(): Promise<string> {
  if (cachedBaseUrl) return cachedBaseUrl;
  const stored = await readSecure(API_BASE_URL_KEY);
  cachedBaseUrl = stored?.trim() || DEFAULT_BASE_URL;
  return cachedBaseUrl;
}

export async function setApiBaseUrl(url: string): Promise<void> {
  const trimmed = url.trim().replace(/\/+$/, '');
  await writeSecure(API_BASE_URL_KEY, trimmed);
  cachedBaseUrl = trimmed;
  api.defaults.baseURL = trimmed;
}

/** 当 refresh 仍然失败时，调用此回调让 auth store 清登录态 */
let onLogout: (() => void) | null = null;
export function setOnLogout(cb: (() => void) | null) {
  onLogout = cb;
}

export const api: AxiosInstance = axios.create({
  baseURL: DEFAULT_BASE_URL,
  timeout: 20_000,
});

// 启动时把 SecureStore 里持久的 baseURL 灌进 axios
void getApiBaseUrl().then((url) => {
  api.defaults.baseURL = url;
});

api.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  const token = await readSecure(ACCESS_TOKEN_KEY);
  if (token) {
    if (!config.headers) {
      config.headers = new AxiosHeaders();
    }
    (config.headers as AxiosHeaders).set('Authorization', `Bearer ${token}`);
  }
  return config;
});

let refreshing: Promise<string | null> | null = null;

async function refreshTokens(): Promise<string | null> {
  const refresh = await readSecure(REFRESH_TOKEN_KEY);
  if (!refresh) return null;
  try {
    const baseURL = await getApiBaseUrl();
    const res = await axios.post(
      `${baseURL}/api/v1/auth/refresh`,
      { refresh_token: refresh },
      { timeout: 10_000 },
    );
    const access = res.data?.access_token as string | undefined;
    const newRefresh = res.data?.refresh_token as string | undefined;
    if (!access) return null;
    await writeSecure(ACCESS_TOKEN_KEY, access);
    if (newRefresh) await writeSecure(REFRESH_TOKEN_KEY, newRefresh);
    return access;
  } catch (err) {
    log.warn('refresh failed', err);
    return null;
  }
}

api.interceptors.response.use(
  (r) => r,
  async (err: AxiosError) => {
    const original = err.config as
      | (AxiosRequestConfig & { _retried?: boolean })
      | undefined;
    if (
      err.response?.status === 401 &&
      original &&
      !original._retried &&
      !original.url?.endsWith('/auth/refresh') &&
      !original.url?.endsWith('/auth/login')
    ) {
      original._retried = true;
      if (!refreshing) refreshing = refreshTokens();
      const newAccess = await refreshing.finally(() => {
        refreshing = null;
      });
      if (newAccess) {
        if (!original.headers) {
          original.headers = new AxiosHeaders();
        }
        (original.headers as AxiosHeaders).set(
          'Authorization',
          `Bearer ${newAccess}`,
        );
        return api.request(original);
      }
      // refresh 也失败，清登录态
      await deleteSecure(ACCESS_TOKEN_KEY);
      await deleteSecure(REFRESH_TOKEN_KEY);
      onLogout?.();
    }
    throw err;
  },
);
