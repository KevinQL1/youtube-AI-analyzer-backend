import cron from 'node-cron';
import { syncChannelData } from '#services/syncService';
import { env } from '#config/env';

// ID del canal por defecto o configurable vía .env
const CHANNEL_ID = env.channelId;

export const initCronJobs = () => {
    // Expresión Cron: Todos los domingos a las 00:00 AM ('0 0 * * 0')
    cron.schedule('0 0 * * 0', async () => {
        console.log('⏰ Ejecutando tarea programada: Sincronización semanal de YouTube...');
        try {
            const result = await syncChannelData(CHANNEL_ID);
            console.log(`✅ Sincronización semanal completada con éxito. Vídeos procesados: ${result.totalVideosSynced}`);
        } catch (error) {
            console.error('❌ Error en la sincronización semanal automática:', error.message);
        }
    });

    console.log('📅 Tarea programada registrada: Se ejecutará automáticamente cada domingo a las 00:00.');
};