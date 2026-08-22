import { query } from '#db/index';
import { getYouTubeDataClient } from '#clients/youtubeDataClient';
import { getYouTubeAnalyticsClient } from '#clients/youtubeAnalyticsClient';
import { parseISO8601Duration } from '#utils/durationParser';

export const syncChannelData = async (channelId = '') => {
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

    // 2. Extraer Playlists y sus relaciones
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
                        await query(
                            `INSERT INTO playlist_items (playlist_id, video_id, position)
                             VALUES ($1, $2, $3)
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

    // 3. Extracción masiva de Vídeos (Paginación completa + Tags)
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

    // Procesar vídeos en bloques de 50
    for (let i = 0; i < videoIds.length; i += 50) {
        const chunk = videoIds.slice(i, i + 50);
        const videoDetailsRes = await youtube.videos.list({
            part: ['snippet', 'contentDetails', 'statistics', 'status'],
            id: chunk,
        });

        for (const item of videoDetailsRes.data.items) {
            const durationSeconds = parseISO8601Duration(item.contentDetails.duration);
            const fallbackContentType = durationSeconds <= 180 ? 'shorts' : 'videoOnDemand';
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
                    content_type = COALESCE(videos.content_type, EXCLUDED.content_type),
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
                    fallbackContentType,
                ]
            );
        }
    }

    // 4. YouTube Analytics
    const todayStr = new Date().toISOString().split('T')[0];

    try {
        const analyticsRes = await analytics.reports.query({
            ids: 'channel==MINE',
            startDate: '2024-01-01',
            endDate: todayStr,
            metrics: 'views,likes,comments,subscribersGained,subscribersLost,estimatedMinutesWatched,averageViewDuration',
            dimensions: 'video',
            sort: '-views',
            maxResults: 200,
        });

        const rows = analyticsRes.data.rows || [];
        for (const row of rows) {
            const [
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
                [videoId, todayStr, views, likes, comments, subscribersGained, subscribersLost, estimatedMinutes, avgDuration]
            );
        }
    } catch (analyticsError) {
        console.warn('⚠️ No se pudieron obtener las analíticas de YouTube:', analyticsError.message);
    }

    return { success: true, totalVideosSynced: videoIds.length };
};