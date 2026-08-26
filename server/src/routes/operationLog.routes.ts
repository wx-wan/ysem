import { Router } from 'express';
import { getOperationLogs } from '../controllers/operationLog.controller';
import { authenticate, requirePerm } from '../middleware/auth';

const router = Router();
router.use(authenticate);
router.get('/', requirePerm("system:logs"), getOperationLogs);
export default router;
