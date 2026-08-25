import { Router } from 'express';
import {
  getLeads,
  getLead,
  createLead,
  updateLead,
  deleteLead,
  changeLeadStatus,
} from '../controllers/lead.controller';

const router = Router();

router.get('/', getLeads);
router.get('/:id', getLead);
router.post('/', createLead);
router.patch('/:id/status', changeLeadStatus);
router.put('/:id', updateLead);
router.delete('/:id', deleteLead);

export default router;
