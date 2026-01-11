import { useState, useEffect } from 'react';
import { LoginPage } from './LoginPage';
import { isAuthenticated, getCurrentUser } from '../background/api/authApi';
import { fetchJsonWithAuth } from '../background/api/fetchWithAuth';
import { getApiBaseUrl } from '../background/api/apiConfig';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { AlertTriangle, Settings } from 'lucide-react';
import { Logger } from '../utils/logger';
import { Spinner } from '@/components/ui/spinner';

const logger = new Logger('Popup');

export default function Popup() {
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);
  const [currentUser, setCurrentUser] = useState<{
    id: number;
    email: string;
  } | null>(null);
  const [serverStatus, setServerStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  // 高亮开关状态
  const [highlightEnabled, setHighlightEnabled] = useState<boolean>(true);
  // 全局功能开关状态
  const [extensionEnabled, setExtensionEnabled] = useState<boolean>(true);
  const [highlightEnabledLoading, setHighlightEnabledLoading] = useState<boolean>(false);
  const [extensionEnabledLoading, setExtensionEnabledLoading] = useState<boolean>(false);

  useEffect(() => {
    // 检查登录状态
    checkLoginStatus();
    // 加载高亮开关状态和全局开关状态
    loadHighlightSettings();
    loadExtensionSettings();
  }, []);

  useEffect(() => {
    // 检查服务器状态
    if (isLoggedIn) {
      checkServerStatus();
    }
  }, [isLoggedIn]);

  const checkLoginStatus = async () => {
    const loggedIn = await isAuthenticated();
    setIsLoggedIn(loggedIn);
    if (loggedIn) {
      const user = await getCurrentUser();
      setCurrentUser(user);
    }
  };

  const handleLoginSuccess = async () => {
    await checkLoginStatus();
  };

  const checkServerStatus = async () => {
    try {
      const baseUrl = await getApiBaseUrl();
      await fetchJsonWithAuth(`${baseUrl}/vocabulary/health`);
      setServerStatus('online');
    } catch {
      setServerStatus('offline');
    }
  };

  // 新增：加载高亮设置
  const loadHighlightSettings = async () => {
    try {
      const result = await chrome.storage.sync.get(['highlightEnabled']);
      const enabled = typeof result.highlightEnabled === 'boolean' ? result.highlightEnabled : true; // 默认启用
      setHighlightEnabled(enabled);
    } catch (error) {
      logger.error('Failed to load highlight settings', error as Error);
    }
  };

  // 新增：切换高亮开关
  const toggleHighlight = async (enabled: boolean) => {
    try {
      await chrome.storage.sync.set({ highlightEnabled: enabled });
      setHighlightEnabled(enabled);
    } catch (error) {
      logger.error('Failed to save highlight settings', error as Error);
    }
  };

  // 新增：加载全局开关设置
  const loadExtensionSettings = async () => {
    try {
      const result = await chrome.storage.sync.get(['extensionEnabled']);
      const enabled = typeof result.extensionEnabled === 'boolean' ? result.extensionEnabled : true; // 默认启用
      setExtensionEnabled(enabled);
    } catch (error) {
      logger.error('Failed to load extension settings', error as Error);
    }
  };

  // 切换全局开关
  const toggleExtension = async (enabled: boolean) => {
    try {
      await chrome.storage.sync.set({ extensionEnabled: enabled });
      setExtensionEnabled(enabled);
    } catch (error) {
      logger.error('Failed to save extension settings', error as Error);
    }
  };

  // 如果还在检查登录状态，显示加载
  if (isLoggedIn === null) {
    return (
      <div className="w-96 p-4 bg-white flex items-center justify-center">
        <div className="text-gray-600">加载中...</div>
      </div>
    );
  }

  // 如果未登录，显示登录页面
  if (!isLoggedIn) {
    return <LoginPage onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div className="w-96 p-6 pt-5 bg-bg-base rounded">
      {/* 顶部标题栏 */}
      <div className="flex items-start">
        {/* logo.png */}
        <img src="/logo.png" alt="LinguoLand Logo" className="h-8 w-8 mr-3 mt-1" />
        <div className="mb-4">
          <h1 className="text-xl font-bold text-gray-800">LinguoLand</h1>
          {currentUser && <p className="text-xs text-gray-500">{currentUser.email}</p>}
        </div>

        <div className="ml-auto flex">
          {extensionEnabledLoading && highlightEnabledLoading && <Spinner className="mr-2" />}
          <Settings
            className="mt-2 h-5 w-5 cursor-pointer text-gray-500 hover:text-gray-600 transition-colors active:scale-95"
            onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL('options.html') })}
          />
        </div>
      </div>

      {serverStatus === 'offline' && (
        <div className="text-sm text-red-600 bg-red-50 p-3 rounded mb-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-5 w-5 flex-shrink-0" />
            <div>
              无法连接到后端服务器
              <br />
              请确保运行：<code className="bg-gray-100 px-1">pnpm dev</code>
            </div>
          </div>
        </div>
      )}

      {
        <div className="space-y-3">
          {/* 功能开关 - 紧凑布局 */}
          {/* <div className="bg-gray-50 p-3 rounded space-y-2"> */}
          <div className="flex items-center justify-between">
            <Label
              htmlFor="extension-switch"
              className="text-sm text-gray-700 flex items-center gap-1.5"
            >
              {/* <Zap className="h-3.5 w-3.5" /> */}
              插件总开关
            </Label>
            <Switch
              id="extension-switch"
              checked={extensionEnabled}
              onCheckedChange={toggleExtension}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label
              htmlFor="highlight-switch"
              className="text-sm text-gray-700 flex items-center gap-1.5"
            >
              {/* <Palette className="h-3.5 w-3.5" /> */}
              高亮功能
            </Label>
            <Switch
              id="highlight-switch"
              checked={highlightEnabled}
              onCheckedChange={toggleHighlight}
              disabled={!extensionEnabled}
            />
          </div>
          {/* </div> */}

          {/* 操作按钮 */}
          {/* <button
            onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL('options.html') })}
            className="w-full bg-blue-500 hover:bg-blue-600 text-white px-4 py-2.5 rounded text-sm font-medium transition-colors"
          >
            打开设置与管理
          </button> */}

          {/* 高亮说明 */}
          <div className="text-xs text-gray-500 pt-2 border-t space-y-1.5">
            <div className="font-medium text-gray-700">高亮说明：</div>
            <div className="flex flex-row gap-1">
              <span className="flex items-center gap-1.5">
                <div className="h-2.5 w-2.5 bg-red-400/70"></div>
                红色背景 = 陌生词
              </span>
              <span className="flex items-center gap-1.5">
                <div className="ml-2 h-2.5 w-2.5 bg-blue-400/70"></div>
                蓝色背景 = 学习中
              </span>
            </div>
            <div className="mt-0.5">按住 Alt/Option 键并单击单词可查看释义</div>
          </div>
        </div>
      }
    </div>
  );
}
