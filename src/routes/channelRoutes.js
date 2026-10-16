import { Router } from 'express';
import { getChannelInfo, updateCreatorProfile } from '#controllers/channelController';

const router = Router();

router.get('/', getChannelInfo);
router.put('/profile', updateCreatorProfile);

export default router;
