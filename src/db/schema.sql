-- 1. Extensiones necesarias
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. Tabla de Canales
CREATE TABLE IF NOT EXISTS channels (
  channel_id VARCHAR(255) PRIMARY KEY,
  title VARCHAR(255),
  subscribers BIGINT,
  total_views BIGINT,
  total_videos INT,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 3. Tabla de Vídeos
CREATE TABLE IF NOT EXISTS videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id VARCHAR(255) UNIQUE NOT NULL,
  channel_id VARCHAR(255) REFERENCES channels(channel_id),
  title VARCHAR(500),
  description TEXT,
  tags TEXT[],
  published_at TIMESTAMP,
  duration_seconds INT,
  content_type VARCHAR(50),
  privacy_status VARCHAR(50),
  thumbnail_url TEXT,
  views BIGINT DEFAULT 0,
  likes BIGINT DEFAULT 0,
  comments BIGINT DEFAULT 0,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Parche de migración: Agrega la columna si la tabla 'videos' ya existía de antes
ALTER TABLE videos ADD COLUMN IF NOT EXISTS tags TEXT[];

-- 4. Tabla de Analítica Diaria por Vídeo
CREATE TABLE IF NOT EXISTS video_analytics_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id VARCHAR(255) REFERENCES videos(video_id) ON DELETE CASCADE,
  record_date DATE NOT NULL,
  views BIGINT DEFAULT 0,
  likes BIGINT DEFAULT 0,
  comments BIGINT DEFAULT 0,
  subscribers_gained INT DEFAULT 0,
  subscribers_lost INT DEFAULT 0,
  estimated_minutes_watched NUMERIC DEFAULT 0,
  average_view_duration_seconds NUMERIC DEFAULT 0,
  UNIQUE(video_id, record_date)
);

-- 5. Tabla de Playlists
CREATE TABLE IF NOT EXISTS playlists (
  playlist_id VARCHAR(100) PRIMARY KEY,
  channel_id VARCHAR(100) REFERENCES channels(channel_id),
  title VARCHAR(255) NOT NULL,
  description TEXT,
  item_count INT DEFAULT 0,
  published_at TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 6. Tabla Intermedia (Videos <-> Playlists)
CREATE TABLE IF NOT EXISTS playlist_items (
  playlist_id VARCHAR(100) REFERENCES playlists(playlist_id) ON DELETE CASCADE,
  video_id VARCHAR(100) REFERENCES videos(video_id) ON DELETE CASCADE,
  position INT,
  PRIMARY KEY (playlist_id, video_id)
);