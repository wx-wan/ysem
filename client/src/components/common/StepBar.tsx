import React from 'react';
import { CheckOutlined } from '@ant-design/icons';
import './StepBar.css';

export interface StepBarItem {
  title: string;
  stepLabel?: string;
  statusText?: string;
}

export interface StepBarProps {
  current: number;
  items: StepBarItem[];
  className?: string;
  /** 嵌入式：去掉自身边框/背景，融入父面板（如与下方内容合并为一个整体卡片） */
  embedded?: boolean;
}

export const StepBar: React.FC<StepBarProps> = ({ current, items, className = '', embedded = false }) => {
  if (!items.length) return null;

  const ratio = items.length <= 1 ? 0 : Math.min(1, Math.max(0, current / (items.length - 1)));

  return (
    <div
      className={`step-bar ${embedded ? 'step-bar--embedded' : ''} ${className}`.trim()}
      style={{
        ['--sb-count' as string]: items.length,
        ['--sb-progress' as string]: ratio,
      }}
    >
      <div className="step-bar__track" />
      <div className="step-bar__progress" />

      <div className="step-bar__items">
        {items.map((item, index) => {
          const isFinish = index < current;
          const isProcess = index === current;

          let statusNode: React.ReactNode = null;
          if (item.statusText) {
            statusNode = (
              <span className={`step-bar__status step-bar__status--${isFinish ? 'finish' : isProcess ? 'process' : 'wait'}`}>
                {item.statusText}
              </span>
            );
          }

          return (
            <div
              key={index}
              className={`step-bar__item step-bar__item--${isFinish ? 'finish' : isProcess ? 'process' : 'wait'}`}
            >
              <div className="step-bar__icon">
                {isFinish ? <CheckOutlined /> : index + 1}
              </div>
              <div className="step-bar__meta">
                <span className="step-bar__label">{item.stepLabel ?? `STEP ${index + 1}`}</span>
                <span className="step-bar__title">{item.title}</span>
                {statusNode}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
