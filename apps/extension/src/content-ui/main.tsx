import React from 'react';
import ReactDOM from 'react-dom/client';
import WordCard from './WordCard';
import TranslationCard from './TranslationCard';
import ToastNotification from './ToastNotification';
import { ShadowDomProvider } from '@/lib/shadow-dom-context';
import { UISettingsManager } from './utils/uiSettingsManager';
import { Logger } from '../utils/logger';
import { ErrorBoundary } from '../lib/ErrorBoundary';

const logger = new Logger('ContentUIMain');

logger.debug('Content UI script loaded');

const uiSettingsManager = UISettingsManager.getInstance();
uiSettingsManager.initialize().catch((error) => {
  logger.error('Failed to initialize UISettingsManager', error as Error);
});

function injectShadowStylesheet(shadowRoot: ShadowRoot): void {
  const cssUrl = chrome.runtime.getURL('assets/tailwind-styles.css');
  const linkEl = document.createElement('link');
  linkEl.rel = 'stylesheet';
  linkEl.href = cssUrl;
  shadowRoot.appendChild(linkEl);

  const baseStyle = document.createElement('style');
  baseStyle.textContent = '* { box-sizing: border-box; }';
  shadowRoot.appendChild(baseStyle);
}

document.addEventListener('lang-helper-show-card', (e: Event) => {
  const customEvent = e as CustomEvent;
  const { word, lemmas, familyRoot, details, shadowRoot, context, status, familiarityLevel } =
    customEvent.detail;

  const reactRoot = shadowRoot.querySelector('#word-card-react-root');
  if (!reactRoot) {
    logger.error('React root not found in shadow DOM', new Error('React root not found'));
    return;
  }

  injectShadowStylesheet(shadowRoot);

  const aiMode = uiSettingsManager.getAiMode();

  const root = ReactDOM.createRoot(reactRoot);
  root.render(
    <React.StrictMode>
      <ErrorBoundary scope="ContentUI:WordCard">
        <ShadowDomProvider shadowRoot={shadowRoot}>
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
        </ShadowDomProvider>
      </ErrorBoundary>
    </React.StrictMode>,
  );
});

document.addEventListener('lang-helper-show-translation', (e: Event) => {
  const customEvent = e as CustomEvent;
  const { paragraph, sentence, translation, sentenceAnalysis, shadowRoot, isStreaming } =
    customEvent.detail;

  const reactRoot = shadowRoot.querySelector('#word-card-react-root');
  if (!reactRoot) {
    logger.error('React root not found in shadow DOM', new Error('React root not found'));
    return;
  }

  injectShadowStylesheet(shadowRoot);

  const root = ReactDOM.createRoot(reactRoot);
  root.render(
    <React.StrictMode>
      <ErrorBoundary scope="ContentUI:TranslationCard">
        <ShadowDomProvider shadowRoot={shadowRoot}>
          <TranslationCard
            paragraph={paragraph}
            sentence={sentence}
            translation={translation}
            sentenceAnalysis={sentenceAnalysis}
            isStreaming={isStreaming}
          />
        </ShadowDomProvider>
      </ErrorBoundary>
    </React.StrictMode>,
  );
});

document.addEventListener('lang-helper-show-toast', (e: Event) => {
  const customEvent = e as CustomEvent;
  const { message, words, type } = customEvent.detail;

  // Toast container lives in the host page's light DOM (outside any shadow root where Tailwind is loaded);
  // inline cssText is the only reliable styling here.
  const toastContainer = document.createElement('div');
  toastContainer.id = 'lang-helper-toast-container';
  toastContainer.style.cssText =
    'position:fixed;top:0;right:0;z-index:49;pointer-events:none;';
  document.body.appendChild(toastContainer);

  const shadowRoot = toastContainer.attachShadow({ mode: 'open' });
  const reactRoot = document.createElement('div');
  shadowRoot.appendChild(reactRoot);

  injectShadowStylesheet(shadowRoot);

  const root = ReactDOM.createRoot(reactRoot);
  root.render(
    <React.StrictMode>
      <ErrorBoundary scope="ContentUI:Toast">
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
      </ErrorBoundary>
    </React.StrictMode>,
  );
});

logger.debug('Content UI script setup complete');
