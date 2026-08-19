import { useRef, useState } from 'react';
import { Upload, Image as AntImage, Button, App } from 'antd';
import { PlusOutlined, LoadingOutlined, DeleteOutlined, StarFilled, StarOutlined } from '@ant-design/icons';
import type { UploadFile } from 'antd';
import { ProductImageItem, parseImages, serializeImages } from '../../utils/productImages';
import './ProductImageList.css';

interface ProductImageListProps {
  /** 当前值：JSON 数组字符串 [{url,name}]，第一张为主图 */
  value?: string;
  /** 值变化 */
  onChange?: (val: string) => void;
  /** 上传接口地址（baseURL 之外的完整路径，自动加 /api 前缀） */
  uploadUrl?: string;
  /** 最大图片数量，默认 6 */
  maxCount?: number;
  /** 是否禁用 */
  disabled?: boolean;
}

/** 使用原生 canvas 等比压缩（最大边 2000px，质量 0.85） */
function compressImage(file: File, quality = 0.85, maxEdge = 2000): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new window.Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxEdge || height > maxEdge) {
        const ratio = Math.min(maxEdge / width, maxEdge / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error('canvas unavailable'));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          URL.revokeObjectURL(url);
          if (blob) resolve(blob);
          else reject(new Error('compress failed'));
        },
        'image/jpeg',
        quality,
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('load failed'));
    };
    img.src = url;
  });
}

async function uploadFile(blob: Blob, uploadUrl: string): Promise<string> {
  const form = new FormData();
  form.append('file', blob, 'image.jpg');
  const base = uploadUrl.startsWith('/api') ? '' : '/api';
  const res = await fetch(`${base}${uploadUrl}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${localStorage.getItem('accessToken') || ''}` },
    body: form,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    const err = new Error(`HTTP ${res.status}: ${txt || res.statusText}`);
    (err as any).status = res.status;
    throw err;
  }
  const json = await res.json();
  const url = (json as { data?: { url?: string } }).data?.url;
  if (!url) throw new Error('上传接口未返回图片 URL');
  return url;
}

export default function ProductImageList({
  value,
  onChange,
  uploadUrl = '/upload',
  maxCount = 6,
  disabled,
}: ProductImageListProps) {
  const { message } = App.useApp();
  const items = parseImages(value);
  const [uploading, setUploading] = useState(false);
  const pendingRef = useRef<File[]>([]);
  const flushScheduledRef = useRef(false);

  const commit = (next: ProductImageItem[]) => {
    onChange?.(serializeImages(next));
  };

  /** 同一次多选的所有文件统一并发上传后一次性提交，避免闭包 items 互相覆盖 */
  const flushPending = async () => {
    const files = pendingRef.current;
    pendingRef.current = [];
    flushScheduledRef.current = false;
    if (files.length === 0) return;

    const baseItems = parseImages(value);
    if (baseItems.length >= maxCount) {
      message.warning(`最多上传 ${maxCount} 张`);
      return;
    }
    const slice = files.slice(0, maxCount - baseItems.length);
    if (slice.length < files.length) {
      message.warning(`最多上传 ${maxCount} 张，已忽略多余图片`);
    }

    setUploading(true);
    try {
      const uploaded = await Promise.all(
        slice.map(async (file) => {
          const compressed = await compressImage(file);
          const url = await uploadFile(compressed, uploadUrl);
          return url;
        }),
      );
      const base = parseImages(value);
      const startIndex = base.length;
      const newItems = uploaded.map((url, i) => ({
        url,
        name: startIndex + i === 0 ? '主图' : `图片${startIndex + i + 1}`,
      }));
      commit([...base, ...newItems]);
      message.success(`成功上传 ${newItems.length} 张`);
    } catch (err: any) {
      console.error('[ProductImageList] upload failed:', err);
      if (err?.status === 401 || err?.status === 403) {
        message.error('登录已过期，请重新登录后上传');
      } else if (err?.message?.includes('Failed to fetch') || err?.message?.includes('NetworkError')) {
        message.error('网络异常，请检查后端服务是否启动');
      } else {
        message.error(`上传失败：${err?.message || '请重试'}`);
      }
    } finally {
      setUploading(false);
    }
  };

  const beforeUpload = (file: File) => {
    if (!file.type.startsWith('image/')) {
      message.error('请选择图片文件');
      return Upload.LIST_IGNORE;
    }
    pendingRef.current.push(file);
    if (!flushScheduledRef.current) {
      flushScheduledRef.current = true;
      // 等同一批次所有文件都进入队列后再统一上传
      Promise.resolve().then(flushPending);
    }
    return Upload.LIST_IGNORE;
  };

  const removeAt = (index: number) => {
    commit(items.filter((_, i) => i !== index));
  };

  const moveToFirst = (index: number) => {
    if (index <= 0) return;
    const next = [...items];
    const [target] = next.splice(index, 1);
    next.unshift(target);
    commit(next);
  };

  const fileList: UploadFile[] = items.map((it, i) => ({
    uid: String(i),
    url: it.url,
    name: it.name,
  }));

  return (
    <div className={`pil ${items.length ? 'pil-has-images' : 'pil-empty'}`}>
      <AntImage.PreviewGroup>
        <Upload
          multiple
          listType="picture-card"
          accept="image/png,image/jpeg,image/webp"
          fileList={fileList}
          beforeUpload={beforeUpload}
          disabled={disabled || uploading}
          className="pil-upload"
          itemRender={(_, file) => {
            const idx = Number(file.uid);
            const isFirst = idx === 0;
            return (
              <div className="pil-card">
                <AntImage
                  className="pil-card-img"
                  src={file.url}
                  alt={file.name}
                  preview={{ mask: false }}
                />
                {isFirst && <span className="pil-main-badge">主图</span>}
                <div className="pil-card-ops">
                  <Button
                    size="small"
                    type="text"
                    title="设为主图"
                    disabled={disabled || isFirst}
                    icon={isFirst ? <StarFilled /> : <StarOutlined />}
                    onClick={() => moveToFirst(idx)}
                  />
                  <Button
                    size="small"
                    type="text"
                    danger
                    title="删除"
                    disabled={disabled}
                    icon={<DeleteOutlined />}
                    onClick={() => removeAt(idx)}
                  />
                </div>
              </div>
            );
          }}
        >
          {items.length < maxCount && !disabled && (
            <div className={`pil-add ${uploading ? 'is-uploading' : ''}`}>
              {uploading ? (
                <>
                  <span className="pil-add-icon is-spin">
                    <LoadingOutlined />
                  </span>
                  <div className="pil-add-text">上传中…</div>
                </>
              ) : (
                <>
                  <span className="pil-add-icon">
                    <PlusOutlined />
                  </span>
                  <div className="pil-add-text">添加图片</div>
                </>
              )}
            </div>
          )}
        </Upload>
      </AntImage.PreviewGroup>

      <div className="pil-tip">支持批量选择，第一张为主图，点击图片可预览（支持左右切换），星标设为主图</div>
    </div>
  );
}
