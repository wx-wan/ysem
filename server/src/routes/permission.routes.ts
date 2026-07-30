import { Router } from 'express';
import { getPermissions, getPermissionTree, createPermission, updatePermission, deletePermission } from '../controllers/permission.controller';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.get('/', getPermissions);
router.get('/tree', getPermissionTree);
router.post('/', authorize('admin'), createPermission);
router.put('/:id', authorize('admin'), updatePermission);
router.delete('/:id', authorize('admin'), deletePermission);

export default router;
