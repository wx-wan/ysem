import { Router } from 'express';
import { authenticate, requirePerm } from '../middleware/auth';
import {
  getCertificates, getCertificate, createCertificate, updateCertificate, deleteCertificate,
} from '../controllers/certificate.controller';

const router = Router();

router.get('/', authenticate, getCertificates);
router.get('/:id', authenticate, getCertificate);
router.post('/', authenticate, requirePerm('certificate:create'), createCertificate);
router.put('/:id', authenticate, requirePerm('certificate:update'), updateCertificate);
router.delete('/:id', authenticate, requirePerm('certificate:delete'), deleteCertificate);

export default router;
