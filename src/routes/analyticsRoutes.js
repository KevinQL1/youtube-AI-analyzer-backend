import { Router } from 'express';
import {
    handleGetTopVideos,
    handleCompareGames,
    handleCompareFormat,
} from '#controllers/analyticsController';

const router = Router();

router.get('/top', handleGetTopVideos);
router.get('/compare-games', handleCompareGames);
router.get('/compare-format', handleCompareFormat);

export default router;