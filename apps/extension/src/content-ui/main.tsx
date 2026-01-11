import React from 'react';
import ReactDOM from 'react-dom/client';
import WordCard from './WordCard';
import TranslationCard from './TranslationCard';
import ToastNotification from './ToastNotification';
import { ShadowDomProvider } from '@/lib/shadow-dom-context';
import { UISettingsManager } from './utils/uiSettingsManager';
import { Logger } from '../utils/logger';

const logger = new Logger('ContentUIMain');

// import './index.css';

logger.debug('Content UI script loaded');

// 初始化 UI 设置管理器
const uiSettingsManager = UISettingsManager.getInstance();
uiSettingsManager.initialize().catch((error) => {
  logger.error('Failed to initialize UISettingsManager', error as Error);
});

// 创建 MUI 主题
// const theme = createTheme({
//   palette: {
//     mode: 'light',
//     primary: {
//       main: '#3b82f6',
//     },
//     secondary: {
//       main: '#8b5cf6',
//     },
//     success: {
//       main: '#10b981',
//     },
//     warning: {
//       main: '#f59e0b',
//     },
//     error: {
//       main: '#ef4444',
//     },
//   },
//   typography: {
//     fontFamily:
//       '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
//   },
//   shape: {
//     borderRadius: 8,
//   },
// });

// 监听来自 content.ts 的自定义事件
document.addEventListener('lang-helper-show-card', async (e: Event) => {
  const customEvent = e as CustomEvent;
  const { word, lemmas, familyRoot, details, shadowRoot, context, status, familiarityLevel } =
    customEvent.detail;

  // 获取 React 挂载点
  const reactRoot = shadowRoot.querySelector('#word-card-react-root');
  if (!reactRoot) {
    logger.error('React root not found in shadow DOM', new Error('React root not found'));
    return;
  }

  // --- 新增代码：注入 Tailwind CSS ---
  const cssUrl = chrome.runtime.getURL('assets/tailwind-styles.css');
  const linkEl = document.createElement('link');
  linkEl.rel = 'stylesheet';
  linkEl.href = cssUrl;
  shadowRoot.appendChild(linkEl);
  // ------------------------------------

  // 从统一配置管理器中获取 AI 模式
  const aiMode = uiSettingsManager.getAiMode();

  // 创建 emotion cache，将样式注入到 Shadow DOM
  // const emotionCache = createCache({
  //   key: 'word-card-mui',
  //   container: shadowRoot as unknown as HTMLElement,
  //   prepend: true,
  // });

  // 添加基础样式到 Shadow DOM
  const style = document.createElement('style');
  style.textContent = `
    * {
      box-sizing: border-box;
    }
  `;
  shadowRoot.appendChild(style);

  // 创建 React root 并渲染组件
  const root = ReactDOM.createRoot(reactRoot);
  root.render(
    <React.StrictMode>
      <ShadowDomProvider shadowRoot={shadowRoot}>
        {/* <CacheProvider value={emotionCache}> */}
        {/* <ThemeProvider theme={theme}> */}
        {/* <CssBaseline /> */}
        <WordCard
          word={word}
          lemmas={lemmas}
          familyRoot={familyRoot}
          details={details}
          context={context}
          status={status}
          familiarityLevel={familiarityLevel}
          aiMode={aiMode}
        />
        {/* </ThemeProvider> */}
        {/* </CacheProvider> */}
      </ShadowDomProvider>
    </React.StrictMode>,
  );
});

// 监听来自 content.ts 的翻译事件
document.addEventListener('lang-helper-show-translation', (e: Event) => {
  const customEvent = e as CustomEvent;
  const { paragraph, sentence, translation, sentenceAnalysis, shadowRoot, isStreaming } =
    customEvent.detail;

  // 获取 React 挂载点
  const reactRoot = shadowRoot.querySelector('#word-card-react-root');
  if (!reactRoot) {
    logger.error('React root not found in shadow DOM', new Error('React root not found'));
    return;
  }

  // 注入 Tailwind CSS
  const cssUrl = chrome.runtime.getURL('assets/tailwind-styles.css');
  const linkEl = document.createElement('link');
  linkEl.rel = 'stylesheet';
  linkEl.href = cssUrl;
  shadowRoot.appendChild(linkEl);

  // 添加基础样式到 Shadow DOM
  const style = document.createElement('style');
  style.textContent = `
		* {
			box-sizing: border-box;
		}
	`;
  shadowRoot.appendChild(style);

  // 创建 React root 并渲染翻译组件
  const root = ReactDOM.createRoot(reactRoot);
  root.render(
    <React.StrictMode>
      <ShadowDomProvider shadowRoot={shadowRoot}>
        <TranslationCard
          paragraph={paragraph}
          sentence={sentence}
          translation={translation}
          sentenceAnalysis={sentenceAnalysis}
          isStreaming={isStreaming}
        />
      </ShadowDomProvider>
    </React.StrictMode>,
  );
});

// 监听来自 content.ts 的 Toast 通知事件
document.addEventListener('lang-helper-show-toast', (e: Event) => {
  const customEvent = e as CustomEvent;
  const { message, words, type } = customEvent.detail;

  // 创建 Toast 容器
  const toastContainer = document.createElement('div');
  toastContainer.id = 'lang-helper-toast-container';
  toastContainer.style.cssText = `
		position: fixed;
		top: 0;
		right: 0;
		z-index: 49;
		pointer-events: none;
	`;
  document.body.appendChild(toastContainer);

  // 创建 Shadow DOM
  const shadowRoot = toastContainer.attachShadow({ mode: 'open' });

  // 创建 React 挂载点
  const reactRoot = document.createElement('div');
  shadowRoot.appendChild(reactRoot);

  // 添加基础样式
  const style = document.createElement('style');
  style.textContent = `
		* {
			box-sizing: border-box;
		}
	`;
  shadowRoot.appendChild(style);

  // 渲染 Toast 组件
  const root = ReactDOM.createRoot(reactRoot);
  root.render(
    <React.StrictMode>
      <ShadowDomProvider shadowRoot={shadowRoot}>
        <ToastNotification
          message={message}
          words={words}
          type={type}
          onClose={() => {
            root.unmount();
            toastContainer.remove();
          }}
        />
      </ShadowDomProvider>
    </React.StrictMode>,
  );
});

logger.debug('Content UI script setup complete');
