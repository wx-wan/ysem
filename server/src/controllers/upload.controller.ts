import { Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

// 上传根目录：server/uploads（与运行时 cwd 一致）
export const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads');

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.png';
    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    cb(null, name);
  },
});

// 允许上传的图片与常见附件类型（PDF / Office 文档 / 文本 / 压缩包）
const ALLOWED_MIME = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'application/zip',
  'application/x-zip-compressed',
];

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB（附件可能大于图片）
  fileFilter: (_req, file, cb) => {
    const ok = file.mimetype.startsWith('image/') || ALLOWED_MIME.includes(file.mimetype);
    if (ok) cb(null, true);
    else cb(new Error('不支持的文件类型'));
  },
});

export const uploadSingle = upload.single('file');

export const handleUpload = (req: Request, res: Response) => {
  const file = (req as Request & { file?: Express.Multer.File }).file;
  if (!file) {
    return res.status(400).json({ code: 400, message: '未接收到文件', data: null });
  }
  const url = `/api/uploads/${file.filename}`;
  return res.json({ code: 0, message: 'ok', data: { url, filename: file.filename } });
};
