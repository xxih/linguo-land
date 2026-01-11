import type { CSSProperties } from 'react';

/**
 * WordCard 组件样式定义
 * 现代化、精致的设计风格
 */
export class WordCardStyles {
  static readonly card: CSSProperties = {
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.08), 0 2px 8px rgba(0, 0, 0, 0.04)',
    pointerEvents: 'auto',
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif',
    fontSize: '14px',
    lineHeight: '1.6',
    backdropFilter: 'blur(10px)',
  };

  static readonly word: CSSProperties = {
    fontSize: '18px',
    fontWeight: '700',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    backgroundClip: 'text',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    margin: '0',
    letterSpacing: '0.5px',
  };

  static readonly phonetic: CSSProperties = {
    fontSize: '14px',
    color: '#8b5cf6',
    fontStyle: 'italic',
    marginLeft: '10px',
    fontWeight: '500',
  };

  static readonly definition: CSSProperties = {
    marginBottom: '16px',
    padding: '12px',
    backgroundColor: '#fafafa',
    borderRadius: '10px',
    border: '1px solid #f0f0f0',
  };

  static readonly partOfSpeech: CSSProperties = {
    fontSize: '11px',
    color: '#8b5cf6',
    fontWeight: '600',
    textTransform: 'uppercase' as const,
    marginBottom: '6px',
    letterSpacing: '1px',
    backgroundColor: '#f3e8ff',
    padding: '2px 8px',
    borderRadius: '4px',
    display: 'inline-block',
  };

  static readonly meaning: CSSProperties = {
    fontSize: '15px',
    color: '#1f2937',
    marginBottom: '6px',
    lineHeight: '1.6',
    fontWeight: '500',
  };

  static readonly example: CSSProperties = {
    fontSize: '13px',
    color: '#6b7280',
    fontStyle: 'italic',
    paddingLeft: '12px',
    marginTop: '8px',
    borderLeft: '3px solid #c4b5fd',
    lineHeight: '1.5',
  };

  static readonly actionButtons: CSSProperties = {
    display: 'flex',
    gap: '8px',
    marginTop: '14px',
    paddingTop: '12px',
    borderTop: '2px solid #f5f5f5',
  };

  static readonly baseActionButton: CSSProperties = {
    flex: 1,
    padding: '7px 10px',
    border: '2px solid transparent',
    borderRadius: '8px',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer',
    background: '#fff',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
    textShadow: '0 1px 2px rgba(0, 0, 0, 0.1)',
  };

  /**
   * 获取动作按钮样式
   */
  static getActionButtonStyle(type: 'known' | 'learning' | 'unknown' | 'ignore'): CSSProperties {
    const styleMap = {
      known: {
        background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
        color: '#fff',
        borderColor: '#10b981',
      },
      learning: {
        background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
        color: '#fff',
        borderColor: '#3b82f6',
      },
      unknown: {
        background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
        color: '#fff',
        borderColor: '#f59e0b',
      },
      ignore: {
        background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
        color: '#fff',
        borderColor: '#ef4444',
      },
    };

    return {
      ...this.baseActionButton,
      ...styleMap[type],
      boxShadow: '0 1px 4px rgba(0, 0, 0, 0.12)',
      textShadow: '0 1px 2px rgba(0, 0, 0, 0.15)',
    };
  }

  /**
   * 获取悬停时的按钮样式
   */
  static getHoverButtonStyle(type: 'known' | 'learning' | 'unknown' | 'ignore'): CSSProperties {
    const styleMap = {
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

    return styleMap[type];
  }

  /**
   * 获取悬停离开时的按钮样式
   */
  static getLeaveButtonStyle(): CSSProperties {
    return {
      transform: 'translateY(0)',
      boxShadow: '0 1px 4px rgba(0, 0, 0, 0.12)',
    };
  }

  /**
   * AI 解析容器样式（紧凑版）
   */
  static readonly aiContainer: CSSProperties = {
    marginTop: '12px',
    padding: '10px 12px',
    background: 'linear-gradient(135deg, #faf5ff 0%, #f3e8ff 100%)',
    borderRadius: '10px',
    border: '2px solid #e9d5ff',
    boxShadow: '0 2px 8px rgba(139, 92, 246, 0.08)',
  };

  /**
   * AI 解析标题样式（紧凑版）
   */
  static readonly aiTitle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '12px',
    fontWeight: '700',
    color: '#7c3aed',
    marginBottom: '8px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  };

  /**
   * AI 解析内容样式（紧凑版）
   */
  static readonly aiContent: CSSProperties = {
    fontSize: '14px',
    color: '#1f2937',
    lineHeight: '1.6',
    fontWeight: '500',
  };

  /**
   * 获取关闭按钮悬停样式
   */
  static readonly closeButtonHover: CSSProperties = {
    backgroundColor: '#ef4444',
    color: '#fff',
    transform: 'rotate(90deg) scale(1.1)',
  };

  /**
   * 获取关闭按钮离开样式
   */
  static readonly closeButtonLeave: CSSProperties = {
    backgroundColor: '#f3f4f6',
    color: '#6b7280',
    transform: 'rotate(0) scale(1)',
  };
}
