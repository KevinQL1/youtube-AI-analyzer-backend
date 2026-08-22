import { Router } from 'express';
import { handleAskAI } from '#controllers/aiController';

const router = Router();
router.post('/ask', handleAskAI);

export default router;