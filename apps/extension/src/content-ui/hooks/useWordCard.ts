import { useCallback } from 'react';
import type { ChromeMessage, ChromeMessageResponse, WordFamiliarityStatus } from 'shared-types';
import { WORD_CARD_HOST } from '../../const';
import { StorageAdapter } from '../utils/storageAdapter';
import { Logger } from '../../utils/logger';

const logger = new Logger('useWordCard');

/**
 * WordCard 相关逻辑的自定义 Hook
 * 处理单词状态更新和卡片关闭逻辑
 */
export function useWordCard() {
  /**
   * 关闭单词卡片
   */
  const handleClose = useCallback(() => {
    // 触发关闭事件
    const closeEvent = new CustomEvent('lang-helper-close-card');
    document.dispatchEvent(closeEvent);

    // 移除弹窗
    const host = document.getElementById(WORD_CARD_HOST);
    if (host) {
      host.remove();
    }
  }, []);

  /**
   * 更新词元状态
   */
  const handleUpdateStatus = useCallback(
    (
      lemmas: string[], // 现在接收的是词元列表
      status: WordFamiliarityStatus,
      familiarityLevel?: number,
    ) => {
      logger.debug(`更新词元状态: [${lemmas.join(', ')}] -> ${status}`, {
        familiarityLevel,
      });

      // 记录状态变更操作
      StorageAdapter.getLocal<{
        studySessionActive: boolean;
        studySessionLogs: any[];
      }>(['studySessionActive', 'studySessionLogs']).then((result) => {
        if (result.studySessionActive) {
          const logs = result.studySessionLogs || [];
          lemmas.forEach((lemma) => {
            logs.push({
              type: 'STATUS_CHANGE',
              timestamp: Date.now(),
              word: lemma,
              newStatus: status,
              familiarityLevel,
            });
          });
          StorageAdapter.setLocal({ studySessionLogs: logs });
        }
      });

      // 为每个词元发送消息到background script
      lemmas.forEach((lemma) => {
        const message: ChromeMessage = {
          type: 'UPDATE_WORD_STATUS',
          word: lemma.toLowerCase(), // 确保是小写词元
          status: status,
          familiarityLevel: familiarityLevel,
        };

        chrome.runtime.sendMessage(message, (response: ChromeMessageResponse) => {
          if (chrome.runtime.lastError) {
            logger.error('Failed to update word status: ' + chrome.runtime.lastError.message, new Error(chrome.runtime.lastError.message));
            return;
          }

          if (response?.success) {
            logger.debug(`词元 "${lemma}" 状态已更新为 "${status}"`);
          } else {
            logger.error('Failed to update word status: ' + response?.error, new Error(response?.error));
          }
        });
      });

      // 关闭弹窗
      handleClose();
    },
    [handleClose],
  );

  /**
   * 忽略单词功能
   */
  const handleIgnoreWord = useCallback(
    (word: string) => {
      logger.debug(`忽略单词: "${word}"`);

      // 立即关闭弹窗，提供即时反馈
      handleClose();

      // 发送忽略消息到background script
      const message: ChromeMessage = {
        type: 'IGNORE_WORD',
        word: word,
      };

      chrome.runtime.sendMessage(message, (response: ChromeMessageResponse) => {
        if (chrome.runtime.lastError) {
          logger.error('Failed to ignore word: ' + chrome.runtime.lastError.message, new Error(chrome.runtime.lastError.message));
          return;
        }

        if (response?.success) {
          logger.debug(`单词 "${word}" 已添加到忽略列表`);
        } else {
          logger.error('Failed to ignore word: ' + response?.error, new Error(response?.error));
        }
      });
    },
    [handleClose],
  );

  /**
   * 处理按钮悬停效果
   */
  const createHoverHandlers = useCallback(
    (buttonType: 'known' | 'learning' | 'unknown' | 'ignore') => ({
      onMouseEnter: (e: React.MouseEvent<HTMLButtonElement>) => {
        const target = e.target as HTMLButtonElement;
        const hoverStyles = {
          known: {
            background: 'linear-gradient(135deg, #059669 0%, #047857 100%)',
            transform: 'translateY(-1px)',
            boxShadow: '0 2px 8px rgba(16, 185, 129, 0.35)',
          },
          learning: {
            background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
            transform: 'translateY(-1px)',
            boxShadow: '0 2px 8px rgba(59, 130, 246, 0.35)',
          },
          unknown: {
            background: 'linear-gradient(135deg, #d97706 0%, #b45309 100%)',
            transform: 'translateY(-1px)',
            boxShadow: '0 2px 8px rgba(245, 158, 11, 0.35)',
          },
          ignore: {
            background: 'linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)',
            transform: 'translateY(-1px)',
            boxShadow: '0 2px 8px rgba(239, 68, 68, 0.35)',
          },
        };
        const style = hoverStyles[buttonType];
        target.style.background = style.background;
        target.style.transform = style.transform;
        target.style.boxShadow = style.boxShadow;
      },
      onMouseLeave: (e: React.MouseEvent<HTMLButtonElement>) => {
        const target = e.target as HTMLButtonElement;
        const normalStyles = {
          known: {
            background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
          },
          learning: {
            background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
          },
          unknown: {
            background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
          },
          ignore: {
            background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
          },
        };
        const style = normalStyles[buttonType];
        target.style.background = style.background;
        target.style.transform = 'translateY(0)';
        target.style.boxShadow = '0 1px 4px rgba(0, 0, 0, 0.12)';
      },
    }),
    [],
  );

  return {
    handleClose,
    handleUpdateStatus,
    handleIgnoreWord,
    createHoverHandlers,
  };
}
