import { Router } from 'express';
import { applySample, getSampleApplies, updateSampleStatus } from '../controllers/sample.controller';
import { authenticate } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.post('/', applySample);
router.get('/', getSampleApplies);
router.put('/:id/status', updateSampleStatus);

export default router;
