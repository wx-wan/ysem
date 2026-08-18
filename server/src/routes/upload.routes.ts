import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { uploadSingle, handleUpload } from '../controllers/upload.controller';

const router = Router();

router.post('/', authenticate, uploadSingle, handleUpload);

export default router;
