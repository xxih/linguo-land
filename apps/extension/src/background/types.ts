// Background script 专用类型定义
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface WordUpdateRequest {
  status: string;
  familiarityLevel?: number;
  userId?: string; // 可选，通常从 JWT 令牌中获取
}

export interface ApiConfig {
  baseUrl: string;
  timeout: number;
}

export type ApiRequestHandler<TRequest = any, TResponse = any> = (
  request: TRequest,
) => Promise<TResponse>;
