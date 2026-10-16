import Groq from 'groq-sdk';
import { env } from '#config/env';
import { query } from '#db/index';
import { syncChannelData } from '#services/syncService';

const groq = new Groq({ apiKey: env.groqApiKey });
const isRefreshRequest = (text) => /\b(actualiza|actualizar|actualízame|actualizame|sincroniza|sincronizar|refresca|refresh)\b.{0,80}\b(base de datos|datos|información|informacion|canal|youtube)?/i.test(text) || /\b(base de datos|datos|información|informacion)\b.{0,60}\b(actualizada|actualizar|al día|al dia|fresca)\b/i.test(text);

// Esquema enriquecido con reglas avanzadas de retención y detección de anomalías
// Detecta respuestas truncadas antes de enviarlas a PostgreSQL. El modelo puede
// cortar una consulta larga a mitad de un CTE, dejando paréntesis sin cerrar.
const hasBalancedParentheses = (sql) => {
    let depth = 0;
    let inString = false;
    for (let index = 0; index < sql.length; index += 1) {
        const char = sql[index];
        if (char === "'") {
            if (inString && sql[index + 1] === "'") index += 1;
            else inString = !inString;
        } else if (!inString && char === '(') {
            depth += 1;
        } else if (!inString && char === ')') {
            depth -= 1;
            if (depth < 0) return false;
        }
    }
    return !inString && depth === 0;
};

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
               COALESCE(SUM(v.comments), 0)::bigint AS stored_video_comments,
               MIN(v.published_at) AS oldest_video_published_at,
               MAX(v.published_at) AS newest_video_published_at,
               MIN(v.published_at)::date AS oldest_video_date,
               MAX(v.published_at)::date AS newest_video_date,
               MIN((v.published_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Bogota'))::date AS oldest_video_bogota_date,
               MAX((v.published_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Bogota'))::date AS newest_video_bogota_date,
               COUNT(v.video_id) FILTER (WHERE v.publication_status = 'published')::int AS published_video_count,
               COUNT(v.video_id) FILTER (WHERE v.publication_status = 'scheduled')::int AS scheduled_video_count,
               COUNT(v.video_id) FILTER (WHERE v.content_type = 'shorts')::int AS shorts_count,
               COUNT(v.video_id) FILTER (WHERE v.content_type = 'videoOnDemand')::int AS long_videos_count
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
    const analyticsSnapshot = channelContext
        ? await query(`
            SELECT
              COUNT(DISTINCT v.video_id)::int AS videos_with_analytics,
              COUNT(va.video_id)::int AS analytics_rows,
              ROUND(AVG((va.average_view_duration_seconds::numeric / NULLIF(v.duration_seconds, 0)) * 100) FILTER (WHERE v.duration_seconds > 0), 2) AS avg_retention_percentage,
              ROUND(AVG((va.average_view_duration_seconds::numeric / NULLIF(v.duration_seconds, 0)) * 100) FILTER (WHERE v.content_type = 'videoOnDemand' AND v.duration_seconds > 0), 2) AS avg_retention_long_videos,
              ROUND(AVG((va.average_view_duration_seconds::numeric / NULLIF(v.duration_seconds, 0)) * 100) FILTER (WHERE v.content_type = 'shorts' AND v.duration_seconds > 0), 2) AS avg_retention_shorts,
              COALESCE(SUM(va.views), 0)::bigint AS analytics_views,
              COALESCE(SUM(va.estimated_minutes_watched), 0)::numeric AS estimated_minutes_watched,
              COALESCE(SUM(va.subscribers_gained), 0)::int AS subscribers_gained,
              COALESCE(SUM(va.subscribers_lost), 0)::int AS subscribers_lost,
              MAX(va.record_date) AS latest_analytics_date
            FROM videos v
            LEFT JOIN video_analytics_daily va ON v.video_id = va.video_id
            WHERE v.channel_id = $1 AND v.publication_status = 'published'
        `, [channelContext.channel_id])
        : { rows: [] };
    const analyticsSummary = analyticsSnapshot.rows[0] || null;
    const reachSnapshot = await query(`
        SELECT COUNT(*)::int AS reach_rows,
               COALESCE(SUM(impressions), 0)::bigint AS impressions,
               ROUND(AVG(impressions_ctr)::numeric, 2) AS average_ctr,
               MAX(report_date) AS latest_reach_date
        FROM youtube_reach_daily
    `);
    const reachSummary = reachSnapshot.rows[0] || null;
    const insightsSnapshot = channelContext
        ? await query(`
            SELECT insight_type, period_start, period_end, data, updated_at
            FROM channel_analytics_insights
            WHERE channel_id = $1
            ORDER BY updated_at DESC
        `, [channelContext.channel_id])
        : { rows: [] };
    const topVideoAnalyticsSnapshot = channelContext
        ? await query(`
            SELECT v.video_id, v.title, v.content_type, v.views, v.likes, v.comments,
                   v.duration_seconds,
                   ROUND(AVG(va.average_view_duration_seconds)::numeric, 2) AS average_view_duration_seconds,
                   ROUND((AVG(va.average_view_duration_seconds)::numeric / NULLIF(v.duration_seconds, 0)) * 100, 2) AS retention_percentage,
                   COALESCE(SUM(va.views), 0)::bigint AS analytics_views,
                   COALESCE(SUM(va.estimated_minutes_watched), 0)::numeric AS estimated_minutes_watched,
                   COALESCE(SUM(va.subscribers_gained), 0)::int AS subscribers_gained,
                   COALESCE(SUM(va.subscribers_lost), 0)::int AS subscribers_lost
            FROM videos v
            LEFT JOIN video_analytics_daily va ON v.video_id = va.video_id
            WHERE v.channel_id = $1 AND v.publication_status = 'published'
            GROUP BY v.video_id, v.title, v.content_type, v.views, v.likes, v.comments, v.duration_seconds
            ORDER BY v.views DESC
            LIMIT 20
        `, [channelContext.channel_id])
        : { rows: [] };
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
        max_tokens: 1800,
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
    const hasInvalidArraySlice = /\]\s*:\s*\d/.test(normalizedSql);
    const isSql = normalizedSql.length <= 12000 && !hasInvalidArraySlice && hasBalancedParentheses(normalizedSql) && hasOnlyOneStatement &&
        /^(SELECT|WITH|SHOW|EXPLAIN)\b/i.test(normalizedSql) &&
        !/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE|COPY|DO)\b/i.test(normalizedSql);
    if (!isSql) {
        generatedSql = 'SELECT title, total_views, subscribers FROM channels LIMIT 1;';
    }

    // 2. Ejecutar la consulta en la BD
    let dbData;
    try {
        // Las consultas generadas suelen filtrar por el canal usando $1. Ese
        // valor debe enviarse por separado para que node-postgres lo resuelva.
        const sqlParams = /\$1\b/.test(generatedSql) && channelContext?.channel_id
            ? [channelContext.channel_id]
            : [];
        const dbResult = await query(generatedSql, sqlParams);
        dbData = dbResult.rows;
    } catch (dbError) {
        console.error(`❌ [Error SQL]: ${dbError.message} | Query:\n${generatedSql}`);
        // Una consulta generada puede ser válida en intención pero contener
        // sintaxis que PostgreSQL no acepta. Usamos un resumen seguro como
        // respaldo para que el chat pueda continuar respondiendo.
        generatedSql = `SELECT c.title, c.subscribers, c.total_views, c.total_videos, c.updated_at,
                               MIN(v.published_at) AS oldest_video_published_at,
                               MAX(v.published_at) AS newest_video_published_at,
                               MIN(v.published_at)::date AS oldest_video_date,
                               MAX(v.published_at)::date AS newest_video_date,
                               MIN((v.published_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Bogota'))::date AS oldest_video_bogota_date,
                               MAX((v.published_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Bogota'))::date AS newest_video_bogota_date,
                               COUNT(v.video_id) FILTER (WHERE v.publication_status = 'published')::int AS published_video_count,
                               COUNT(v.video_id) FILTER (WHERE v.publication_status = 'scheduled')::int AS scheduled_video_count,
                               COUNT(v.video_id) FILTER (WHERE v.content_type = 'shorts')::int AS shorts_count,
                               COUNT(v.video_id) FILTER (WHERE v.content_type = 'videoOnDemand')::int AS long_videos_count
                        FROM channels c
                        LEFT JOIN videos v ON v.channel_id = c.channel_id
                        WHERE c.channel_id = $1
                        GROUP BY c.channel_id;`;
        const fallbackResult = await query(generatedSql, [channelContext.channel_id]);
        dbData = fallbackResult.rows;
    }

    // Reducimos el contexto variable para respetar el límite de tokens de Groq.
    const compactHistory = conversationHistory.slice(-6).map((message) => ({
        role: message.role,
        content: String(message.content || '').slice(0, 700),
        created_at: message.created_at,
    }));
    const compactDbData = Array.isArray(dbData) ? dbData.slice(0, 30) : dbData;

    // 3. Sintetizar la respuesta como Senior YouTube Growth Consultant
    const answerCompletion = await groq.chat.completions.create({
        messages: [
            {
                role: 'system',
                content: `Eres el "Head of Growth" del canal de YouTube. Tu objetivo es ayudar al creador a escalar el canal basándote en los datos reales extraídos.

                INSTRUCCIONES DE RESPUESTA:
                El resumen del canal incluye suscriptores, vistas totales, cantidad de videos y fecha de actualización. Menciónalos cuando respondan a la pregunta y nunca los confundas con las vistas sumadas de videos.
                Tambien eres experto en ideas de contenido, titulos, miniaturas, guiones, SEO, calendario editorial, Shorts, comunidad y monetizacion. No inventes metricas ni prometas viralidad.
                Usa siempre oldest_video_bogota_date y newest_video_bogota_date para calcular la antiguedad y el periodo real de actividad. Nunca asumas que el canal tiene uno o dos años por el numero de videos.
                El bloque analyticsSummary contiene métricas calculadas directamente en PostgreSQL. Si videos_with_analytics es mayor que cero, usa esas métricas para el diagnóstico.
                El bloque audienceInsights contiene fuentes de tráfico y demografía agregada. Úsalo cuando exista y menciona si YouTube lo entregó con umbral o sin filas.
                El bloque topVideoAnalyticsSnapshot contiene métricas por video; úsalo para señalar títulos, videos destacados y diferencias entre Shorts y videos largos. No detengas el diagnóstico por una métrica que el API no entregue: explica la limitación en una sola frase y continúa con los datos disponibles.
                Si una métrica no aparece en los datos recibidos (por ejemplo CTR, impresiones o retención), dilo claramente como dato no disponible y no la sustituyas por porcentajes inventados ni hipótesis presentadas como hechos.
                Si average_view_duration_seconds o retention_percentage tienen valor para un video, no digas que el tiempo medio de visualización está ausente; indica solo qué videos no tienen filas de Analytics.
                No afirmes que una duración concreta garantiza una retención determinada. Presenta las duraciones como hipótesis de prueba basadas en los datos del canal.
                Cuando no haya demografía o fuentes de tráfico, explica que YouTube puede ocultar datos por umbrales de privacidad o volumen. No recomiendes activar una supuesta audiencia avanzada.
                El bloque Datos faltantes debe ocupar como máximo dos viñetas y no debe dominar el diagnóstico. Continúa con recomendaciones basadas en las métricas disponibles.
                No uses objetivos arbitrarios como "superar 4% de retención". Los objetivos deben compararse con la línea base real del canal y expresarse como mejora porcentual o puntos porcentuales.
                No presentes CTR, impresiones ni datos demográficos como si estuvieran disponibles si no aparecen en los snapshots. Indica que requieren un informe de alcance separado o que YouTube los oculta por privacidad.
                El bloque reachSummary contiene impresiones y CTR del YouTube Reporting API. Si reach_rows es cero, explica que el primer informe puede tardar hasta 24 horas.
                FORMATO OBLIGATORIO: responde siempre en Markdown limpio y en este orden: "## Diagnóstico", "## Hallazgos clave", "## Acciones prioritarias" y "## Datos faltantes" solo si realmente faltan datos.
                Usa tablas Markdown solo para comparaciones cortas (máximo 6 columnas y 10 filas). Para listas de videos usa viñetas con título, tipo, vistas y retención. No pegues JSON, SQL ni objetos internos en la respuesta.
                Cada recomendación debe incluir: acción, motivo basado en un dato y cómo medirla. Separa cada idea en párrafos cortos y evita repetir el resumen del canal.
                - Si el mensaje del usuario era un saludo o una prueba, responde amablemente indicando que estás listo para analizar su canal.
                - Analiza la RETENCIÓN (% consumido): Si la retención es baja (<30%), advierte que el problema está en el gancho o la estructura del video.
                - Identifica OUTLIERS: Señala si un video triunfó por suerte/tema puntual o si es un patrón repetible.
                - Sé directo, estratégico y basado en datos. Ofrece siempre 2-3 ACCIONES CONCRETAS para el próximo video o playlist.`
            },
            {
                role: 'user',
                content: `Pregunta del creador: "${userQuestion}"\n\n${syncResult ? `Sincronizacion terminada: ${syncResult.totalVideosSynced} videos procesados. ` : ''}Resumen actual del canal (usa estos datos siempre que sean relevantes):\n${JSON.stringify(channelContext)}\n\nResumen analítico calculado por PostgreSQL:\n${JSON.stringify(analyticsSummary)}\n\nRendimiento de los 20 videos publicados con más vistas:\n${JSON.stringify(topVideoAnalyticsSnapshot.rows)}\n\nAudiencia (fuentes de tráfico y demografía):\n${JSON.stringify(insightsSnapshot.rows)}\n\nAlcance (impresiones y CTR):\n${JSON.stringify(reachSummary)}\n\nPerfil y objetivos del creador:\n${JSON.stringify(creatorProfile)}\n\nConversacion reciente (solo contexto breve):\n${JSON.stringify(compactHistory)}\n\nDatos de la consulta (muestra limitada; no inventes datos fuera de ella):\n${JSON.stringify(compactDbData)}`
            }
        ],
        model: 'openai/gpt-oss-120b',
        temperature: 0.4,
        max_tokens: 1800,
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
