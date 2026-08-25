import { Router } from 'express';
import {
  getChannels,
  getChannelTree,
  getChannel,
  createChannel,
  updateChannel,
  deleteChannel,
} from '../controllers/channel.controller';

const router = Router();

router.get('/tree', getChannelTree);
router.get('/', getChannels);
router.get('/:id', getChannel);
router.post('/', createChannel);
router.put('/:id', updateChannel);
router.delete('/:id', deleteChannel);

export default router;
