import { useEffect, useRef, useState } from 'react';
import { Modal, Button, Space, Upload, Spin, message } from 'antd';
import { PlusOutlined, LoadingOutlined, ReloadOutlined } from '@ant-design/icons';
import { Cropper, ReactCropperElement } from 'react-cropper';
import 'cropperjs/dist/cropper.css';
import Compressor from 'compressorjs';
import './ImageUploadCropper.css';

export interface ImageUploadCropperProps {
  /** 当前值：已上传图片的 URL 或 base64（用于回显） */
  value?: string;
  /** 值变化：返回压缩后的 Blob/File，方便交给上传接口 */
  onChange?: (file: Blob) => void;
  /** 裁剪比例，默认 1（正方形头像）。传 NaN 表示自由比例 */
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
  /** 上传接口地址（baseURL 之外的完整路径或 /api 开头）；传入后确认时自动上传并返回 URL */
  uploadUrl?: string;
  /** 上传成功后从响应里取 URL 的路径，默认取 data.url */
  urlField?: string;
  /** 通过 uploadUrl 自动上传成功后，额外回传后端返回的 URL */
  onUploaded?: (url: string) => void;
}

const DEFAULT_MAX_SIZE = 512 * 1024;

function compressImage(file: File, maxSize: number, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    // eslint-disable-next-line no-new
    new Compressor(file, {
      quality,
      maxWidth: 2000,
      maxHeight: 2000,
      // 在质量不达标时自动降低质量重试
      success: (result) => {
        if (result.size <= maxSize || quality <= 0.3) {
          resolve(result);
        } else {
          compressImage(file, maxSize, quality - 0.1)
            .then(resolve)
            .catch(reject);
        }
      },
      error: reject,
    });
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
  aspect = 1,
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
  const cropperRef = useRef<ReactCropperElement>(null);
  const [src, setSrc] = useState<string>();
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    return () => {
      if (src) URL.revokeObjectURL(src);
    };
  }, [src]);

  const beforeUpload = (file: File) => {
    const isImg = file.type.startsWith('image/');
    if (!isImg) {
      message.error('请选择图片文件');
      return Upload.LIST_IGNORE;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setSrc(reader.result as string);
      setOpen(true);
    };
    reader.readAsDataURL(file);
    return Upload.LIST_IGNORE;
  };

  const handleConfirm = async () => {
    const cropper = cropperRef.current?.cropper;
    if (!cropper) return;
    const canvas = cropper.getCroppedCanvas({
      maxWidth: 2000,
      maxHeight: 2000,
      imageSmoothingQuality: 'high',
    });
    canvas.toBlob(
      async (blob) => {
        if (!blob) return;
        try {
          const compressed = await compressImage(blob as File, maxSize, quality);
          if (uploadUrl) {
            setUploading(true);
            const url = await uploadFile(compressed, uploadUrl, urlField);
            onChange?.(compressed);
            onUploaded?.(url);
            setOpen(false);
            setSrc(undefined);
            message.success('上传成功');
          } else {
            onChange?.(compressed);
            setOpen(false);
            setSrc(undefined);
          }
        } catch {
          message.error('处理失败，请重试');
        } finally {
          setUploading(false);
        }
      },
      'image/jpeg',
      1,
    );
  };

  const previewStyle: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: shape === 'circle' ? '50%' : 12,
    backgroundImage: value ? `url(${value})` : undefined,
  };

  return (
    <>
      <div className="iuc-trigger" id={id}>
        {value ? (
          <div
            className="iuc-preview"
            style={previewStyle}
            onClick={() => !disabled && setOpen(false)}
            role="button"
            tabIndex={disabled ? -1 : 0}
            aria-label={value ? '更换图片' : '上传图片'}
          >
            <div className="iuc-preview-mask">
              <Space direction="vertical" size={2}>
                <ReloadOutlined />
                <span style={{ fontSize: 12 }}>更换</span>
              </Space>
            </div>
          </div>
        ) : (
          <Upload
            accept="image/*"
            showUploadList={false}
            beforeUpload={beforeUpload}
            disabled={disabled}
            className="iuc-upload"
          >
            <div className="iuc-add" style={{ width: size, height: size, borderRadius: shape === 'circle' ? '50%' : 12 }} role="button" tabIndex={disabled ? -1 : 0} aria-label="上传图片">
              <PlusOutlined style={{ fontSize: size * 0.2 }} />
              {placeholder && <span className="iuc-placeholder">{placeholder}</span>}
            </div>
          </Upload>
        )}
        {value && !disabled && (
          <Button
            type="link"
            size="small"
            className="iuc-replace"
            onClick={() => {
              const input = document.createElement('input');
              input.type = 'file';
              input.accept = 'image/*';
              input.onchange = (e) => {
                const f = (e.target as HTMLInputElement).files?.[0];
                if (f) beforeUpload(f);
              };
              input.click();
            }}
          >
            更换
          </Button>
        )}
      </div>

      <Modal
        title="裁剪图片"
        open={open}
        onCancel={() => setOpen(false)}
        width={560}
        footer={[
          <Button key="cancel" onClick={() => setOpen(false)}>
            取消
          </Button>,
          <Button key="ok" type="primary" loading={uploading} onClick={handleConfirm}>
            确认
          </Button>,
        ]}
        destroyOnHidden
      >
        <div className="iuc-cropper-wrap">
          {src ? (
            <Cropper
              ref={cropperRef}
              src={src}
              style={{ height: 360, width: '100%' }}
              aspectRatio={Number.isNaN(aspect) ? undefined : aspect}
              viewMode={1}
              background={false}
              autoCropArea={1}
              guides={false}
              responsive
            />
          ) : (
            <div className="iuc-loading">
              <Spin indicator={<LoadingOutlined spin />} />
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
