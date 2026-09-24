import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import {
  getLeads,
  getLead,
  getLeadLogs,
  createLead,
  updateLead,
  deleteLead,
  deleteLeadAttachment,
  releaseLead,
  claimLead,
  transferLead,
} from '../controllers/lead.controller';

const router = Router();

router.get('/', authenticate, getLeads);
router.get('/:id', authenticate, getLead);
// 线索操作记录（操作日志）：业务用户可见自己数据范围内的线索，无需 system:logs 权限
router.get('/:id/logs', authenticate, getLeadLogs);
router.post('/', authenticate, createLead);
// 线索状态不接受人工修改（只由单据事件自动推进），故不再暴露 PATCH /:id/status
router.post('/:id/release', authenticate, releaseLead);
router.post('/:id/claim', authenticate, claimLead);
router.post('/:id/transfer', authenticate, transferLead);
router.put('/:id', authenticate, updateLead);
router.delete('/:id', authenticate, authorize('admin'), deleteLead);
// D1：线索参考图片附件（ownerType=LEAD）删除
router.delete('/:id/attachments/:attachmentId', authenticate, deleteLeadAttachment);

export default router;
