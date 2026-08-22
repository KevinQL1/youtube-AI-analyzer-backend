import { query } from '#db/index';

// 1. Obtener los vídeos más vistos (filtrado opcional por tipo: 'shorts' o 'videoOnDemand')
export const getTopVideos = async (contentType = null, limit = 10) => {
  let sql = `SELECT * FROM videos `;
  const params = [];

  if (contentType) {
    sql += `WHERE content_type = $1 `;
    params.push(contentType);
  }

  sql += `ORDER BY views DESC LIMIT $${params.length + 1}`;
  params.push(limit);

  const res = await query(sql, params);
  return res.rows;
};

// 2. Comparación de rendimiento entre dos juegos/temáticas
export const compareGames = async (game1 = 'Minecraft', game2 = 'Fortnite') => {
  const sql = `
    SELECT 
      CASE 
        WHEN LOWER(title) LIKE $1 THEN $3
        WHEN LOWER(title) LIKE $2 THEN $4
      END as game,
      COUNT(*) as video_count,
      SUM(views) as total_views,
      ROUND(AVG(views), 2) as avg_views,
      SUM(likes) as total_likes
    FROM videos
    WHERE LOWER(title) LIKE $1 OR LOWER(title) LIKE $2
    GROUP BY game;
  `;

  const res = await query(sql, [
    `%${game1.toLowerCase()}%`,
    `%${game2.toLowerCase()}%`,
    game1,
    game2,
  ]);
  return res.rows;
};

// 3. Comparación Global: Shorts vs Videos Largos (VODs)
export const compareShortsVsVods = async () => {
  const sql = `
    SELECT 
      content_type,
      COUNT(*) as total_videos,
      SUM(views) as total_views,
      ROUND(AVG(views), 2) as avg_views,
      ROUND(AVG(likes), 2) as avg_likes,
      ROUND(AVG(comments), 2) as avg_comments
    FROM videos
    WHERE content_type IS NOT NULL
    GROUP BY content_type;
  `;

  const res = await query(sql);
  return res.rows;
};