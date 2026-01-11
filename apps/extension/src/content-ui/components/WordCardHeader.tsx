import React, { useState } from 'react';
import type { DictionaryEntry, WordFamiliarityStatus } from 'shared-types';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Logger } from '../../utils/logger';
import { X } from 'lucide-react';

const logger = new Logger('WordCardHeader');

interface WordCardHeaderProps {
  word: string;
  details: DictionaryEntry;
  status?: WordFamiliarityStatus | 'ignored';
  onClose: () => void;
  closeButtonHoverHandlers: {
    onMouseEnter: (e: React.MouseEvent<HTMLButtonElement>) => void;
    onMouseLeave: (e: React.MouseEvent<HTMLButtonElement>) => void;
  };
  onIgnoreWord: (word: string) => void;
  onUpdateStatus?: (lemmas: string[], status: WordFamiliarityStatus) => void; // 添加 onUpdateStatus 回调
}

/**
 * WordCard 头部组件
 * 显示单词、音标、音频播放、状态徽章和关闭按钮
 */
export const WordCardHeader: React.FC<WordCardHeaderProps> = ({
  word,
  details,
  status,
  onClose,
  closeButtonHoverHandlers,
  onIgnoreWord,
  onUpdateStatus, // 解构 onUpdateStatus
}) => {
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);

  // 获取状态文本和图标
  const getStatusDisplay = (currentStatus: WordFamiliarityStatus | 'ignored') => {
    const statusMap = {
      known: { text: '已掌握' },
      learning: { text: '学习中' },
      unknown: { text: '陌生' },
      ignored: { text: '已忽略' },
    };
    return statusMap[currentStatus];
  };

  const statusClass: Record<WordFamiliarityStatus | 'ignored', string> = {
    known: 'bg-success-200 text-success-600',
    learning: 'bg-warning-200 text-warning-600',
    unknown: 'bg-danger-200 text-danger-600',
    ignored: 'bg-gray-200 text-gray-600',
  };

  // 播放音频
  const playAudio = () => {
    if (!details.audio || details.audio.length === 0) return;

    setIsPlayingAudio(true);
    const audio = new Audio(details.audio[0]);

    audio.onended = () => setIsPlayingAudio(false);
    audio.onerror = () => setIsPlayingAudio(false);

    audio.play().catch((error) => {
      logger.error('Failed to play audio', error as Error);
      setIsPlayingAudio(false);
    });
  };

  return (
    <div className="mb-3">
      {/* 第一行：单词 + 标签 + 状态 + 关闭按钮 */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center flex-1 gap-2 flex-wrap">
          <h3 className="text-font-base font-semibold text-xl my-0">{word}</h3>

          {/* AI 来源标识 */}
          {/* {details.source === 'ai' && (
						<TooltipProvider>
							<Tooltip>
								<TooltipTrigger asChild>
									<div className='bg-purple-100 text-purple-700 text-xs font-bold px-1.5 py-0.5 rounded-full flex items-center gap-1'>
										<span>✨</span>
										<span>AI</span>
									</div>
								</TooltipTrigger>
								<TooltipContent>
									<p className='text-xs'>该释义由 AI 生成，仅供参考</p>
								</TooltipContent>
							</Tooltip>
						</TooltipProvider>
					)} */}

          {/* 状态徽章 */}
          {status && (
            <TooltipProvider delayDuration={0}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div
                    onClick={() => {
                      // 状态为 'ignored' 时，调用 onUpdateStatus 取消忽略
                      if (status === 'ignored') {
                        if (onUpdateStatus) {
                          onUpdateStatus([word], 'unknown');
                        }
                      } else {
                        onIgnoreWord(word);
                      }
                    }}
                    className={`${statusClass[status]} ml-auto font-semibold py-0.5 px-1 text-xs rounded-sm cursor-pointer`}
                  >
                    <span>{getStatusDisplay(status).text}</span>
                  </div>
                </TooltipTrigger>
                <TooltipContent className="text-font-base">
                  {status === 'ignored' ? '取消忽略此词' : '忽略此词'}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
        <button
          className="flex items-center justify-center rounded-lg bg-bg-base size-6 font-semibold text-font-secondary  border-0 cursor-pointer ml-3 transition"
          onClick={onClose}
          {...closeButtonHoverHandlers}
          title="关闭"
        >
          <X size={13} strokeWidth={3} />
        </button>
      </div>

      {/* 第二行：音标 + 发音按钮 */}
      {(details.phonetics?.length > 0 || details.audio?.length > 0) && (
        <div className="flex items-center gap-2">
          {/* 音标 */}
          {details.phonetics && details.phonetics.length > 0 && (
            <span className="text-gray-500 text-sm leading-none">{details.phonetics[0]}</span>
          )}
          {/* 音频播放按钮 */}
          {details.audio && details.audio.length > 0 && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={playAudio}
                    disabled={isPlayingAudio}
                    className={`inline-flex items-center justify-center p-0.5 rounded-full border-0 bg-transparent cursor-pointer hover:bg-gray-200 ${
                      isPlayingAudio ? 'opacity-50' : ''
                    }`}
                    title="播放发音"
                  >
                    <svg
                      className="size-4 text-gray-600"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                    </svg>
                  </button>
                </TooltipTrigger>
                <TooltipContent>播放发音</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      )}
    </div>
  );
};
