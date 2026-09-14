import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  listApprovalRecords,
  getApprovalRecord,
  submitApproval,
  approveApproval,
  rejectApproval,
  withdrawApproval,
} from '../controllers/approvalRecord.controller';

const router = Router();

// 审批流水：需登录；数据范围（ALL / DEPT / SELF）由 scope 工具在控制器内按业务对象 owner 施加
router.use(authenticate);

router.get('/', listApprovalRecords);
router.get('/:id', getApprovalRecord);

// 提交审批：:id 为业务单据 id（ApprovalRecord 由 submit 创建）
router.post('/submit', submitApproval);
router.post('/:id/submit', submitApproval);

router.post('/:id/approve', approveApproval);
router.post('/:id/reject', rejectApproval);
router.post('/:id/withdraw', withdrawApproval);

export default router;
