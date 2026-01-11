import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type {
  WordDetails,
  AIEnrichmentData,
  ChromeMessage,
  ChromeMessageResponse,
  WordFamiliarityStatus,
} from 'shared-types';
import { WordCardHeader } from './components/WordCardHeader';
import { WordDefinitions } from './components/WordDefinitions';
import { WordCardActions } from './components/WordCardActions';
import TagDisplayComponent from './components/TagDisplayComponent';
import { WordCardStyles } from './styles/wordCardStyles';
import { useWordCard } from './hooks/useWordCard';
import { Slider } from '@/components/ui/slider';
import { Sparkles } from 'lucide-react';
import { Logger } from '../utils/logger';

const logger = new Logger('WordCard');

interface WordCardProps {
  word: string;
  lemmas: string[]; // 词元列表
  familyRoot?: string; // 词族根
  details: WordDetails;
  context?: string; // 上下文句子
  status?: WordFamiliarityStatus | 'ignored'; // 当前状态
  familiarityLevel?: number; // 熟练度 0-7
  aiMode?: 'auto' | 'manual' | 'off'; // AI 解析模式
  mockAiData?: AIEnrichmentData;
}

/**
 * WordCard 组件 - 重构版本
 * 显示单词详细信息和提供状态更新操作
 */
const WordCard: React.FC<WordCardProps> = ({
  word,
  lemmas,
  // familyRoot,
  details,
  context,
  status,
  familiarityLevel = 0,
  aiMode = 'auto', // 默认自动模式
  mockAiData,
}) => {
  const { handleClose, handleUpdateStatus, handleIgnoreWord, createHoverHandlers } = useWordCard();

  const [aiData, setAiData] = useState<AIEnrichmentData | null>(null);
  const [isLoadingAi, setIsLoadingAi] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [showFamiliarity, setShowFamiliarity] = useState(true);
  const [currentFamiliarity, setCurrentFamiliarity] = useState(familiarityLevel);
  const [enhancedPhraseDetection, setEnhancedPhraseDetection] = useState(false);
  const [streamingContent, setStreamingContent] = useState<string>('');
  const [isStreaming, setIsStreaming] = useState(false);

  logger.debug('enhancedPhraseDetection: ' + enhancedPhraseDetection);
  const closeButtonHoverHandlers = {
    onMouseEnter: (e: React.MouseEvent<HTMLButtonElement>) => {
      const el = e.currentTarget as HTMLElement;
      el.classList.add('bg-danger');
      el.classList.add('text-white');
      el.classList.add('rotate-90');
      // el.classList.add('scale-110');
    },
    onMouseLeave: (e: React.MouseEvent<HTMLButtonElement>) => {
      const el = e.currentTarget as HTMLElement;
      el.classList.remove('bg-danger');
      el.classList.remove('text-white');
      el.classList.remove('rotate-90');
      // el.classList.remove('scale-110');
    },
  };

  // AI 解析处理函数（流式）
  const handleEnrich = async () => {
    if (!context) {
      setAiError('无法获取上下文，请重试。');
      return;
    }

    setIsLoadingAi(true);
    setIsStreaming(true);
    setAiError(null);
    setStreamingContent('');

    try {
      // 从统一配置管理器获取设置
      const { UISettingsManager } = await import('./utils/uiSettingsManager');
      const uiSettingsManager = UISettingsManager.getInstance();
      const currentEnhancedPhraseDetection = uiSettingsManager.isEnhancedPhraseDetectionEnabled();

      const message: ChromeMessage = {
        type: 'ENRICH_WORD_STREAM',
        word: word,
        context: context,
        enhancedPhraseDetection: currentEnhancedPhraseDetection,
      };

      chrome.runtime.sendMessage(message, (response: ChromeMessageResponse) => {
        if (chrome.runtime.lastError) {
          setAiError('AI 解析失败：' + chrome.runtime.lastError.message);
          setIsLoadingAi(false);
          setIsStreaming(false);
          return;
        }

        if (!response?.success) {
          setAiError(response?.error || 'AI 解析失败，请稍后再试');
          setIsLoadingAi(false);
          setIsStreaming(false);
        }
      });
    } catch (error) {
      logger.error('AI 解析失败', error as Error);
      setAiError('AI 解析失败，请稍后再试');
      setIsLoadingAi(false);
      setIsStreaming(false);
    }
  };

  // 监听流式消息
  React.useEffect(() => {
    const messageListener = (message: ChromeMessage) => {
      if (message.word !== word) return;

      switch (message.type) {
        case 'ENRICH_STREAM_DATA':
          // 收到流式数据，实时更新内容
          if (message.content) {
            setStreamingContent(message.content);
            setIsLoadingAi(false); // 收到第一个数据块后，取消 loading 状态
          }
          break;

        case 'ENRICH_STREAM_COMPLETE':
          // 流式完成，解析 JSON 并设置最终数据
          setIsStreaming(false);
          setIsLoadingAi(false);
          try {
            if (message.content) {
              const result = JSON.parse(message.content);
              setAiData(result);
            }
          } catch (error) {
            logger.error('Failed to parse final content', error as Error);
            setAiError('解析结果失败');
          }
          setStreamingContent(''); // 清空流式内容
          break;

        case 'ENRICH_STREAM_ERROR':
          // 流式错误
          setIsStreaming(false);
          setIsLoadingAi(false);
          setAiError(message.error || 'AI 解析失败');
          setStreamingContent('');
          break;
      }
    };

    chrome.runtime.onMessage.addListener(messageListener);

    return () => {
      chrome.runtime.onMessage.removeListener(messageListener);
    };
  }, [word]);

  // 根据 AI 模式自动调用解析
  React.useEffect(() => {
    if (aiMode === 'auto' && context && !aiData && !isLoadingAi && !isStreaming) {
      handleEnrich();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiMode, context]);

  // 加载设置：熟练度显示和增强词组检测
  React.useEffect(() => {
    const initSettings = async () => {
      const { UISettingsManager } = await import('./utils/uiSettingsManager');
      const uiSettingsManager = UISettingsManager.getInstance();

      setShowFamiliarity(uiSettingsManager.shouldShowFamiliarity());
      setEnhancedPhraseDetection(uiSettingsManager.isEnhancedPhraseDetectionEnabled());

      // 监听配置变化
      const unsubscribe = uiSettingsManager.onSettingsChange((changedSettings) => {
        if (changedSettings.showFamiliarityInCard !== undefined) {
          setShowFamiliarity(changedSettings.showFamiliarityInCard);
        }
        if (changedSettings.enhancedPhraseDetection !== undefined) {
          setEnhancedPhraseDetection(changedSettings.enhancedPhraseDetection);
        }
      });

      return unsubscribe;
    };

    let unsubscribe: (() => void) | undefined;
    initSettings().then((unsub) => {
      unsubscribe = unsub;
    });

    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, []);

  // 监听键盘事件，关闭单词卡片
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 检查卡片是否还在 DOM 中（防止卡片已关闭但监听器未清理的情况）
      const shadowHost = document.getElementById('lang-helper-word-card-host');
      if (!shadowHost) {
        return; // 卡片已关闭，不处理任何按键
      }

      // ESC 键总是关闭卡片
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        handleClose();
        return;
      }

      // 单独按 Meta 键（Mac 的 Command）或 Control 键时关闭卡片
      // 但不拦截组合键（如 cmd+c, cmd+a）
      if (e.key === 'Meta' || e.key === 'Control') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        handleClose();
      }
    };

    // 使用捕获阶段，确保优先处理
    document.addEventListener('keydown', handleKeyDown, true);

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [handleClose]);

  // 更新熟练度
  const handleFamiliarityChange = async (newLevel: number) => {
    setCurrentFamiliarity(newLevel);

    // 只更新熟练度，不改变状态
    const message: ChromeMessage = {
      type: 'UPDATE_WORD_STATUS',
      word: lemmas[0], // 使用第一个词元
      familiarityLevel: newLevel,
    };

    chrome.runtime.sendMessage(message, (response: ChromeMessageResponse) => {
      if (chrome.runtime.lastError) {
        logger.error('更新熟练度失败', new Error(chrome.runtime.lastError.message));
      }
      if (!response?.success) {
        logger.error('更新熟练度失败: ' + response?.error, new Error(response?.error));
      }
    });
  };

  return (
    <div style={WordCardStyles.card} className="rounded-xl border-0 p-4 w-xs bg-bg-base">
      <WordCardHeader
        onIgnoreWord={handleIgnoreWord}
        onUpdateStatus={handleUpdateStatus}
        word={word}
        details={details}
        status={status}
        onClose={handleClose}
        closeButtonHoverHandlers={closeButtonHoverHandlers}
      />
      {/* 显示词元和词族信息 */}
      {/* <div
				style={{
					fontSize: "13px",
					color: "#6b7280",
					marginBottom: "8px",
					padding: "8px 12px",
					backgroundColor: "#f9fafb",
					borderRadius: "8px",
					display: "flex",
					alignItems: "center",
					gap: "8px"
				}}
			>
				<span style={{color: "#8b5cf6", fontWeight: "600"}}>📝</span>
				<span>
					<strong>词元:</strong> {lemmas.join(", ")}
				</span>
			</div> */}

      {/* 显示词族根 */}
      {/* {familyRoot && (
				<div
					style={{
						fontSize: "13px",
						marginBottom: "12px",
						padding: "8px 12px",
						background: "linear-gradient(135deg, #e0e7ff 0%, #f3e8ff 100%)",
						borderRadius: "8px",
						display: "flex",
						alignItems: "center",
						gap: "8px",
						border: "1px solid #c4b5fd"
					}}
				>
					<span style={{fontSize: "16px"}}>🌳</span>
					<span>
						<strong style={{color: "#7c3aed"}}>词族:</strong>{" "}
						<span style={{color: "#5b21b6", fontWeight: "600"}}>
							{familyRoot}
						</span>
					</span>
				</div>
			)} */}

      <WordDefinitions details={details} />
      <TagDisplayComponent tags={details.tags} />
      {details.source === 'ai' && (
        <div className="mt-1 text-font-secondary text-[10px] text-right">结果由 AI 生成</div>
      )}

      {/* 熟练度显示和调整 */}
      {showFamiliarity && status === 'learning' && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '8px',
          }}
          className="gap-1 w-full mb-2 mt-2"
        >
          <span className="w-30 bg-transparent text-font-secondary text-shadow-font-secondary px-1 py-0.5 text-xs">
            熟练度：{currentFamiliarity}/7
          </span>

          {/* 熟练度滑块 */}
          <Slider
            value={[currentFamiliarity]}
            onValueChange={([value]) => handleFamiliarityChange(value)}
            max={7}
            min={0}
            step={1}
            className="cursor-pointer"
            // className="w-full"
          />
          {/* <input
            type="range"
            min="0"
            max="7"
            value={currentFamiliarity}
            onChange={(e) => handleFamiliarityChange(Number(e.target.value))}
            style={{
              width: '100%',
              height: '4px',
              borderRadius: '2px',
              outline: 'none',
              cursor: 'pointer',
              WebkitAppearance: 'none',
              appearance: 'none',
              background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${(currentFamiliarity / 7) * 100}%, #e0e7ff ${(currentFamiliarity / 7) * 100}%, #e0e7ff 100%)`,
            }}
          /> */}
        </div>
      )}

      {/* AI 解析按钮 - 仅在 manual 模式且未加载时显示 */}
      {aiMode === 'manual' && context && !aiData && (
        <div style={{ marginTop: '12px', marginBottom: '10px' }}>
          <button
            onClick={handleEnrich}
            disabled={isLoadingAi}
            style={{
              padding: '8px 16px',
              background: isLoadingAi
                ? '#9ca3af'
                : 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
              color: 'white',
              border: 'none',
              borderRadius: '10px',
              cursor: isLoadingAi ? 'not-allowed' : 'pointer',
              fontSize: '13px',
              fontWeight: '600',
              width: '100%',
              opacity: isLoadingAi ? 0.7 : 1,
              boxShadow: isLoadingAi ? 'none' : '0 2px 8px rgba(139, 92, 246, 0.25)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
            }}
            onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => {
              if (!isLoadingAi) {
                const el = e.target as HTMLElement;
                el.style.background = 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)';
                el.style.transform = 'translateY(-1px)';
                el.style.boxShadow = '0 3px 12px rgba(139, 92, 246, 0.35)';
              }
            }}
            onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => {
              if (!isLoadingAi) {
                const el = e.target as HTMLElement;
                el.style.background = 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)';
                el.style.transform = 'translateY(0)';
                el.style.boxShadow = '0 2px 8px rgba(139, 92, 246, 0.25)';
              }
            }}
          >
            <Sparkles className="size-5" />
            <span>{isLoadingAi ? 'AI 解析中...' : 'AI 深度解析'}</span>
          </button>
        </div>
      )}

      {/* AI 加载状态 - auto 模式自动加载时显示 */}
      {aiMode === 'auto' && isLoadingAi && !aiData && !isStreaming && (
        <div className="mt-3 bg-bg-700 p-3 rounded-lg border border-bg-700">
          <div className="flex items-center gap-2 text-font-base text-sm font-semibold">
            <span>AI 解析</span>
          </div>
          <div className="text-font-base text-sm font-normal flex items-center gap-2">
            <span className="inline-block w-2 h-2 bg-primary rounded-full animate-pulse"></span>
            AI 正在解析中...
          </div>
        </div>
      )}

      {/* 流式内容显示 */}
      {isStreaming && streamingContent && (
        <div className="mt-3 bg-bg-700 p-3 rounded-lg border border-bg-700">
          <div className="flex items-center gap-2 text-font-base text-sm font-semibold mb-2">
            <span>AI 解析</span>
            <span className="inline-block w-2 h-2 bg-primary rounded-full animate-pulse"></span>
          </div>
          <div className="text-font-base text-sm font-normal">{streamingContent}</div>
        </div>
      )}

      {/* 最终结果显示 */}
      {((aiMode !== 'off' && aiData && !isStreaming) || mockAiData) && (
        <div className="mt-3 bg-bg-700 p-3 rounded-lg border border-bg-700">
          <div className="flex items-center gap-2 text-font-base text-sm font-semibold mb-2">
            <span>AI 解析</span>
          </div>
          <div className="text-font-base text-sm font-normal markdown-content">
            {(aiData?.contextualDefinitions || mockAiData?.contextualDefinitions || []).map(
              (definition, index) => (
                <div key={index} className={index > 0 ? 'mt-2' : ''}>
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      // 自定义渲染组件以确保样式正确
                      strong: ({ children }) => (
                        <strong className="font-bold text-font-base">{children}</strong>
                      ),
                      p: ({ children }) => <p className="mb-1 last:mb-0">{children}</p>,
                      ul: ({ children }) => <ul className="list-disc pl-4 my-1">{children}</ul>,
                      ol: ({ children }) => <ol className="list-decimal pl-4 my-1">{children}</ol>,
                      li: ({ children }) => <li className="mb-0.5">{children}</li>,
                    }}
                  >
                    {definition}
                  </ReactMarkdown>
                </div>
              ),
            )}
          </div>
        </div>
      )}

      {/* AI 解析错误 - 仅在非 off 模式时显示 */}
      {aiMode !== 'off' && aiError && (
        <div className="mt-3 bg-danger-100 text-danger-600 text-sm font-semibold px-3.5 py-2.5 rounded-sm flex items-center gap-2">
          <span>{aiError}</span>
        </div>
      )}

      <WordCardActions
        lemmas={lemmas} // 把词元列表传下去给动作按钮
        word={word} // 传递原始单词用于忽略功能
        currentStatus={status} // 传递当前状态用于禁用按钮
        onUpdateStatus={handleUpdateStatus}
        onIgnoreWord={handleIgnoreWord}
        createHoverHandlers={createHoverHandlers}
      />
    </div>
  );
};

export default WordCard;
