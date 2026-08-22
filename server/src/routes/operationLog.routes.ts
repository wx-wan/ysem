import { Router } from 'express';
import { getOperationLogs } from '../controllers/operationLog.controller';
import { authenticate } from '../middleware/auth';

const router = Router();
router.use(authenticate);
router.get('/', getOperationLogs);
export default router;
