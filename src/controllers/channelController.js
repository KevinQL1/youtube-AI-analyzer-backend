import { query } from '#db/index';
import { env } from '#config/env';

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

export const updateCreatorProfile = async (req, res) => {
    try {
        const channelId = req.body.channelId || env.channelId;
        if (!channelId) return res.status(400).json({ error: 'Configura CHANNEL_ID o envía channelId.' });
        const { niche, targetAudience, goals, preferredTone, uploadFrequency, notes } = req.body;
        const result = await query(
            `INSERT INTO creator_profiles (channel_id, niche, target_audience, goals, preferred_tone, upload_frequency, notes, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
             ON CONFLICT (channel_id) DO UPDATE SET
                niche = EXCLUDED.niche, target_audience = EXCLUDED.target_audience,
                goals = EXCLUDED.goals, preferred_tone = EXCLUDED.preferred_tone,
                upload_frequency = EXCLUDED.upload_frequency, notes = EXCLUDED.notes, updated_at = NOW()
             RETURNING *`,
            [channelId, niche || null, targetAudience || null, goals || null, preferredTone || null, uploadFrequency || null, notes || null]
        );
        return res.status(200).json(result.rows[0]);
    } catch (error) {
        return res.status(500).json({ error: 'No se pudo guardar el perfil del creador.' });
    }
};
