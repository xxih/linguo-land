import React, { useEffect, useState } from 'react';
import { CheckCircle2, Info } from 'lucide-react';

interface ToastNotificationProps {
  message: string;
  words: string[];
  type: 'success' | 'info';
  duration?: number;
  onClose: () => void;
}

/**
 * Toast 通知组件
 * 用于显示批量操作的结果
 */
const ToastNotification: React.FC<ToastNotificationProps> = ({
  message,
  words,
  type,
  duration = 4000,
  onClose,
}) => {
  const [isLeaving, setIsLeaving] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsLeaving(true);
      setTimeout(onClose, 300); // 等待动画完成
    }, duration);

    return () => clearTimeout(timer);
  }, [duration, onClose]);

  const handleClose = () => {
    setIsLeaving(true);
    setTimeout(onClose, 300);
  };

  const bgColor = type === 'success' ? '#10b981' : '#3b82f6';
  const maxDisplayWords = 5;
  const displayWords = words.slice(0, maxDisplayWords);
  const remainingCount = words.length - maxDisplayWords;

  return (
    <div
      style={{
        position: 'fixed',
        top: '20px',
        right: '20px',
        minWidth: '320px',
        maxWidth: '400px',
        backgroundColor: 'white',
        borderRadius: '12px',
        boxShadow: '0 10px 40px rgba(0, 0, 0, 0.2)',
        padding: '16px',
        zIndex: 999999,
        transform: isLeaving ? 'translateX(120%)' : 'translateX(0)',
        opacity: isLeaving ? 0 : 1,
        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        pointerEvents: 'auto',
        borderLeft: `4px solid ${bgColor}`,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          marginBottom: '12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {type === 'success' ? (
            <CheckCircle2 style={{ width: '20px', height: '20px', color: '#10b981', flexShrink: 0 }} />
          ) : (
            <Info style={{ width: '20px', height: '20px', color: '#3b82f6', flexShrink: 0 }} />
          )}
          <span
            style={{
              fontSize: '15px',
              fontWeight: '600',
              color: '#111827',
            }}
          >
            {message}
          </span>
        </div>
        <button
          onClick={handleClose}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: '20px',
            color: '#6b7280',
            padding: '0',
            lineHeight: '1',
            transition: 'color 0.2s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = '#374151';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = '#6b7280';
          }}
        >
          ×
        </button>
      </div>

      {words.length > 0 && (
        <div
          style={{
            backgroundColor: '#f9fafb',
            borderRadius: '8px',
            padding: '10px 12px',
            border: '1px solid #e5e7eb',
          }}
        >
          <div
            style={{
              fontSize: '13px',
              color: '#6b7280',
              display: 'flex',
              flexWrap: 'wrap',
              gap: '6px',
              lineHeight: '1.6',
            }}
          >
            {displayWords.map((word, index) => (
              <span
                key={index}
                style={{
                  backgroundColor: 'white',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  border: '1px solid #d1d5db',
                  fontSize: '12px',
                  color: '#374151',
                  fontWeight: '500',
                }}
              >
                {word}
              </span>
            ))}
            {remainingCount > 0 && (
              <span
                style={{
                  padding: '2px 8px',
                  fontSize: '12px',
                  color: '#6b7280',
                  fontStyle: 'italic',
                }}
              >
                +{remainingCount} 个...
              </span>
            )}
          </div>
        </div>
      )}

      {/* 进度条 */}
      <div
        style={{
          position: 'absolute',
          bottom: '0',
          left: '0',
          right: '0',
          height: '3px',
          backgroundColor: '#f3f4f6',
          borderRadius: '0 0 12px 12px',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            backgroundColor: bgColor,
            animation: `shrink ${duration}ms linear`,
            transformOrigin: 'left',
          }}
        />
      </div>

      <style>{`
				@keyframes shrink {
					from {
						transform: scaleX(1);
					}
					to {
						transform: scaleX(0);
					}
				}
			`}</style>
    </div>
  );
};

export default ToastNotification;
