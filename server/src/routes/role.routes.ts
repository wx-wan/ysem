import { Router } from 'express';
import { getRoles, getRole, createRole, updateRole, deleteRole, assignPermissions } from '../controllers/role.controller';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

router.use(authenticate);
router.use(authorize('admin'));

router.get('/', getRoles);
router.get('/:id', getRole);
router.post('/', createRole);
router.put('/:id', updateRole);
router.delete('/:id', deleteRole);
router.post('/:id/permissions', assignPermissions);

export default router;
