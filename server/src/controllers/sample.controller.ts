import { Response } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';
import { success, created, fail } from '../utils/response';
import { activityLogger } from '../lib/activity-logger';

// 申请打样：可基于单个产品（targetType=PRODUCT）或产品组（targetType=GROUP）
const applySchema = z.object({
  targetType: z.enum(['PRODUCT', 'GROUP']).default('PRODUCT'),
  targetId: z.string().min(1, '目标 id 不能为空'),
  remark: z.string().nullish(),
});

export const applySample = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parsed = applySchema.parse(req.body);
    // 校验目标存在
    let targetName = '';
    if (parsed.targetType === 'PRODUCT') {
      const p = await prisma.product.findUnique({ where: { id: parsed.targetId }, select: { id: true, name: true, sku: true } });
      if (!p) {
        fail(res, 404, '产品不存在');
        return;
      }
      targetName = p.name;
    } else {
      const g = await prisma.productGroup.findUnique({ where: { id: parsed.targetId }, select: { id: true, name: true } });
      if (!g) {
        fail(res, 404, '产品组不存在');
        return;
      }
      targetName = g.name;
    }

    const sample = await prisma.sampleApply.create({
      data: {
        targetType: parsed.targetType,
        targetId: parsed.targetId,
        applicantId: req.userId || '',
        remark: parsed.remark ?? null,
        status: 'PENDING',
      },
    });

    const label = parsed.targetType === 'PRODUCT' ? '产品' : '产品组';
    void activityLogger.log({
      userId: req.userId || '',
      username: req.username || '',
      realName: req.realName,
      action: 'CREATE',
      module: 'sample-apply',
      targetId: parsed.targetId,
      target: targetName,
      detail: `对${label}「${targetName}」提交了打样申请`,
    });

    created(res, sample);
  } catch (err) {
    if (err instanceof z.ZodError) {
      fail(res, 400, err.errors.map((e) => e.message).join(', '));
      return;
    }
    fail(res, 500, '服务器错误');
  }
};

// 打样申请列表（可按状态/目标类型过滤）
export const getSampleApplies = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
    const where: Record<string, unknown> = {};
    if (req.query.status) where.status = req.query.status;
    if (req.query.targetType) where.targetType = req.query.targetType;

    const [list, total] = await Promise.all([
      prisma.sampleApply.findMany({
        where,
        include: {
          applicant: { select: { id: true, realName: true, username: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.sampleApply.count({ where }),
    ]);

    success(res, { list, total, page, pageSize });
  } catch {
    fail(res, 500, '服务器错误');
  }
};

// 更新打样申请状态：APPROVED / REJECTED / DONE
export const updateSampleStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = z.object({ status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'DONE']) }).parse(req.body);
    const existing = await prisma.sampleApply.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      fail(res, 404, '打样申请不存在');
      return;
    }
    const updated = await prisma.sampleApply.update({
      where: { id: req.params.id },
      data: { status: body.status },
    });
    const statusLabel: Record<string, string> = { PENDING: '待处理', APPROVED: '已通过', REJECTED: '已驳回', DONE: '已完成' };
    void activityLogger.log({
      userId: req.userId || '',
      username: req.username || '',
      realName: req.realName,
      action: 'UPDATE',
      module: 'sample-apply',
      targetId: existing.targetId,
      target: existing.targetId,
      detail: `将打样申请状态更新为「${statusLabel[body.status]}」`,
    });
    success(res, updated);
  } catch (err) {
    if (err instanceof z.ZodError) {
      fail(res, 400, err.errors.map((e) => e.message).join(', '));
      return;
    }
    fail(res, 500, '服务器错误');
  }
};
