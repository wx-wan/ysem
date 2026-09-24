import { Router } from 'express';
import { authenticate, requirePerm } from '../middleware/auth';
import {
  getActiveCommTools,
  getAllCommTools,
  getCommTool,
  createCommTool,
  updateCommTool,
  deleteCommTool,
  updateCommToolSort,
} from '../controllers/commTool.controller';

const router = Router();

router.get('/active', authenticate, getActiveCommTools);
router.get('/', authenticate, requirePerm('system:comm-tool'), getAllCommTools);
router.get('/:id', authenticate, requirePerm('system:comm-tool'), getCommTool);
router.post('/', authenticate, requirePerm('system:comm-tool:edit'), createCommTool);
router.put('/sort', authenticate, requirePerm('system:comm-tool:edit'), updateCommToolSort);
router.put('/:id', authenticate, requirePerm('system:comm-tool:edit'), updateCommTool);
router.delete('/:id', authenticate, requirePerm('system:comm-tool:edit'), deleteCommTool);

export default router;
