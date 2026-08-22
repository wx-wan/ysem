import { useState } from 'react';
import { Image as AntImage } from 'antd';
import { parseImages } from '../../utils/productImages';
import './ProductImagesStack.css';

interface ProductImagesStackProps {
  /** 产品 images 字段（JSON 数组或旧逗号分隔 URL） */
  images?: string | null;
  /** 容器尺寸（px），默认 220 */
  size?: number;
  /** 最多展示的扇形层数，超出折叠到计数气泡 */
  maxFan?: number;
  /** 自定义主图（若父级已解析） */
  items?: { url: string; name: string }[];
}

/**
 * 扇形堆叠图片组件（横向平移）：
 * - 自动把全部上传图片以“向右水平展开”的方式层叠展示（最左一张完整，后续向右偏移露出）。
 * - 点击图片可放大预览，预览支持切换全部图片。
 * - 当图片超过 maxFan 时显示「+N」计数气泡。
 */
export default function ProductImagesStack({
  images,
  size = 120,
  maxFan = 4,
  items: itemsProp,
}: ProductImagesStackProps) {
  const items = itemsProp ?? parseImages(images);
  const [hovered, setHovered] = useState(false);
  const [loaded, setLoaded] = useState<Record<number, boolean>>({});

  if (!items.length) {
    return <div className="pis-empty" style={{ width: size, height: size }}>暂无图片</div>;
  }

  const fan = items.slice(0, maxFan);
  const overflow = items.length - fan.length;
  const total = fan.length;

  // 扇形参数：第 0 张最前最大，后续向右平移并逐层缩小，像手牌一样展开
  const shift = 24;      // 每层右移 px
  const scaleStep = 10;  // 每层缩小 px
  const wrapWidth = Math.max(size, size + (total - 1) * (shift - scaleStep)) + 6;

  return (
    <div
      className={`pis-wrap ${hovered ? 'is-hover' : ''}`}
      style={{ width: wrapWidth, height: size }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <AntImage.PreviewGroup items={fan.map((it) => ({ src: it.url, alt: it.name }))}>
        {fan.map((it, i) => {
          const zIndex = total - i; // 第 0 张最前
          const imgSize = size - i * scaleStep;
          return (
            <AntImage
              key={it.url + i}
              className={`pis-img ${loaded[i] ? 'is-loaded' : ''}`}
              src={it.url}
              alt={it.name}
              preview={{ mask: null }}
              onLoad={() => setLoaded((s) => ({ ...s, [i]: true }))}
              style={{
                width: imgSize,
                height: imgSize,
                left: 0,
                top: 0,
                zIndex,
                transform: `translate(${i * shift}px, ${(size - imgSize) / 2}px)`,
              }}
            />
          );
        })}
        {overflow > 0 && (
          (() => {
            const lastIdx = total - 1;
            const lastSize = size - lastIdx * scaleStep;
            const bubbleSize = Math.round(lastSize * 0.4);
            const bubbleOffset = Math.max(4, Math.round(lastSize * 0.05));
            return (
              <div
                className="pis-overflow"
                style={{
                  width: bubbleSize,
                  height: bubbleSize,
                  left: lastIdx * shift + lastSize - bubbleSize - bubbleOffset,
                  top: (size - lastSize) / 2 + lastSize - bubbleSize - bubbleOffset,
                  zIndex: total + 2,
                }}
              >
                +{overflow}
              </div>
            );
          })()
        )}
      </AntImage.PreviewGroup>
    </div>
  );
}
