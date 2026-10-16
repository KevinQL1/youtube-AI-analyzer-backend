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

-- Historial para medir crecimiento real del canal
CREATE TABLE IF NOT EXISTS channel_analytics_daily (
  channel_id VARCHAR(255) REFERENCES channels(channel_id) ON DELETE CASCADE,
  record_date DATE NOT NULL,
  subscribers BIGINT,
  total_views BIGINT,
  total_videos INT,
  PRIMARY KEY (channel_id, record_date)
);

-- Perfil persistente del creador para personalizar las recomendaciones de la IA
CREATE TABLE IF NOT EXISTS creator_profiles (
  channel_id VARCHAR(255) PRIMARY KEY REFERENCES channels(channel_id) ON DELETE CASCADE,
  niche VARCHAR(255),
  target_audience TEXT,
  goals TEXT,
  preferred_tone VARCHAR(100),
  upload_frequency VARCHAR(100),
  notes TEXT,
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS conversation_messages (
  id BIGSERIAL PRIMARY KEY,
  channel_id VARCHAR(255) REFERENCES channels(channel_id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sync_runs (
  id BIGSERIAL PRIMARY KEY,
  channel_id VARCHAR(255) REFERENCES channels(channel_id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL CHECK (status IN ('running', 'completed', 'partial', 'failed')),
  videos_synced INT DEFAULT 0,
  analytics_window_start DATE,
  analytics_window_end DATE,
  error_message TEXT,
  started_at TIMESTAMP DEFAULT NOW(),
  finished_at TIMESTAMP
);

ALTER TABLE sync_runs DROP CONSTRAINT IF EXISTS sync_runs_status_check;
ALTER TABLE sync_runs ADD CONSTRAINT sync_runs_status_check CHECK (status IN ('running', 'completed', 'partial', 'failed'));

-- 3. Tabla de Vídeos
CREATE TABLE IF NOT EXISTS videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id VARCHAR(255) UNIQUE NOT NULL,
  channel_id VARCHAR(255) REFERENCES channels(channel_id),
  title VARCHAR(500),
  description TEXT,
  tags TEXT[],
  published_at TIMESTAMP,
  scheduled_at TIMESTAMP,
  publication_status VARCHAR(30) DEFAULT 'unknown',
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
ALTER TABLE videos ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMP;
ALTER TABLE videos ADD COLUMN IF NOT EXISTS publication_status VARCHAR(30) DEFAULT 'unknown';

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

-- Snapshots de informes agregados de audiencia para el contexto de la IA
CREATE TABLE IF NOT EXISTS channel_analytics_insights (
  channel_id VARCHAR(255) REFERENCES channels(channel_id) ON DELETE CASCADE,
  insight_type VARCHAR(50) NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  data JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (channel_id, insight_type, period_start, period_end)
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

CREATE INDEX IF NOT EXISTS idx_videos_channel_id ON videos(channel_id);
CREATE INDEX IF NOT EXISTS idx_videos_content_type ON videos(content_type);
CREATE INDEX IF NOT EXISTS idx_videos_published_at ON videos(published_at);
CREATE INDEX IF NOT EXISTS idx_video_analytics_date ON video_analytics_daily(record_date);
CREATE INDEX IF NOT EXISTS idx_video_analytics_video ON video_analytics_daily(video_id);
CREATE INDEX IF NOT EXISTS idx_video_analytics_video_date ON video_analytics_daily(video_id, record_date DESC);
CREATE INDEX IF NOT EXISTS idx_channel_insights_type ON channel_analytics_insights(channel_id, insight_type, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_playlists_channel_id ON playlists(channel_id);
CREATE INDEX IF NOT EXISTS idx_playlist_items_video_id ON playlist_items(video_id);
CREATE INDEX IF NOT EXISTS idx_channels_updated_at ON channels(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversation_messages_channel_date ON conversation_messages(channel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_runs_channel_date ON sync_runs(channel_id, started_at DESC);
