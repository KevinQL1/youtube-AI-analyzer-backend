import Groq from 'groq-sdk';
import { env } from '#config/env';
import { query } from '#db/index';
import { syncChannelData } from '#services/syncService';

const groq = new Groq({ apiKey: env.groqApiKey });
const isRefreshRequest = (text) => /\b(actualiza|actualizar|actualízame|actualizame|sincroniza|sincronizar|refresca|refresh)\b.{0,80}\b(base de datos|datos|información|informacion|canal|youtube)?/i.test(text) || /\b(base de datos|datos|información|informacion)\b.{0,60}\b(actualizada|actualizar|al día|al dia|fresca)\b/i.test(text);

// Esquema enriquecido con reglas avanzadas de retención y detección de anomalías
const SCHEMA_CONTEXT = `
Tablas de PostgreSQL disponibles:
1. channels (channel_id, title, subscribers, total_views, total_videos, updated_at)
2. channel_analytics_daily (channel_id, record_date, subscribers, total_views, total_videos)
3. creator_profiles (channel_id, niche, target_audience, goals, preferred_tone, upload_frequency, notes, updated_at)
4. conversation_messages (channel_id, role, content, created_at)
5. playlists (playlist_id, channel_id, title, description, item_count, published_at, updated_at)
6. playlist_items (playlist_id, video_id, position)
7. videos (video_id, channel_id, title, description, tags [TEXT[]], published_at, scheduled_at, publication_status ['published' | 'scheduled' | 'private' | 'unlisted'], duration_seconds, privacy_status, thumbnail_url, likes, comments, views, content_type ['shorts' | 'videoOnDemand'], updated_at)
8. video_analytics_daily (video_id, record_date, views, likes, comments, subscribers_gained, subscribers_lost, estimated_minutes_watched, average_view_duration_seconds)

MÉTRICAS CLAVE Y REGLAS SQL OBLIGATORIAS:
- PORCENTAJE DE RETENCIÓN (% Watched): 
  Calcula siempre: ROUND((a.average_view_duration_seconds::numeric / NULLIF(v.duration_seconds, 0)) * 100, 2) AS retention_percentage
  Un % > 50% en videos largos es EXCELENTE. En Shorts, un % > 80-90% es lo ideal.
- DETECCIÓN DE OUTLIERS / VIRALES:
  No te fíes solo del promedio (AVG), ya que los videos virales lo distorsionan. Utiliza MEDIAN(views) o compara las vistas de un video con la mediana del canal.
- RELACIÓN DE ENGAGEMENT:
  Calcula likes por vista: ROUND((v.likes::numeric / NULLIF(v.views, 0)) * 100, 2) AS engagement_like_rate
- SERIES Y PLAYLISTS:
  Haz JOIN de 'videos' con 'playlist_items' y 'playlists'.
- TAGS:
  Para agrupar por etiquetas usa unnest(tags).
`;

