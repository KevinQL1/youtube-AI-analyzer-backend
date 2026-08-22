import { syncChannelData } from '#services/syncService';

export const handleSyncChannel = async (req, res) => {
    try {
        const { channelId } = req.body;
        const result = await syncChannelData(channelId);
        return res.status(200).json(result);
    } catch (error) {
        console.error('Error en syncController:', error);
        return res.status(500).json({ error: error.message });
    }
};