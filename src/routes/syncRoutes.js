import { Router } from 'express';
import { handleSyncChannel } from '#controllers/syncController';

const router = Router();

router.post('/', handleSyncChannel);

export default router;