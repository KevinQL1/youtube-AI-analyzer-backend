# YouTube AI Growth Analyzer

Backend personal para analizar y hacer crecer un canal de YouTube con datos reales de YouTube, PostgreSQL y un agente de IA.

El sistema sincroniza el canal, guarda historiales, responde preguntas en lenguaje natural y genera recomendaciones basadas en los videos con mejor rendimiento.

## Funciones

- Sincronizacion manual desde la conversacion: `actualiza la base de datos`.
- Metricas del canal: suscriptores, vistas totales, videos y fecha de actualizacion.
- Videos, Shorts, videos largos, playlists, etiquetas y relaciones entre playlists y videos.
- Clasificacion oficial de Shorts con `creatorContentType` de YouTube Analytics y deteccion de respaldo.
- Metricas diarias por video durante los ultimos 30 dias.
- Historial diario de suscriptores, vistas y cantidad de videos.
- Registro de sincronizaciones `running`, `completed`, `partial` y `failed`.
- Memoria de conversaciones recientes.
- Perfil persistente del creador: nicho, audiencia, objetivos, tono y frecuencia.
- Consultas analiticas en lenguaje natural con SQL de solo lectura.
- Recomendaciones de estrategia, SEO, retencion, formatos y crecimiento.
- Paquetes de contenido: concepto, gancho, titulos, miniaturas, guion, Short, descripcion, hashtags y metrica de exito.

## Tecnologias

Node.js (ES Modules), Express, PostgreSQL, YouTube Data API v3, YouTube Analytics API v2, OAuth 2.0, Groq API, `pg`, `dotenv`, `cors` y `node-cron`.

## Requisitos

- Node.js 20 o superior.
- PostgreSQL 14 o superior, local o en Neon.
- Proyecto de Google Cloud con YouTube Data API y YouTube Analytics API habilitadas.
- Credenciales OAuth con acceso al canal.
- API key de Groq.

## Configuracion

Crea `.env` con:

```env
PORT=3000
POSTGRES_USER=postgres
POSTGRES_PASSWORD=tu_password
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=youtube_growth
CHANNEL_ID=tu_channel_id
YOUTUBE_API_KEY=tu_api_key_opcional
GROQ_API_KEY=tu_groq_api_key
```

En desarrollo coloca `credentials.json` y `token.json` dentro de `credentials/`. En produccion usa `GOOGLE_CREDENTIALS_JSON` y `GOOGLE_TOKEN_JSON`.

No subas `.env`, `credentials.json` ni `token.json` al repositorio.

## Ejecucion

```bash
npm install
npm start
```

Desarrollo con recarga:

```bash
npm run dev
```

Al iniciar, el servidor crea o actualiza las tablas e indices definidos en `src/db/schema.sql`.

## API

### Preguntar al agente

`POST /api/ai/ask`

```json
{ "question": "Analiza mis Shorts y dime que debo mejorar" }
```

Si la pregunta solicita actualizar o sincronizar, el backend sincroniza primero y luego responde con los datos nuevos.

### Sincronizar manualmente

`POST /api/sync`

```json
{ "channelId": "tu_channel_id" }
```

La respuesta indica videos procesados, periodo de Analytics y si la sincronizacion quedo parcial.

### Generar contenido

`POST /api/ai/content-package`

```json
{ "request": "Crea un Short sobre Minecraft para aumentar suscriptores" }
```

### Guardar perfil del creador

`PUT /api/channel/profile`

```json
{
  "niche": "gaming",
  "targetAudience": "personas interesadas en Minecraft",
  "goals": "llegar a 100000 suscriptores",
  "preferredTone": "directo y energetico",
  "uploadFrequency": "3 videos por semana",
  "notes": "Priorizar Shorts y retos"
}
```

### Analiticas

- `GET /api/channel`
- `GET /api/analytics/top?type=shorts&limit=10`
- `GET /api/analytics/compare-format`
- `GET /api/analytics/compare-games?game1=Minecraft&game2=Fortnite`

## Base de datos

- `channels`: estado actual del canal.
- `channel_analytics_daily`: historial diario del canal.
- `videos`: metadatos y estadisticas actuales.
- `video_analytics_daily`: metricas diarias por video.
- `playlists` y `playlist_items`: playlists y relaciones.
- `creator_profiles`: objetivos y contexto del creador.
- `conversation_messages`: memoria reciente del agente.
- `sync_runs`: auditoria de sincronizaciones y errores parciales.

## Arquitectura

```text
src/
├── clients/       Clientes de YouTube Data y Analytics
├── config/        Variables de entorno y OAuth
├── controllers/   Entrada y respuesta HTTP
├── db/            Pool PostgreSQL y esquema
├── jobs/          Sincronizacion semanal
├── routes/        Rutas REST
├── services/      Sincronizacion, IA y analiticas
└── utils/         Utilidades
```

## Siguiente paso: frontend

El frontend puede construirse sobre estas rutas con cuatro vistas:

1. Dashboard: suscriptores, vistas, videos, crecimiento y ultima sincronizacion.
2. Chat del agente: preguntas, respuestas y estado de sincronizacion.
3. Contenido: ideas, titulos, miniaturas y guiones.
4. Biblioteca analitica: videos, Shorts, playlists, historiales y comparaciones.

La aplicacion esta pensada para uso personal. Si se publica fuera de una red privada, conviene añadir una clave de acceso sencilla para proteger la cuota de YouTube, Groq y PostgreSQL.
