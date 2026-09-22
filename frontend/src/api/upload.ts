import request from './request';
import { ResponseShapeError, unwrapResponse } from '../utils/response';

/**
 * 文件上传 API（Round F-8D · D-FE-CARD-2/3/4）
 *
 * 后端端点（**本轮不修改后端**，端点已存在）：
 *   POST /api/upload       authenticate + multer(diskStorage · 仅 image/* · 10MB)
 *     → 信封 { code: 0, message: 'ok', data: { url: '/api/uploads/<filename>', filename } }
 *   GET  /api/uploads/*    静态托管（app.ts L146）⇒ data.url 可直接用于 <Image src> 与 Customer.coverImage
 *
 * 边界：
 *   · request 实例 baseURL = '/api' ⇒ 本文件 path 写 '/upload'（**不**写 '/api/upload'）
 *   · 本模块只负责「上传文件 → 取回 URL」；Customer 写契约始终是 `coverImage: string | null`，
 *     **禁止**把 File / Blob / FormData / base64 提交给 Customer create/update
 *   · 页面不得自行 fetch('/api/upload')，也不得解析 response.data.data.url
 */

/** 与后端 multer limit 一致（前端只做提前拦截，**不放宽**后端限制） */
export const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

/** 上传结果（url = 服务端相对地址，形如 /api/uploads/xxx.png） */
export interface UploadedFile {
  url: string;
  filename: string;
}

/** 上传前预检：仅 image/* 且 ≤ UPLOAD_MAX_BYTES（与后端 fileFilter / limits 对齐） */
export const isUploadableImage = (file: File): boolean =>
  file.type.startsWith('image/') && file.size <= UPLOAD_MAX_BYTES;

/** 上传单张图片（multipart/form-data，字段名固定为 `file`） */
export const uploadImage = async (file: File): Promise<UploadedFile> => {
  const formData = new FormData();
  formData.append('file', file);

  const response = await request.post('/upload', formData, {
    // 共享实例 timeout = 15s；10MB 图片在慢链路可能超时 ⇒ 仅本次请求放宽**传输**超时（业务限制不变）
    timeout: 60000,
  });

  const data = unwrapResponse<UploadedFile>(response, 'POST /upload').data;
  if (!data || typeof data.url !== 'string' || data.url === '') {
    throw new ResponseShapeError('上传响应缺少 data.url（POST /upload）');
  }
  return { url: data.url, filename: typeof data.filename === 'string' ? data.filename : '' };
};
