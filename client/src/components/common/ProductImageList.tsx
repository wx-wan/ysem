import { useState } from 'react';
import { Upload, Modal, Button, message } from 'antd';
import { PlusOutlined, DeleteOutlined, StarFilled, StarOutlined } from '@ant-design/icons';
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
    const img = new Image();
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
  if (!res.ok) throw new Error('upload failed');
  const json = await res.json();
  return (json as { data?: { url?: string } }).data?.url as string;
}

export default function ProductImageList({
  value,
  onChange,
  uploadUrl = '/upload',
  maxCount = 6,
  disabled,
}: ProductImageListProps) {
  const items = parseImages(value);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  const commit = (next: ProductImageItem[]) => {
    onChange?.(serializeImages(next));
  };

  const beforeUpload = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      message.error('请选择图片文件');
      return Upload.LIST_IGNORE;
    }
    if (items.length >= maxCount) {
      message.warning(`最多上传 ${maxCount} 张`);
      return Upload.LIST_IGNORE;
    }
    try {
      setUploading(true);
      const compressed = await compressImage(file);
      const url = await uploadFile(compressed, uploadUrl);
      const name = items.length === 0 ? '主图' : `图片${items.length + 1}`;
      commit([...items, { url, name }]);
      message.success('上传成功');
    } catch {
      message.error('上传失败，请重试');
    } finally {
      setUploading(false);
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
    <div className="pil">
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
            <div className="pil-card" onClick={() => setPreview(file.url || null)}>
              <img className="pil-card-img" src={file.url} alt={file.name} />
              {isFirst && <span className="pil-main-badge">主图</span>}
              <div className="pil-card-ops" onClick={(e) => e.stopPropagation()}>
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
          <div className="pil-add">
            <PlusOutlined />
            <div className="pil-add-text">{uploading ? '上传中…' : '批量添加'}</div>
          </div>
        )}
      </Upload>

      <div className="pil-tip">支持批量选择，第一张为主图，点击图片可预览，星标设为主图</div>

      <Modal
        open={!!preview}
        footer={null}
        onCancel={() => setPreview(null)}
        width={720}
        title="图片预览"
        centered
      >
        {preview && <img alt="preview" style={{ width: '100%' }} src={preview} />}
      </Modal>
    </div>
  );
}
