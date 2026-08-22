import { Router } from 'express';
import { createQuote, getQuotes, getQuoteById, updateQuoteStatus } from '../controllers/quote.controller';
import { authenticate } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.post('/', createQuote);
router.get('/', getQuotes);
router.get('/:id', getQuoteById);
router.put('/:id/status', updateQuoteStatus);

export default router;
