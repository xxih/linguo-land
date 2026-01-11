// apps/extension/src/content-ui/main.dev.tsx

import React from 'react';
import ReactDOM from 'react-dom/client';
import WordCard from './WordCard';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import '../index.css';
import type { AIEnrichmentData, WordDetails } from 'shared-types';
import { UISettingsManager } from './utils/uiSettingsManager';
import { StorageAdapter } from './utils/storageAdapter';
import { Logger } from '../utils/logger';

const logger = new Logger('ContentUIMainDev');

// 在开发环境中设置 mock 数据
StorageAdapter.updateMockData({
  sync: {
    aiMode: 'auto',
    showFamiliarityInCard: true,
    enhancedPhraseDetection: false,
    extensionEnabled: true,
    highlightEnabled: true,
  },
  local: {
    studySessionActive: false,
    studySessionLogs: [],
  },
});

// 初始化 UI 设置管理器
const uiSettingsManager = UISettingsManager.getInstance();
uiSettingsManager.initialize().then(() => {
  logger.debug('[Dev] UISettingsManager initialized with mock data');
});

// 模拟 WordCard 需要的 props 数据
const mockDetails: WordDetails = {
  word: 'development',
  phonetics: ['/dɪˈvɛləpmənt/'],
  entries: [
    {
      pos: 'noun',
      senses: [
        {
          glosses: ['The process of developing or being developed.'],
          examples: ['The development of new technology is rapid.'],
        },
      ],
    },
  ],
  audio: ['/dɪˈvɛləpmənt/'],
  forms: ['develop', 'development'],
  id: 1,
  tags: [
    {
      id: 1,
      key: 'cet4',
      name: '四级',
      description: '大学英语四级核心词汇',
    },
    {
      id: 2,
      key: 'cet6',
      name: '六级',
      description: '大学英语六级核心词汇',
    },
  ],
};

const mockLemmas = ['develop', 'development'];

const mockAiData: AIEnrichmentData = {
  contextualDefinitions: ['This is a known issue.'],
  exampleSentence: 'This is a known issue.',
  synonym: 'This is a known issue.',
};

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#3b82f6' },
    secondary: { main: '#8b5cf6' },
    success: { main: '#10b981' },
    warning: { main: '#f59e0b' },
    error: { main: '#ef4444' },
  },
  // ... 其他主题配置
});

// 获取根元素
const rootElement = document.getElementById('root-dev');

if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {/* 为了方便查看，给卡片一个容器和背景 */}
        <div
          style={{
            backgroundColor: '#f0f2f5',
            padding: '50px',
            minHeight: '100vh',
          }}
        >
          <h2 style={{ fontFamily: 'sans-serif', color: '#333' }}>WordCard: 陌生 (unknown)</h2>
          <div style={{ position: 'relative', width: '320px', margin: '20px' }}>
            <WordCard
              word="development"
              lemmas={mockLemmas}
              familyRoot="develop"
              details={mockDetails}
              context="The project is in the early stages of development."
              status="unknown"
              aiMode="auto"
            />
          </div>

          <h2 style={{ fontFamily: 'sans-serif', color: '#333' }}>WordCard: 学习中 (learning)</h2>
          <div style={{ position: 'relative', width: '320px', margin: '20px' }}>
            <WordCard
              word="learning"
              lemmas={['learn']}
              familyRoot="learn"
              details={{ ...mockDetails, word: 'learning' }}
              context="Continuous learning is key to success."
              status="learning"
              aiMode="auto"
            />
          </div>

          <h2 style={{ fontFamily: 'sans-serif', color: '#333' }}>WordCard: 已掌握 (known)</h2>
          <div style={{ position: 'relative', width: '320px', margin: '20px' }}>
            <WordCard
              word="known"
              lemmas={['know']}
              familyRoot="know"
              details={{ ...mockDetails, word: 'known' }}
              context="This is a known issue."
              status="known"
              aiMode="off"
              mockAiData={mockAiData}
            />
          </div>
        </div>
      </ThemeProvider>
    </React.StrictMode>,
  );
} else {
  logger.error("Development root element '#root-dev' not found.", new Error('Root element not found'));
}
