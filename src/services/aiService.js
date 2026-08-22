import Groq from 'groq-sdk';
import { env } from '#config/env';
import { query } from '#db/index';

const groq = new Groq({ apiKey: env.groqApiKey });

// Esquema enriquecido con reglas avanzadas de retención y detección de anomalías
const SCHEMA_CONTEXT = `
Tablas de PostgreSQL disponibles:
1. channels (channel_id, title, subscribers, total_views, total_videos, updated_at)
2. playlists (playlist_id, channel_id, title, description, item_count, published_at, updated_at)
3. playlist_items (playlist_id, video_id, position)
4. videos (video_id, channel_id, title, description, tags [TEXT[]], published_at, duration_seconds, privacy_status, thumbnail_url, likes, comments, views, content_type ['shorts' | 'videoOnDemand'], updated_at)
5. video_analytics_daily (video_id, record_date, views, likes, comments, subscribers_gained, subscribers_lost, estimated_minutes_watched, average_view_duration_seconds)

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
    const isSql = /^(SELECT|WITH|SHOW|EXPLAIN)\b/i.test(generatedSql.trim());
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
                - Si el mensaje del usuario era un saludo o una prueba, responde amablemente indicando que estás listo para analizar su canal.
                - Analiza la RETENCIÓN (% consumido): Si la retención es baja (<30%), advierte que el problema está en el gancho o la estructura del video.
                - Identifica OUTLIERS: Señala si un video triunfó por suerte/tema puntual o si es un patrón repetible.
                - Sé directo, estratégico y basado en datos. Ofrece siempre 2-3 ACCIONES CONCRETAS para el próximo video o playlist.`
            },
            {
                role: 'user',
                content: `Pregunta del creador: "${userQuestion}"\n\nDatos de la Base de Datos:\n${JSON.stringify(dbData, null, 2)}`
            }
        ],
        model: 'openai/gpt-oss-120b',
        temperature: 0.4,
    });

    return {
        question: userQuestion,
        answer: answerCompletion.choices[0]?.message?.content,
        sqlUsed: generatedSql,
        data: dbData,
    };
};