import { Router } from 'express';
import { handleAskAI, handleGenerateContent } from '#controllers/aiController';

const router = Router();
router.post('/ask', handleAskAI);
router.post('/content-package', handleGenerateContent);

export default router;
