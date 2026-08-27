import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import {
  getLeads,
  getLead,
  createLead,
  updateLead,
  deleteLead,
  changeLeadStatus,
  releaseLead,
  transferLead,
} from '../controllers/lead.controller';

const router = Router();

router.get('/', authenticate, getLeads);
router.get('/:id', authenticate, getLead);
router.post('/', authenticate, createLead);
router.patch('/:id/status', authenticate, changeLeadStatus);
router.post('/:id/release', authenticate, releaseLead);
router.post('/:id/transfer', authenticate, transferLead);
router.put('/:id', authenticate, updateLead);
router.delete('/:id', authenticate, authorize('admin'), deleteLead);

export default router;
