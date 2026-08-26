import { Router } from 'express';
import { authenticate, requirePerm } from '../middleware/auth';
import {
  getChannels,
  getChannelTree,
  getChannel,
  createChannel,
  updateChannel,
  deleteChannel,
} from '../controllers/channel.controller';

const router = Router();

router.get('/tree', authenticate, getChannelTree);
router.get('/', authenticate, requirePerm('system:channel'), getChannels);
router.get('/:id', authenticate, requirePerm('system:channel'), getChannel);
router.post('/', authenticate, requirePerm('system:channel:edit'), createChannel);
router.put('/:id', authenticate, requirePerm('system:channel:edit'), updateChannel);
router.delete('/:id', authenticate, requirePerm('system:channel:edit'), deleteChannel);

export default router;
