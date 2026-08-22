import { getTopVideos, compareGames, compareShortsVsVods } from '#services/analyticsService';

export const handleGetTopVideos = async (req, res) => {
    try {
        const { type, limit } = req.query;
        const videos = await getTopVideos(type, limit ? parseInt(limit, 10) : 10);
        return res.status(200).json(videos);
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};

export const handleCompareGames = async (req, res) => {
    try {
        const { game1 = 'Minecraft', game2 = 'Fortnite' } = req.query;
        const comparison = await compareGames(game1, game2);
        return res.status(200).json(comparison);
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};

export const handleCompareFormat = async (req, res) => {
    try {
        const performance = await compareShortsVsVods();
        return res.status(200).json(performance);
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};