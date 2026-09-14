import { Router } from 'express';
import { authenticate, requirePerm } from '../middleware/auth';
import {
  listApprovalConfigs,
  getApprovalConfig,
  createApprovalConfig,
  updateApprovalConfig,
  removeApprovalConfig,
} from '../controllers/approvalConfig.controller';

const router = Router();

// 审批配置属系统设置：读取需 system:approval，修改需 system:approval:edit
router.use(authenticate);

router.get('/', requirePerm('system:approval'), listApprovalConfigs);
router.get('/:bizType', requirePerm('system:approval'), getApprovalConfig);
router.post('/', requirePerm('system:approval:edit'), createApprovalConfig);
router.put('/:bizType', requirePerm('system:approval:edit'), updateApprovalConfig);
router.delete('/:bizType', requirePerm('system:approval:edit'), removeApprovalConfig);

export default router;
