import { Router } from 'express';
import { getDepartments, getDeptTree, getDepartment, createDepartment, updateDepartment, deleteDepartment } from '../controllers/department.controller';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.get('/', getDepartments);
router.get('/tree', getDeptTree);
router.get('/:id', getDepartment);
router.post('/', authorize('admin'), createDepartment);
router.put('/:id', authorize('admin'), updateDepartment);
router.delete('/:id', authorize('admin'), deleteDepartment);

export default router;
