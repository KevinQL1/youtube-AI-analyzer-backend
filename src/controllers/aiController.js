import { askChannelAI } from '#services/aiService';

export const handleAskAI = async (req, res) => {
    try {
        const { question } = req.body;
        if (!question) {
            return res.status(400).json({ error: 'Debes enviar la propiedad "question" en el body.' });
        }
        const result = await askChannelAI(question);
        return res.status(200).json(result);
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};