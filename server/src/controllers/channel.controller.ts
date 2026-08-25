import { Response } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';
import { success, created, fail } from '../utils/response';

const channelSchema = z.object({
  name: z.string().min(1, '名称不能为空'),
  category: z.enum(['ONLINE', 'OFFLINE']).optional(),
  parentId: z.string().optional().nullable(),
  contact: z.string().trim().max(100).optional(),
  status: z.enum(['ENABLED', 'DISABLED']).optional(),
  sort: z.number().int().optional(),
  remark: z.string().trim().max(500).optional(),
});

// 全部渠道（用于下拉/级联选择）
export const getChannels = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const list = await prisma.channel.findMany({ orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }] });
    success(res, list);
  } catch {
    fail(res, 500, '服务器错误');
  }
};

// 树形结构：父节点(渠道) -> children(平台)
export const getChannelTree = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const list = await prisma.channel.findMany({ orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }] });
    const map = new Map<string, any>();
    list.forEach((c) => map.set(c.id, { ...c, children: [] as any[] }));
    const tree: any[] = [];
    map.forEach((node) => {
      if (node.parentId && map.has(node.parentId)) {
        map.get(node.parentId).children.push(node);
      } else {
        tree.push(node);
      }
    });
    success(res, tree);
  } catch {
    fail(res, 500, '服务器错误');
  }
};

export const getChannel = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const item = await prisma.channel.findUnique({ where: { id: req.params.id } });
    if (!item) {
      fail(res, 404, '渠道不存在');
      return;
    }
    success(res, item);
  } catch {
    fail(res, 500, '服务器错误');
  }
};

export const createChannel = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = channelSchema.parse(req.body);
    // 子级(平台)自动继承父级类别
    let category = data.category ?? 'ONLINE';
    if (data.parentId) {
      const parent = await prisma.channel.findUnique({ where: { id: data.parentId } });
      if (parent) category = parent.category as 'ONLINE' | 'OFFLINE';
    }
    const item = await prisma.channel.create({
      data: {
        name: data.name,
        category,
        parentId: data.parentId ?? null,
        contact: data.contact ?? null,
        status: data.status ?? 'ENABLED',
        sort: data.sort ?? 0,
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

export const updateChannel = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = channelSchema.partial().parse(req.body);
    const update: Record<string, unknown> = { ...data };
    if (data.parentId === null) update.parentId = null;
    await prisma.channel.update({ where: { id: req.params.id }, data: update });
    success(res, null, '更新成功');
  } catch (err) {
    if (err instanceof z.ZodError) {
      fail(res, 400, err.errors.map((e) => e.message).join(', '));
      return;
    }
    fail(res, 500, '服务器错误');
  }
};

export const deleteChannel = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // 删除父级时级联删除子平台
    await prisma.channel.delete({ where: { id: req.params.id } });
    success(res, null, '删除成功');
  } catch {
    fail(res, 500, '服务器错误');
  }
};