export const askChannelAI = async (userQuestion) => {
    let syncResult = null;
    if (isRefreshRequest(userQuestion)) syncResult = await syncChannelData();

    const channelSnapshot = await query(`
        SELECT c.*, COUNT(v.video_id)::int AS stored_video_count,
               COALESCE(SUM(v.views), 0)::bigint AS stored_video_views,
               COALESCE(SUM(v.likes), 0)::bigint AS stored_video_likes,
               COALESCE(SUM(v.comments), 0)::bigint AS stored_video_comments
        FROM channels c
        LEFT JOIN videos v ON v.channel_id = c.channel_id
        GROUP BY c.channel_id
        ORDER BY c.updated_at DESC
        LIMIT 1
    `);
    const channelContext = channelSnapshot.rows[0] || null;
    const profileSnapshot = channelContext
        ? await query('SELECT niche, target_audience, goals, preferred_tone, upload_frequency, notes, updated_at FROM creator_profiles WHERE channel_id = $1', [channelContext.channel_id])
        : { rows: [] };
    const creatorProfile = profileSnapshot.rows[0] || null;
    const historySnapshot = channelContext
        ? await query('SELECT role, content, created_at FROM conversation_messages WHERE channel_id = $1 ORDER BY created_at DESC LIMIT 12', [channelContext.channel_id])
        : { rows: [] };
    const conversationHistory = historySnapshot.rows.reverse();

    // 1. Generar la consulta SQL optimizada para analítica de crecimiento
    const sqlCompletion = await groq.chat.completions.create({
        messages: [
            {
                role: 'system',
                content: `Eres un DBA Principal y Data Scientist de YouTube Analytics.
                Tu tarea es traducir la pregunta del usuario a una consulta SQL de PostgreSQL altamente eficiente usando este esquema:
                ${SCHEMA_CONTEXT}

                REGLAS CRÍTICAS DE SINTAXIS Y FORMATO:
                1. Retorna ÚNICAMENTE la consulta SQL pura en texto plano (sin bloques markdown \`\`\`sql).
                2. NUNCA respondas con texto conversacional, saludos ni explicaciones. SIEMPRE debes retornar únicamente código SQL ejecutable.
                3. Si el usuario saluda, hace pruebas o no pide nada analítico concreto, devuelve una consulta simple como: SELECT title, total_views, subscribers FROM channels LIMIT 1;
                4. NO INCLUYAS COMENTARIOS en el código SQL (prohibido usar '--' o '/* */').
                5. La columna 'video_id' es de tipo TEXT. Si usas NULL en UNION ALL para video_id, usa NULL::text (NUNCA NULL::uuid).
                6. Mantén las consultas simples y directas.`
            },
            {
                role: 'user',
                content: userQuestion
            }
        ],
        model: 'openai/gpt-oss-120b',
        temperature: 0,
    });

    let generatedSql = sqlCompletion.choices[0]?.message?.content?.trim().replace(/```sql|```/g, '');

    // Limpieza de comentarios en línea para evitar rotura de sintaxis
    generatedSql = generatedSql
        .split('\n')
        .filter(line => !line.trim().startsWith('--'))
        .join('\n');

    // Validación básica: comprobar que el texto generado empiece con una instrucción SQL
    const normalizedSql = generatedSql.trim();
    const hasOnlyOneStatement = !normalizedSql.slice(0, -1).includes(';');
    const isSql = normalizedSql.length <= 12000 && hasOnlyOneStatement &&
        /^(SELECT|WITH|SHOW|EXPLAIN)\b/i.test(normalizedSql) &&
        !/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE|COPY|DO)\b/i.test(normalizedSql);
    if (!isSql) {
        generatedSql = 'SELECT title, total_views, subscribers FROM channels LIMIT 1;';
    }

    // 2. Ejecutar la consulta en la BD
    let dbData;
    try {
        const dbResult = await query(generatedSql);
        dbData = dbResult.rows;
    } catch (dbError) {
        console.error(`❌ [Error SQL]: ${dbError.message} | Query:\n${generatedSql}`);
        throw new Error(`Error en la consulta SQL generada (${generatedSql}): ${dbError.message}`);
    }

    // 3. Sintetizar la respuesta como Senior YouTube Growth Consultant
    const answerCompletion = await groq.chat.completions.create({
        messages: [
            {
                role: 'system',
                content: `Eres el "Head of Growth" del canal de YouTube. Tu objetivo es ayudar al creador a escalar el canal basándote en los datos reales extraídos.

                INSTRUCCIONES DE RESPUESTA:
                El resumen del canal incluye suscriptores, vistas totales, cantidad de videos y fecha de actualización. Menciónalos cuando respondan a la pregunta y nunca los confundas con las vistas sumadas de videos.
                Tambien eres experto en ideas de contenido, titulos, miniaturas, guiones, SEO, calendario editorial, Shorts, comunidad y monetizacion. No inventes metricas ni prometas viralidad.
                - Si el mensaje del usuario era un saludo o una prueba, responde amablemente indicando que estás listo para analizar su canal.
                - Analiza la RETENCIÓN (% consumido): Si la retención es baja (<30%), advierte que el problema está en el gancho o la estructura del video.
                - Identifica OUTLIERS: Señala si un video triunfó por suerte/tema puntual o si es un patrón repetible.
                - Sé directo, estratégico y basado en datos. Ofrece siempre 2-3 ACCIONES CONCRETAS para el próximo video o playlist.`
            },
            {
                role: 'user',
                content: `Pregunta del creador: "${userQuestion}"\n\n${syncResult ? `Sincronizacion terminada: ${syncResult.totalVideosSynced} videos procesados. ` : ''}Resumen actual del canal (usa estos datos siempre que sean relevantes):\n${JSON.stringify(channelContext, null, 2)}\n\nPerfil y objetivos del creador:\n${JSON.stringify(creatorProfile, null, 2)}\n\nConversacion reciente (usala solo para mantener continuidad):\n${JSON.stringify(conversationHistory, null, 2)}\n\nDatos de la consulta:\n${JSON.stringify(dbData, null, 2)}`
            }
        ],
        model: 'openai/gpt-oss-120b',
        temperature: 0.4,
    });

    if (channelContext?.channel_id) {
        await query('INSERT INTO conversation_messages (channel_id, role, content) VALUES ($1, $2, $3), ($1, $4, $5)', [channelContext.channel_id, 'user', userQuestion, 'assistant', answerCompletion.choices[0]?.message?.content || '']);
    }

    return {
        question: userQuestion,
        answer: answerCompletion.choices[0]?.message?.content,
        sqlUsed: generatedSql,
        data: dbData,
        sync: syncResult,
    };
};

export const generateContentPackage = async (request = '') => {
    const winners = await query(`
        SELECT title, description, views, likes, comments, duration_seconds, content_type, published_at
        FROM videos
        WHERE privacy_status = 'public'
        ORDER BY views DESC, likes DESC
        LIMIT 15
    `);
    const completion = await groq.chat.completions.create({
        messages: [
            {
                role: 'system',
                content: `Eres un estratega senior de YouTube. Estudia los videos ganadores proporcionados y crea un paquete accionable. No copies títulos literalmente ni inventes datos. Devuelve JSON válido con estas claves: concept, targetAudience, hook, titles (5 opciones), thumbnailIdeas (3 opciones con texto corto), outline (secciones del guion), shortVersion, description, hashtags, successMetric. Explica en successMetric qué métrica se debe observar.`
            },
            {
                role: 'user',
                content: `Solicitud del creador: ${request || 'Propón el próximo contenido con mayor potencial.'}\n\nVideos ganadores del canal:\n${JSON.stringify(winners.rows, null, 2)}`
            }
        ],
        model: 'openai/gpt-oss-120b',
        temperature: 0.7,
    });
    const raw = completion.choices[0]?.message?.content?.trim() || '{}';
    let packageData;
    try {
        packageData = JSON.parse(raw.replace(/^```json\s*|\s*```$/g, ''));
    } catch {
        packageData = { raw: raw };
    }
    return { request, basedOnVideos: winners.rows, content: packageData };
};
