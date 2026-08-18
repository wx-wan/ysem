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

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('仅支持图片文件'));
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
