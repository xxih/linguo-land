import { create } from 'zustand';
import {
  ACCESS_TOKEN_KEY,
  REFRESH_TOKEN_KEY,
  setOnLogout,
} from '../lib/api';
import { authApi } from '../lib/api-endpoints';
import { readSecure, writeSecure, deleteSecure } from '../lib/secure-storage';
import { createLogger } from '../utils/logger';

const log = createLogger('auth-store');

export interface AuthUser {
  id: number;
  email: string;
}

type Phase = 'loading' | 'unauthed' | 'authed';

interface AuthState {
  phase: Phase;
  user: AuthUser | null;
  init: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  hardLogout: () => void; // 由 axios 拦截器调用，已经在那边删完 token
}

export const useAuthStore = create<AuthState>((set, get) => ({
  phase: 'loading',
  user: null,

  /** 启动时尝试读 token + 拉 profile，确认登录态是否仍有效 */
  async init() {
    setOnLogout(() => get().hardLogout());
    try {
      const access = await readSecure(ACCESS_TOKEN_KEY);
      if (!access) {
        set({ phase: 'unauthed', user: null });
        return;
      }
      const me = await authApi.profile();
      set({ phase: 'authed', user: { id: me.id, email: me.email } });
    } catch (err) {
      log.warn('init failed, drop tokens', err);
      await deleteSecure(ACCESS_TOKEN_KEY);
      await deleteSecure(REFRESH_TOKEN_KEY);
      set({ phase: 'unauthed', user: null });
    }
  },

  async login(email, password) {
    const res = await authApi.login(email, password);
    await writeSecure(ACCESS_TOKEN_KEY, res.access_token);
    await writeSecure(REFRESH_TOKEN_KEY, res.refresh_token);
    set({
      phase: 'authed',
      user: { id: res.user.id, email: res.user.email },
    });
  },

  async register(email, password) {
    await authApi.register(email, password);
    // 注册完不自动登录——一致地走登录页，让用户完成一次密码确认。
    // （也避免密码错误时还要回滚状态）
  },

  async logout() {
    await deleteSecure(ACCESS_TOKEN_KEY);
    await deleteSecure(REFRESH_TOKEN_KEY);
    set({ phase: 'unauthed', user: null });
  },

  hardLogout() {
    set({ phase: 'unauthed', user: null });
  },
}));
