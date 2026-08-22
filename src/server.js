import app from './app.js';
import { initDb } from '#db/index';
import { env } from '#config/env';
import { initCronJobs } from '#jobs/cronService';

const startServer = async () => {
    try {
        await initDb();

        // Inicializar las tareas programadas (Cron Jobs)
        initCronJobs();

        app.listen(env.port, () => {
            console.log(`🚀 Servidor corriendo en http://localhost:${env.port}`);
        });
    } catch (error) {
        console.error('❌ Error iniciando el servidor:', error);
    }
};

startServer();