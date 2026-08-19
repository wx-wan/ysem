import { useEffect, useRef, useState } from 'react';
import { Upload, Avatar, Button, Space, Modal, message } from 'antd';
import { PlusOutlined, ReloadOutlined, UserOutlined } from '@ant-design/icons';
import './ImageUploadCropper.css';

export interface ImageUploadCropperProps {
  /** 当前值：已上传图片的 URL 或 base64（用于回显） */
  value?: string;
  /** 值变化：返回压缩后的 Blob/File，方便交给上传接口 */
  onChange?: (file: Blob) => void;
  /** 裁剪比例（保留以兼容旧调用，无裁剪组件时不再使用） */
  aspect?: number;
  /** 压缩后最大体积（字节），默认 512KB */
  maxSize?: number;
  /** 压缩质量 0~1，默认 0.8 */
  quality?: number;
  /** 预览形状，默认 square；circle 用于头像 */
  shape?: 'square' | 'circle';
  /** 预览/触发区尺寸（像素），默认 120 */
  size?: number;
  /** 触发区提示文字 */
  placeholder?: string;
  /** 是否禁用 */
  disabled?: boolean;
  /** 组件 id，用于 label htmlFor 关联 */
  id?: string;
  /** 上传接口地址（baseURL 之外的完整路径或 /api 开头）；传入后确认图片后自动上传并返回 URL */
  uploadUrl?: string;
  /** 上传成功后从响应里取 URL 的路径，默认取 data.url */
  urlField?: string;
  /** 通过 uploadUrl 自动上传成功后，额外回传后端返回的 URL */
  onUploaded?: (url: string) => void;
}

const DEFAULT_MAX_SIZE = 512 * 1024;

/** 使用原生 canvas 等比压缩（最大边 2000px），并尽量逼近 maxSize */
function compressImage(file: File, maxSize: number, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      const maxEdge = 2000;
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
      const tryQuality = (q: number, depth: number) => {
        canvas.toBlob(
          (blob) => {
            URL.revokeObjectURL(url);
            if (!blob) {
              reject(new Error('compress failed'));
              return;
            }
            if (blob.size <= maxSize || depth >= 4) {
              resolve(blob);
            } else {
              tryQuality(Math.max(0.3, q - 0.15), depth + 1);
            }
          },
          'image/jpeg',
          q,
        );
      };
      tryQuality(quality, 0);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('load failed'));
    };
    img.src = url;
  });
}

async function uploadFile(blob: Blob, uploadUrl: string, urlField: string): Promise<string> {
  const form = new FormData();
  form.append('file', blob, 'image.png');
  const base = uploadUrl.startsWith('/api') ? '' : '/api';
  const res = await fetch(`${base}${uploadUrl}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${localStorage.getItem('accessToken') || ''}` },
    body: form,
  });
  if (!res.ok) throw new Error('upload failed');
  const json = await res.json();
  const url = urlField.split('.').reduce((o: unknown, k: string) => (o as Record<string, unknown>)?.[k], json);
  return url as string;
}

export default function ImageUploadCropper({
  value,
  onChange,
  maxSize = DEFAULT_MAX_SIZE,
  quality = 0.8,
  shape = 'square',
  size = 120,
  placeholder,
  disabled,
  id,
  uploadUrl,
  urlField = 'data.url',
  onUploaded,
}: ImageUploadCropperProps) {
  const [uploading, setUploading] = useState(false);
  const [previewSrc, setPreviewSrc] = useState<string>();
  const [open, setOpen] = useState(false);
  const selectedFileRef = useRef<File | null>(null);

  useEffect(() => {
    return () => {
      if (previewSrc) URL.revokeObjectURL(previewSrc);
    };
  }, [previewSrc]);

  const openPicker = () => {
    if (disabled || uploading) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      if (!file.type.startsWith('image/')) {
        message.error('请选择图片文件');
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        if (previewSrc) URL.revokeObjectURL(previewSrc);
        selectedFileRef.current = file;
        setPreviewSrc(reader.result as string);
        setOpen(true);
      };
      reader.readAsDataURL(file);
    };
    input.click();
  };

  const handleConfirm = async () => {
    const file = selectedFileRef.current;
    if (!file) return;
    try {
      setUploading(true);
      const compressed = await compressImage(file, maxSize, quality);
      onChange?.(compressed);
      if (uploadUrl) {
        const url = await uploadFile(compressed, uploadUrl, urlField);
        onUploaded?.(url);
        message.success('上传成功');
      }
    } catch {
      message.error('处理失败，请重试');
    } finally {
      setUploading(false);
      setOpen(false);
      setPreviewSrc(undefined);
      selectedFileRef.current = null;
    }
  };

  const handleCancel = () => {
    setOpen(false);
    setPreviewSrc(undefined);
    selectedFileRef.current = null;
  };

  const previewStyle: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: shape === 'circle' ? '50%' : 12,
  };

  return (
    <>
      <div className="iuc-trigger" id={id}>
        {value ? (
          <div
            className="iuc-preview"
            style={{ ...previewStyle, backgroundImage: `url(${value})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
            onClick={openPicker}
            role="button"
            tabIndex={disabled ? -1 : 0}
            aria-label="更换图片"
          >
            <div className="iuc-preview-mask">
              <Space direction="vertical" size={2}>
                <ReloadOutlined />
                <span style={{ fontSize: 12 }}>更换</span>
              </Space>
            </div>
          </div>
        ) : (
          <div
            className="iuc-add"
            style={previewStyle}
            onClick={openPicker}
            role="button"
            tabIndex={disabled ? -1 : 0}
            aria-label="上传图片"
          >
            {shape === 'circle' ? (
              <Avatar size={size - 12} icon={<UserOutlined />} />
            ) : (
              <PlusOutlined style={{ fontSize: size * 0.2 }} />
            )}
            {placeholder && <span className="iuc-placeholder">{placeholder}</span>}
          </div>
        )}
        {value && !disabled && (
          <Button
            type="link"
            size="small"
            className="iuc-replace"
            loading={uploading}
            onClick={openPicker}
          >
            更换
          </Button>
        )}
      </div>

      <Modal
        title="预览头像"
        open={open}
        onCancel={handleCancel}
        width={480}
        centered
        footer={[
          <Button key="cancel" onClick={handleCancel}>
            取消
          </Button>,
          <Button key="ok" type="primary" loading={uploading} onClick={handleConfirm}>
            确认使用
          </Button>,
        ]}
        destroyOnHidden
      >
        <div className="iuc-preview-wrap">
          {previewSrc && (
            shape === 'circle' ? (
              <Avatar size={200} src={previewSrc} />
            ) : (
              <img className="iuc-preview-img" src={previewSrc} alt="预览" />
            )
          )}
        </div>
        <div className="iuc-preview-tip">确认后将自动上传并替换当前头像</div>
      </Modal>
    </>
  );
}
