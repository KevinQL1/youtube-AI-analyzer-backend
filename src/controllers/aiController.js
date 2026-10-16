import { askChannelAI, generateContentPackage } from '#services/aiService';

export const handleAskAI = async (req, res) => {
    try {
        const { question } = req.body;
        if (!question) {
            return res.status(400).json({ error: 'Debes enviar la propiedad "question" en el body.' });
        }
        const result = await askChannelAI(question);
        return res.status(200).json(result);
    } catch (error) {
        console.error('Error en aiController:', error);
        return res.status(500).json({ error: 'No se pudo procesar la consulta. Revisa la configuración del servidor e inténtalo de nuevo.' });
    }
};

export const handleGenerateContent = async (req, res) => {
    try {
        const result = await generateContentPackage(req.body?.request || req.body?.topic || '');
        return res.status(200).json(result);
    } catch (error) {
        console.error('Error generando paquete de contenido:', error);
        return res.status(500).json({ error: 'No se pudo generar el paquete de contenido.' });
    }
};
