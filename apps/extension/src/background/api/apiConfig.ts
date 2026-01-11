/**
 * API 配置管理
 * 管理后端 API 的基础地址配置
 */

// 根据环境变量设置默认 API 基础地址
const DEFAULT_API_BASE_URL =
  import.meta.env.MODE === 'development'
    ? 'http://localhost:3000/api/v1'
    : 'https://api.linguoland.com/api/v1';

/**
 * 获取 API 基础地址
 */
export async function getApiBaseUrl(): Promise<string> {
  return DEFAULT_API_BASE_URL;
}
