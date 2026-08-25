import { Request, Response, NextFunction } from "express";
import { success, error } from "../utils/response";
import { AuthRequest } from "../middleware/auth";
import prisma from "../lib/prisma";

// 审批类型
const TYPES = ["QUOTE", "SAMPLE", "ORDER"];

// 列表（所有类型的审批配置）
export const list = async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const configs = await prisma.approvalConfig.findMany();
    // 补齐缺失类型，前端统一渲染
    const map = new Map(configs.map((c) => [c.type, c]));
    const full = TYPES.map((t) => map.get(t) || { type: t, approverIds: null, approverNames: null, enabled: false });
    success(res, full);
  } catch (err) {
    next(err);
  }
};

// 详情
export const getByType = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { type } = req.params;
    const cfg = await prisma.approvalConfig.findUnique({ where: { type } });
    if (!cfg) return error(res, "配置不存在", 404);
    success(res, cfg);
  } catch (err) {
    next(err);
  }
};

// 保存（upsert）
export const save = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { type, approverIds, approverNames, enabled } = req.body;
    if (!TYPES.includes(type)) return error(res, "不支持的审批类型", 400);

    const ids = Array.isArray(approverIds) ? approverIds : [];
    const names = Array.isArray(approverNames) ? approverNames : [];

    const data = {
      type,
      approverIds: JSON.stringify(ids),
      approverNames: JSON.stringify(names),
      enabled: enabled === undefined ? true : !!enabled,
    };

    const cfg = await prisma.approvalConfig.upsert({
      where: { type },
      create: { id: require("crypto").randomUUID(), ...data },
      update: data,
    });
    success(res, cfg, "保存成功");
  } catch (err) {
    next(err);
  }
};

// 删除（关闭该类型审批）
export const remove = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { type } = req.params;
    await prisma.approvalConfig.delete({ where: { type } }).catch(() => null);
    success(res, null, "已删除");
  } catch (err) {
    next(err);
  }
};
