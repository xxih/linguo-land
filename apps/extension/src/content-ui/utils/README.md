# Content UI 统一配置管理

## 概述

为了解决 content-ui 中 `chrome.storage` 调用分散、难以维护，以及开发环境无法使用 chrome API 的问题，我们创建了统一的配置管理系统。

## 架构

```
┌─────────────────────────────────────────────────┐
│              UISettingsManager                   │
│         (单例，统一管理所有UI配置)                │
└─────────────────┬───────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────┐
│              StorageAdapter                      │
│    (抽象层，支持 chrome.storage 和开发环境mock)   │
└─────────────────┬───────────────────────────────┘
                  │
        ┌─────────┴─────────┐
        ▼                   ▼
  chrome.storage      开发环境 Mock
```

## 核心组件

### 1. StorageAdapter

**位置**: `storageAdapter.ts`

**功能**:
- 统一 `chrome.storage.sync` 和 `chrome.storage.local` 访问
- 自动检测开发环境，使用 mock 数据
- 提供 Promise 风格的 API

**使用示例**:

```typescript
import { StorageAdapter } from './utils/storageAdapter';

// 读取配置
const settings = await StorageAdapter.getSync<{ aiMode: string }>(['aiMode']);
console.log(settings.aiMode); // 'auto' | 'manual' | 'off'

// 写入配置
await StorageAdapter.setSync({ aiMode: 'manual' });

// 读取本地存储
const localData = await StorageAdapter.getLocal(['studySessionActive']);

// 监听变化
StorageAdapter.onChanged((changes, areaName) => {
  console.log('Storage changed:', changes, areaName);
});
```

**开发环境设置**:

```typescript
// 在开发环境中设置 mock 数据
StorageAdapter.updateMockData({
  sync: {
    aiMode: 'auto',
    showFamiliarityInCard: true,
  },
  local: {
    studySessionActive: false,
  },
});
```

### 2. UISettingsManager

**位置**: `uiSettingsManager.ts`

**功能**:
- 单例模式，全局唯一实例
- 管理所有 UI 相关配置
- 内存缓存，同步读取
- 自动监听配置变化并更新缓存
- 提供便捷的访问方法

**管理的配置**:

```typescript
interface UISettings {
  aiMode: 'auto' | 'manual' | 'off';          // AI 模式
  showFamiliarityInCard: boolean;              // 是否显示熟练度
  enhancedPhraseDetection: boolean;            // 是否启用增强词组检测
  studySessionActive: boolean;                 // 是否在学习会话中
}
```

**使用示例**:

```typescript
import { UISettingsManager } from './utils/uiSettingsManager';

// 获取单例实例
const uiSettingsManager = UISettingsManager.getInstance();

// 初始化（只需在应用启动时调用一次）
await uiSettingsManager.initialize();

// 同步读取配置（零延迟）
const aiMode = uiSettingsManager.getAiMode();
const showFamiliarity = uiSettingsManager.shouldShowFamiliarity();
const isEnhanced = uiSettingsManager.isEnhancedPhraseDetectionEnabled();

// 设置配置
await uiSettingsManager.setAiMode('manual');
await uiSettingsManager.setShowFamiliarity(false);

// 监听配置变化
const unsubscribe = uiSettingsManager.onSettingsChange((changedSettings, allSettings) => {
  if (changedSettings.aiMode !== undefined) {
    console.log('AI mode changed to:', changedSettings.aiMode);
  }
});

// 取消监听
unsubscribe();
```

## 迁移指南

### 旧代码

```typescript
// ❌ 旧的方式：每次都异步读取
const result = await chrome.storage.sync.get(['aiMode']);
const aiMode = result.aiMode || 'auto';

// ❌ 旧的方式：直接使用 chrome.storage
chrome.storage.sync.get(['showFamiliarityInCard'], (result) => {
  setShowFamiliarity(result.showFamiliarityInCard);
});
```

### 新代码

```typescript
// ✅ 新的方式：从配置管理器同步读取
const uiSettingsManager = UISettingsManager.getInstance();
const aiMode = uiSettingsManager.getAiMode();
const showFamiliarity = uiSettingsManager.shouldShowFamiliarity();

// ✅ 新的方式：监听配置变化
uiSettingsManager.onSettingsChange((changedSettings) => {
  if (changedSettings.showFamiliarityInCard !== undefined) {
    setShowFamiliarity(changedSettings.showFamiliarityInCard);
  }
});
```

## 优势

### ✅ **统一管理**
- 所有配置在一个地方管理
- 避免重复代码
- 易于维护和扩展

### ✅ **性能优化**
- 内存缓存，同步读取
- 避免重复的异步操作
- 零延迟访问配置

### ✅ **开发体验**
- 支持开发环境 mock
- 不依赖 chrome API
- 便于单元测试

### ✅ **类型安全**
- TypeScript 全类型支持
- 智能提示
- 编译时检查

## 在不同环境中的行为

### 生产环境（Chrome 扩展）
```typescript
// 自动使用 chrome.storage API
const settings = await StorageAdapter.getSync(['aiMode']);
// 调用 chrome.storage.sync.get()
```

### 开发环境（本地开发）
```typescript
// 自动使用 mock 数据
const settings = await StorageAdapter.getSync(['aiMode']);
// 返回 DEV_MOCK_DATA.sync.aiMode
```

## 最佳实践

1. **应用启动时初始化**
   ```typescript
   // 在 main.tsx 中
   const uiSettingsManager = UISettingsManager.getInstance();
   await uiSettingsManager.initialize();
   ```

2. **同步读取配置**
   ```typescript
   // 在组件中直接获取
   const aiMode = uiSettingsManager.getAiMode();
   ```

3. **监听配置变化**
   ```typescript
   // 在 useEffect 中监听
   useEffect(() => {
     const unsubscribe = uiSettingsManager.onSettingsChange((changed) => {
       // 响应变化
     });
     return unsubscribe;
   }, []);
   ```

4. **开发环境测试**
   ```typescript
   // 在 main.dev.tsx 中
   StorageAdapter.updateMockData({
     sync: { aiMode: 'manual' },
   });
   ```

## 文件结构

```
content-ui/
├── utils/
│   ├── storageAdapter.ts          # Storage 抽象层
│   ├── uiSettingsManager.ts       # UI 配置管理器
│   ├── index.ts                   # 统一导出
│   └── README.md                  # 本文档
├── main.tsx                       # 生产环境入口
└── main.dev.tsx                   # 开发环境入口
```

## 相关文件

- `content/utils/settingsManager.ts` - Content Script 的配置管理器
- `content/content.ts` - Content Script 主文件
- `content-ui/main.tsx` - UI 入口文件
- `content-ui/WordCard.tsx` - 单词卡片组件
- `content-ui/hooks/useWordCard.ts` - 单词卡片 Hook

