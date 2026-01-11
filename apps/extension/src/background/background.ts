import type { ChromeMessage } from 'shared-types';
import { MessageHandlers } from './messageHandlers';
import { Logger } from '../utils/logger';

const logger = new Logger('BackgroundScript');

logger.info('Background script loaded', { version: 'v3' });

// 初始化消息处理器
const messageHandlers = new MessageHandlers();

chrome.runtime.onInstalled.addListener(() => {
  logger.info('Extension installed', { version: 'v3' });

  // 执行安装后的初始化
  initializeExtension();

  // 创建右键菜单
  createContextMenus();
});

/**
 * 初始化扩展
 */
async function initializeExtension(): Promise<void> {
  logger.info('Initializing extension');

  try {
    // 执行健康检查
    const healthCheck = await messageHandlers.performHealthCheck();
    logger.info('Health check result', healthCheck);

    if (!healthCheck.overall) {
      logger.warn('Some services are unavailable, extension functionality may be limited');
    }

    logger.info('Extension initialization completed');
  } catch (error) {
    logger.error('Extension initialization failed', error as Error);
  }
}

/**
 * 创建右键菜单
 */
function createContextMenus(): void {
  logger.info('Creating context menus');

  try {
    // 创建父级菜单
    chrome.contextMenus.create({
      id: 'lang-land-parent',
      title: 'LinguoLand',
      contexts: ['selection'], // 只在有选中文本时显示
    });

    // 子菜单：批量忽略
    chrome.contextMenus.create({
      id: 'batch-ignore',
      parentId: 'lang-land-parent',
      title: '批量忽略选中区域的高亮单词',
      contexts: ['selection'],
    });

    // 子菜单：批量设为已掌握
    chrome.contextMenus.create({
      id: 'batch-known',
      parentId: 'lang-land-parent',
      title: '批量将选中区域的单词设为"已掌握"',
      contexts: ['selection'],
    });

    logger.info('Context menus created successfully');
  } catch (error) {
    logger.error('Failed to create context menus', error as Error);
  }
}

// 监听右键菜单点击事件
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) {
    logger.warn('Context menu clicked but no tab ID available');
    return;
  }

  logger.info('Context menu item clicked', {
    menuItemId: info.menuItemId,
    tabId: tab.id,
  });

  // 根据点击的菜单项ID，向对应的 content script 发送消息
  if (info.menuItemId === 'batch-ignore') {
    chrome.tabs
      .sendMessage(tab.id, {
        type: 'BATCH_IGNORE_IN_SELECTION',
      })
      .catch((err) => logger.warn('Failed to send BATCH_IGNORE message', err));
  } else if (info.menuItemId === 'batch-known') {
    chrome.tabs
      .sendMessage(tab.id, {
        type: 'BATCH_KNOW_IN_SELECTION',
      })
      .catch((err) => logger.warn('Failed to send BATCH_KNOW message', err));
  }
});

// 消息监听器 - 使用统一的消息路由器
chrome.runtime.onMessage.addListener((message: ChromeMessage, sender, sendResponse) => {
  // 使用消息处理器路由消息
  return messageHandlers.routeMessage(message, sender, sendResponse);
});

// 监听扩展启动事件
chrome.runtime.onStartup.addListener(() => {
  logger.info('Extension startup');
});

// 监听标签页更新事件（可选，用于未来功能）
chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    logger.debug('Tab loading completed', { url: tab.url });
  }
});

logger.info('Background script setup complete');

(globalThis as any).setYoudao = async () => {
  logger.debug('Switching to Youdao dictionary');
  await messageHandlers.setDictionaryProviderSetting('Youdao');
};

(globalThis as any).setFreeDictionary = async () => {
  logger.debug('Switching to FreeDictionary');
  await messageHandlers.setDictionaryProviderSetting('FreeDictionaryAPI');
};

(globalThis as any).getCurrentSetting = async () => {
  try {
    const result = await chrome.storage?.sync.get('dictionaryProvider');
    logger.info('Current dictionary setting', {
      provider: result.dictionaryProvider || 'FreeDictionaryAPI (default)',
    });
  } catch (error) {
    logger.error('Failed to get setting', error as Error);
  }
};

(globalThis as any).showTestHelp = () => {
  logger.info(`
🧪 有道词典测试命令:

基本测试:
- testYoudao("word")        // 测试有道词典
- testFreeDictionary("word") // 测试FreeDictionary
- testAllDictionaries("word") // 测试所有词典

设置切换:
- setYoudao()              // 设置为有道词典
- setFreeDictionary()      // 设置为FreeDictionary
- getCurrentSetting()      // 查看当前设置

使用例子:
1. setYoudao()             // 设置使用有道词典
2. testYoudao("hello")     // 测试查询单词"hello"
3. 在网页中选择英文单词，查看效果

注意：设置更改后，下次查询单词时会生效
	`);
};

// 自动显示帮助信息
logger.info('Dictionary test commands loaded! Enter showTestHelp() to see help');
logger.info('Now using Youdao dictionary by default! Select words on webpage to experience');
logger.info('Run testAllDictionaries() to test all dictionaries');
