import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import {
  getLeads,
  getLead,
  createLead,
  updateLead,
  deleteLead,
  deleteLeadAttachment,
  changeLeadStatus,
  releaseLead,
  claimLead,
  transferLead,
} from '../controllers/lead.controller';

const router = Router();

router.get('/', authenticate, getLeads);
router.get('/:id', authenticate, getLead);
router.post('/', authenticate, createLead);
router.patch('/:id/status', authenticate, changeLeadStatus);
router.post('/:id/release', authenticate, releaseLead);
router.post('/:id/claim', authenticate, claimLead);
router.post('/:id/transfer', authenticate, transferLead);
router.put('/:id', authenticate, updateLead);
router.delete('/:id', authenticate, authorize('admin'), deleteLead);
// D1：线索参考图片附件（ownerType=LEAD）删除
router.delete('/:id/attachments/:attachmentId', authenticate, deleteLeadAttachment);

export default router;
