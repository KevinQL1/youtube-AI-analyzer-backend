import { query } from '#db/index';
import { getYouTubeDataClient } from '#clients/youtubeDataClient';
import { getYouTubeAnalyticsClient } from '#clients/youtubeAnalyticsClient';
import { parseISO8601Duration } from '#utils/durationParser';
import { env } from '#config/env';

let syncInProgress = false;

export const syncChannelData = async (channelId = env.channelId) => {
    if (!channelId) throw new Error('Configura CHANNEL_ID para sincronizar tu canal.');
    if (syncInProgress) throw new Error('Ya hay una sincronización en curso. Espera a que termine.');
    syncInProgress = true;
    let syncRunId = null;
    let analyticsStatus = 'completed';
    let analyticsErrorMessage = null;
    try {
    const youtube = getYouTubeDataClient(); // Instanciación síncrona
    const analytics = await getYouTubeAnalyticsClient();

    // 1. Datos del Canal
    const channelRes = await youtube.channels.list({
        part: ['snippet', 'statistics', 'contentDetails'],
        id: [channelId],
    });

    const channel = channelRes.data.items?.[0];
    if (!channel) throw new Error('Canal no encontrado');

    await query(
        `INSERT INTO channels (channel_id, title, subscribers, total_views, total_videos, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (channel_id) DO UPDATE SET
            title = EXCLUDED.title,
            subscribers = EXCLUDED.subscribers,
            total_views = EXCLUDED.total_views,
            total_videos = EXCLUDED.total_videos,
            updated_at = NOW();`,
        [
            channelId,
            channel.snippet.title,
            channel.statistics.subscriberCount,
            channel.statistics.viewCount,
            channel.statistics.videoCount,
        ]
    );

    const syncRun = await query(
        `INSERT INTO sync_runs (channel_id, status) VALUES ($1, 'running') RETURNING id`,
        [channelId]
    );
    syncRunId = syncRun.rows[0]?.id || null;

    const snapshotDate = new Date().toISOString().split('T')[0];
    await query(
        `INSERT INTO channel_analytics_daily (channel_id, record_date, subscribers, total_views, total_videos)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (channel_id, record_date) DO UPDATE SET
            subscribers = EXCLUDED.subscribers,
            total_views = EXCLUDED.total_views,
            total_videos = EXCLUDED.total_videos`,
        [channelId, snapshotDate, channel.statistics.subscriberCount, channel.statistics.viewCount, channel.statistics.videoCount]
    );

    // 2. Extracción masiva de Vídeos (AHORA PRIMERO)
    const uploadsPlaylistId = channel.contentDetails.relatedPlaylists.uploads;
    let videoIds = [];
    let nextPageToken = null;

    do {
        const playlistRes = await youtube.playlistItems.list({
            part: ['contentDetails'],
            playlistId: uploadsPlaylistId,
            maxResults: 50,
            pageToken: nextPageToken,
        });
        videoIds = videoIds.concat(playlistRes.data.items.map((item) => item.contentDetails.videoId));
        nextPageToken = playlistRes.data.nextPageToken;
    } while (nextPageToken);

    // Clasificacion oficial disponible en YouTube Analytics (creatorContentType).
    const officialContentTypes = new Map();
    try {
        let startIndex = 1;
        let totalResults = 0;
        do {
            const typeReport = await analytics.reports.query({
                ids: 'channel==MINE',
                startDate: '2019-01-01',
                endDate: new Date().toISOString().split('T')[0],
                metrics: 'views',
                dimensions: 'video,creatorContentType',
                sort: '-views',
                maxResults: 200,
                startIndex,
            });
            const typeRows = typeReport.data.rows || [];
            for (const [videoId, creatorContentType] of typeRows) {
                if (creatorContentType === 'SHORTS') officialContentTypes.set(videoId, 'shorts');
                if (creatorContentType === 'VIDEO_ON_DEMAND') officialContentTypes.set(videoId, 'videoOnDemand');
            }
            totalResults = Number(typeReport.data.totalResults || typeRows.length);
            startIndex += typeRows.length;
            if (typeRows.length === 0) break;
        } while (startIndex <= totalResults);
    } catch (classificationError) {
        analyticsStatus = 'partial';
        analyticsErrorMessage = `Clasificacion oficial: ${classificationError.message}`;
        console.warn('No se pudo obtener la clasificacion oficial de Shorts; se usara la deteccion de respaldo:', classificationError.message);
    }

    // Procesar vídeos en bloques de 50
    for (let i = 0; i < videoIds.length; i += 50) {
        const chunk = videoIds.slice(i, i + 50);
        const videoDetailsRes = await youtube.videos.list({
            part: ['snippet', 'contentDetails', 'statistics', 'status'],
            id: chunk,
        });

        for (const item of videoDetailsRes.data.items) {
            const durationSeconds = parseISO8601Duration(item.contentDetails.duration);
            const thumbnails = item.snippet.thumbnails || {};
            const bestThumbnail = thumbnails.maxres || thumbnails.standard || thumbnails.high || thumbnails.medium || thumbnails.default;
            const isPortrait = Boolean(bestThumbnail?.width && bestThumbnail?.height && bestThumbnail.height > bestThumbnail.width);
            const mentionsShorts = /(^|[\s#])shorts\b/i.test(`${item.snippet.title || ''} ${item.snippet.description || ''}`);
            // La API de YouTube no expone un campo único "esShort"; combinamos señales fiables
            // y usamos duración como respaldo para no perder Shorts sin hashtag o miniatura vertical.
            const fallbackType = durationSeconds <= 180 && (isPortrait || mentionsShorts || durationSeconds <= 60)
                ? 'shorts'
                : 'videoOnDemand';
            const contentType = officialContentTypes.get(item.id) || fallbackType;
            const tags = item.snippet.tags || [];

            await query(
                `INSERT INTO videos 
                 (video_id, channel_id, title, description, tags, published_at, duration_seconds, privacy_status, thumbnail_url, likes, comments, views, content_type, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
                 ON CONFLICT (video_id) DO UPDATE SET
                    title = EXCLUDED.title,
                    description = EXCLUDED.description,
                    tags = EXCLUDED.tags,
                    published_at = EXCLUDED.published_at,
                    duration_seconds = EXCLUDED.duration_seconds,
                    privacy_status = EXCLUDED.privacy_status,
                    thumbnail_url = EXCLUDED.thumbnail_url,
                    likes = EXCLUDED.likes,
                    comments = EXCLUDED.comments,
                    views = EXCLUDED.views,
                    content_type = EXCLUDED.content_type,
                    updated_at = NOW();`,
                [
                    item.id,
                    channelId,
                    item.snippet.title,
                    item.snippet.description,
                    tags,
                    item.snippet.publishedAt,
                    durationSeconds,
                    item.status.privacyStatus,
                    item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.default?.url,
                    item.statistics.likeCount || 0,
                    item.statistics.commentCount || 0,
                    item.statistics.viewCount || 0,
                    contentType,
                ]
            );
        }
    }

    // 3. Extraer Playlists y sus relaciones (DESPUÉS DE LOS VÍDEOS)
    let nextPlaylistPageToken = null;
    do {
        const playlistsRes = await youtube.playlists.list({
            part: ['snippet', 'contentDetails'],
            channelId: channelId,
            maxResults: 50,
            pageToken: nextPlaylistPageToken,
        });

        for (const pl of playlistsRes.data.items || []) {
            await query(
                `INSERT INTO playlists (playlist_id, channel_id, title, description, item_count, published_at, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, NOW())
                 ON CONFLICT (playlist_id) DO UPDATE SET
                    title = EXCLUDED.title,
                    description = EXCLUDED.description,
                    item_count = EXCLUDED.item_count,
                    updated_at = NOW();`,
                [
                    pl.id,
                    channelId,
                    pl.snippet.title,
                    pl.snippet.description,
                    pl.contentDetails.itemCount,
                    pl.snippet.publishedAt,
                ]
            );

            let nextPlaylistItemToken = null;
            do {
                const itemsRes = await youtube.playlistItems.list({
                    part: ['snippet'],
                    playlistId: pl.id,
                    maxResults: 50,
                    pageToken: nextPlaylistItemToken,
                });

                for (const item of itemsRes.data.items || []) {
                    const videoIdInPl = item.snippet.resourceId?.videoId;
                    if (videoIdInPl) {
                        // Inserción segura que valida que el vídeo exista en la BD
                        await query(
                            `INSERT INTO playlist_items (playlist_id, video_id, position)
                             SELECT $1::text, $2::text, $3::integer
                             WHERE EXISTS (SELECT 1 FROM videos WHERE video_id = $2)
                             ON CONFLICT (playlist_id, video_id) DO UPDATE SET position = EXCLUDED.position;`,
                            [pl.id, videoIdInPl, item.snippet.position]
                        );
                    }
                }
                nextPlaylistItemToken = itemsRes.data.nextPageToken;
            } while (nextPlaylistItemToken);
        }
        nextPlaylistPageToken = playlistsRes.data.nextPageToken;
    } while (nextPlaylistPageToken);

    // 4. Analíticas diarias por vídeo de los últimos 30 días
    const todayStr = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    try {
        let startIndex = 1;
        let totalResults = 0;
        do {
        const analyticsRes = await analytics.reports.query({
            ids: 'channel==MINE',
            startDate,
            endDate: todayStr,
            metrics: 'views,likes,comments,subscribersGained,subscribersLost,estimatedMinutesWatched,averageViewDuration',
            dimensions: 'day,video',
            sort: 'day,-views',
            maxResults: 200,
            startIndex,
        });

        const rows = analyticsRes.data.rows || [];
        for (const row of rows) {
            const [
                recordDate,
                videoId,
                views,
                likes,
                comments,
                subscribersGained,
                subscribersLost,
                estimatedMinutes,
                avgDuration,
            ] = row;

            await query(
                `INSERT INTO video_analytics_daily 
                 (video_id, record_date, views, likes, comments, subscribers_gained, subscribers_lost, estimated_minutes_watched, average_view_duration_seconds)
                 SELECT $1::text, $2, $3, $4, $5, $6, $7, $8, $9
                 WHERE EXISTS (SELECT 1 FROM videos WHERE video_id = $1)
                 ON CONFLICT (video_id, record_date) DO UPDATE SET
                    views = EXCLUDED.views,
                    likes = EXCLUDED.likes,
                    comments = EXCLUDED.comments,
                    subscribers_gained = EXCLUDED.subscribers_gained,
                    subscribers_lost = EXCLUDED.subscribers_lost,
                    estimated_minutes_watched = EXCLUDED.estimated_minutes_watched,
                    average_view_duration_seconds = EXCLUDED.average_view_duration_seconds;`,
                [videoId, recordDate, views, likes, comments, subscribersGained, subscribersLost, estimatedMinutes, avgDuration]
            );
        }
        totalResults = Number(analyticsRes.data.totalResults || rows.length);
        startIndex += rows.length;
        if (rows.length === 0) break;
        } while (startIndex <= totalResults);
    } catch (analyticsError) {
        analyticsStatus = 'partial';
        analyticsErrorMessage = analyticsError.message;
        console.warn('⚠️ No se pudieron obtener las analíticas de YouTube:', analyticsError.message);
    }

    if (syncRunId) {
        await query(
            `UPDATE sync_runs SET status = $2, videos_synced = $3,
             analytics_window_start = $4, analytics_window_end = $5, error_message = $6, finished_at = NOW() WHERE id = $1`,
            [syncRunId, analyticsStatus, videoIds.length, startDate, todayStr, analyticsErrorMessage]
        );
    }
    return { success: true, partial: analyticsStatus === 'partial', analyticsError: analyticsErrorMessage, totalVideosSynced: videoIds.length, analyticsWindowStart: startDate, analyticsWindowEnd: todayStr };
    } catch (error) {
        if (syncRunId) {
            await query(`UPDATE sync_runs SET status = 'failed', error_message = $2, finished_at = NOW() WHERE id = $1`, [syncRunId, error.message]).catch(() => {});
        }
        throw error;
    } finally {
        syncInProgress = false;
    }
};
