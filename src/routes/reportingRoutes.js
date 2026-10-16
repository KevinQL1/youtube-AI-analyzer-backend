import { Router } from 'express';
import { reportingStatus, setupReporting, syncReporting } from '#controllers/reportingController';

const router = Router();
router.get('/status', reportingStatus);
router.post('/setup', setupReporting);
router.post('/sync', syncReporting);

export default router;
