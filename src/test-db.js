import { initDb, query } from '#db/index';

async function testConnection() {
    try {
        console.log('Probando conexión a PostgreSQL...');
        await initDb();
        const res = await query('SELECT NOW()');
        console.log('✅ Conexión exitosa. Hora del servidor DB:', res.rows[0].now);
        process.exit(0);
    } catch (err) {
        console.error('❌ Error conectando a la base de datos:', err.message);
        process.exit(1);
    }
}

testConnection();