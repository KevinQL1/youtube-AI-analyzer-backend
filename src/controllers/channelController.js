import { query } from '#db/index';

export const getChannelInfo = async (req, res) => {
    try {
        const result = await query('SELECT * FROM channels LIMIT 1');
        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'No hay información del canal guardada. Ejecuta /api/sync primero.' });
        }
        return res.status(200).json(result.rows[0]);
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};