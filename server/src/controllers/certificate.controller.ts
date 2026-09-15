import { Response } from 'express';
import { z } from 'zod';
import { MasterStatus, Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';
import { success, created, fail } from '../utils/response';

const certificateSchema = z.object({
  name: z.string().min(1, '证书名称不能为空'),
  code: z.string().trim().max(50).optional(),
  issuer: z.string().trim().max(100).optional(),
  category: z.string().trim().max(50).optional(),
  validUntil: z.string().optional(), // ISO 字符串，可选
  status: z.nativeEnum(MasterStatus).optional(),
  remark: z.string().trim().max(500).optional(),
  logo: z.string().trim().max(500).optional(),
});

// 列表（不分页，证书数量有限）
export const getCertificates = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const list = await prisma.certificate.findMany({ orderBy: [{ createdAt: 'asc' }] });
    success(res, list);
  } catch {
    fail(res, 500, '服务器错误');
  }
};

export const getCertificate = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const item = await prisma.certificate.findUnique({ where: { id: req.params.id } });
    if (!item) {
      fail(res, 404, '证书不存在');
      return;
    }
    success(res, item);
  } catch {
    fail(res, 500, '服务器错误');
  }
};

export const createCertificate = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = certificateSchema.parse(req.body);
    const item = await prisma.certificate.create({
      data: {
        name: data.name,
        code: data.code ?? null,
        issuer: data.issuer ?? null,
        category: data.category ?? null,
        validUntil: data.validUntil ? new Date(data.validUntil) : null,
        status: data.status ?? MasterStatus.ACTIVE,
        remark: data.remark ?? null,
      },
    });
    created(res, item);
  } catch (err) {
    if (err instanceof z.ZodError) {
      fail(res, 400, err.errors.map((e) => e.message).join(', '));
      return;
    }
    fail(res, 500, '服务器错误');
  }
};

export const updateCertificate = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { validUntil, ...rest } = certificateSchema.partial().parse(req.body);
    // 类型化 payload：Record<string, unknown> 会擦除 status 的 MasterStatus 校验，
    // 使 1 / 0 绕过 TypeScript 直达 Prisma
    const update: Prisma.CertificateUncheckedUpdateInput = { ...rest };
    if (validUntil !== undefined) {
      update.validUntil = validUntil ? new Date(validUntil) : null;
    }
    await prisma.certificate.update({ where: { id: req.params.id }, data: update });
    success(res, null, '更新成功');
  } catch (err) {
    if (err instanceof z.ZodError) {
      fail(res, 400, err.errors.map((e) => e.message).join(', '));
      return;
    }
    fail(res, 500, '服务器错误');
  }
};

export const deleteCertificate = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await prisma.certificate.delete({ where: { id: req.params.id } });
    success(res, null, '删除成功');
  } catch {
    fail(res, 500, '服务器错误');
  }
};
