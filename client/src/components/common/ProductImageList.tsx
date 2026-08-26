import { useRef, useState, useEffect } from 'react';
import { Image as AntImage, App } from 'antd';
import { PlusOutlined, LoadingOutlined, DeleteOutlined, LeftOutlined, RightOutlined, StarOutlined, ZoomInOutlined, EditOutlined } from '@ant-design/icons';
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
  /** 主图展示区高度（px），默认 200 */
  height?: number;
  /** 透传的 id（供 Form.Item 关联 label 使用，a11y） */
  id?: string;
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

/** 操作栏轻量按钮：原生 button，hover 行为完全自控，不依赖 antd 默认样式 */
function PilOpButton({
  icon,
  children,
  onClick,
  danger,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      className={`pil-op-btn ${danger ? 'is-danger' : ''}`}
      onClick={onClick}
    >
      {icon}
      <span>{children}</span>
    </button>
  );
}

export default function ProductImageList({
  value,
  onChange,
  uploadUrl = '/upload',
  maxCount = 6,
  disabled,
  height = 200,
  id,
}: ProductImageListProps) {
  const { message } = App.useApp();
  const items = parseImages(value);
  const [uploading, setUploading] = useState(false);
  const [current, setCurrent] = useState(0);
  const [zoomed, setZoomed] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const pendingRef = useRef<File[]>([]);
  const flushScheduledRef = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);

  /** 监听页面粘贴图片（打开弹窗时使用） */
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files || []).filter((f) => f.type.startsWith('image/'));
      if (!files.length) return;
      e.preventDefault();
      files.forEach(queueFile);
    };
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, []);

  const safeCurrent = Math.min(current, Math.max(0, items.length - 1));

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

  /** 把选中的文件排入上传队列（原生 input 与普通上传共用） */
  const queueFile = (file: File) => {
    if (!file.type.startsWith('image/')) {
      message.error('请选择图片文件');
      return;
    }
    pendingRef.current.push(file);
    if (!flushScheduledRef.current) {
      flushScheduledRef.current = true;
      Promise.resolve().then(flushPending);
    }
  };

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) Array.from(files).forEach(queueFile);
    e.target.value = '';
  };

  const removeAt = (index: number) => {
    commit(items.filter((_, i) => i !== index));
    setCurrent((c) => Math.max(0, Math.min(c, items.length - 2)));
  };

  const moveToFirst = (index: number) => {
    if (index <= 0) return;
    const next = [...items];
    const [target] = next.splice(index, 1);
    next.unshift(target);
    commit(next);
    setCurrent(0);
  };

  const go = (dir: number) => {
    if (!items.length) return;
    setZoomed(false);
    setEditingName(false);
    setCurrent((c) => (c + dir + items.length) % items.length);
  };

  const renameAt = (index: number, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const next = items.map((it, i) => (i === index ? { ...it, name: trimmed } : it));
    commit(next);
  };

  return (
    <div className={`pil ${items.length ? 'pil-has-images' : 'pil-empty'}`}>
      {/* 主图展示区：显示当前选中图片的缩略图（完整 contain），点击展开原始大小 */}
      <div className="pil-hero" style={{ height }}>
        {items.length ? (
          <>
            {/* 显示层：原生 img，样式完全可控，不受 antd 默认样式干扰 */}
            <img
              className="pil-hero-img"
              src={items[safeCurrent].url}
              alt={items[safeCurrent].name}
              title={`${items[safeCurrent].name}（点击查看原图）`}
              onClick={() => setZoomed(true)}
            />
            {/* 预览层：隐藏的 AntImage，只负责管理全屏放大预览 */}
            <AntImage
              style={{ display: 'none' }}
              src={items[safeCurrent].url}
              alt={items[safeCurrent].name}
              preview={{
                open: zoomed,
                onOpenChange: (v) => setZoomed(v),
                imageRender: (current: React.ReactNode) => (
                  <>
                    {current}
                    <div className="pil-preview-name">{items[safeCurrent]?.name}</div>
                  </>
                ),
              }}
            />
            {items.length > 1 && !zoomed && (
              <>
                <button
                  type="button"
                  className="pil-nav pil-nav-prev"
                  onClick={() => go(-1)}
                  aria-label="上一张"
                >
                  <LeftOutlined />
                </button>
                <button
                  type="button"
                  className="pil-nav pil-nav-next"
                  onClick={() => go(1)}
                  aria-label="下一张"
                >
                  <RightOutlined />
                </button>
              </>
            )}
            {safeCurrent === 0 && !zoomed && <span className="pil-main-badge">主图</span>}
            <div className="pil-hero-meta">
              {editingName && !disabled ? (
                <input
                  className="pil-hero-name-input"
                  autoFocus
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={() => {
                    renameAt(safeCurrent, nameDraft);
                    setEditingName(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      renameAt(safeCurrent, nameDraft);
                      setEditingName(false);
                    } else if (e.key === 'Escape') {
                      setEditingName(false);
                    }
                  }}
                />
              ) : (
                <span
                  className={`pil-hero-name ${disabled ? '' : 'is-editable'}`}
                  title={disabled ? undefined : '点击编辑名称'}
                  onClick={() => {
                    if (disabled) return;
                    setNameDraft(items[safeCurrent].name);
                    setEditingName(true);
                  }}
                >
                  {!disabled && (
                    <span
                      className="pil-hero-name-edit"
                      onClick={(e) => {
                        e.stopPropagation();
                        setNameDraft(items[safeCurrent].name);
                        setEditingName(true);
                      }}
                    >
                      <EditOutlined />
                    </span>
                  )}
                  {items[safeCurrent].name}
                </span>
              )}
              <span className="pil-hero-count">{safeCurrent + 1} / {items.length}</span>
            </div>

            {/* 放大预览使用 antd Image 自带预览（点击图片或顶部「放大预览」按钮触发） */}

            {/* 顶部胶囊操作条：放大预览 / 设为主图 / 删除 */}
            <div className="pil-hero-ops">
              <PilOpButton
                icon={<ZoomInOutlined />}
                onClick={() => setZoomed(true)}
              >
                放大预览
              </PilOpButton>
              {safeCurrent !== 0 && !disabled && (
                <PilOpButton
                  icon={<StarOutlined />}
                  onClick={() => moveToFirst(safeCurrent)}
                >
                  设为主图
                </PilOpButton>
              )}
              {!disabled && (
                <PilOpButton
                  icon={<DeleteOutlined />}
                  danger
                  onClick={() => removeAt(safeCurrent)}
                >
                  删除
                </PilOpButton>
              )}
            </div>
          </>
        ) : (
          <button
            type="button"
            className="pil-hero-drop"
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'copy';
            }}
            onDrop={(e) => {
              e.preventDefault();
              Array.from(e.dataTransfer.files).forEach(queueFile);
            }}
            disabled={disabled || uploading}
          >
            <span className="pil-hero-drop-icon">
              {uploading ? <LoadingOutlined className="is-spin" /> : <PlusOutlined />}
            </span>
            <span className="pil-hero-drop-text">{uploading ? '上传中…' : '添加图片'}</span>
            <span className="pil-hero-drop-hint">粘贴 / 拖拽至此上传</span>
          </button>
        )}
      </div>

      {/* 缩略图条 + 添加入口（始终显示，空态仅显示「+」新增框） */}
      <div className="pil-thumbs">
        {items.map((it, i) => (
          <button
            type="button"
            key={i}
            className={`pil-thumb ${i === safeCurrent ? 'is-active' : ''}`}
            onClick={() => setCurrent(i)}
          >
            <AntImage className="pil-thumb-img" src={it.url} alt={it.name} preview={false} />
            {i === 0 && <span className="pil-thumb-badge">主</span>}
            {!disabled && i !== 0 && (
              <span
                className="pil-thumb-del"
                onClick={(e) => {
                  e.stopPropagation();
                  removeAt(i);
                }}
              >
                <DeleteOutlined />
              </span>
            )}
          </button>
        ))}
        {items.length < maxCount && !disabled && (
          <button
            type="button"
            className={`pil-thumb pil-thumb-add ${uploading ? 'is-uploading' : ''}`}
            onClick={() => fileRef.current?.click()}
          >
            {uploading ? <LoadingOutlined className="is-spin" /> : <PlusOutlined />}
          </button>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        id={id}
        name="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        className="pil-file-input"
        onChange={onPick}
      />
    </div>
  );
}
