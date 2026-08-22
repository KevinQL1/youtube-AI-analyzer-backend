# YouTube AI Growth Analyzer (Backend)

Herramienta desarrollada en Node.js para analizar el crecimiento y rendimiento de un canal de YouTube utilizando las APIs de Google (Data v3 & Analytics v2), PostgreSQL como base de datos y modelos de Lenguaje (LLM) a través de **Groq** para generar análisis predictivos y responder consultas en lenguaje natural mediante SQL.

## 🎯 Objetivo

YouTube AI Growth Analyzer busca centralizar los datos de un canal para identificar:

- Crecimiento de suscriptores y retención de audiencia.
- Rendimiento comparativo entre **Shorts** y **vídeos largos**.
- Análisis automatizado de patrones de éxito mediante **IA / SQL natural**.
- Gestión y agrupación por **Playlists** y **Etiquetas (Tags)**.
- Evolución diaria de vistas, me gusta, comentarios y tiempo de visualización.

## 🛠️ Tecnologías

- **Entorno de ejecución:** Node.js (ES Modules)
- **Base de datos:** PostgreSQL (Compatible con Neon Cloud / Docker)
- **Modelos de IA:** Groq API (OpenAI GPT-OSS)
- **Integraciones:** Google APIs (YouTube Data API v3, YouTube Analytics API v2, OAuth 2.0)
- **Drivers & Utilidades:** `pg` (PostgreSQL Client), `dotenv`, `cors`, `express`

## 📁 Arquitectura del Proyecto

```text
youtube-AI-analyzer-backend/
├── credentials/
│   ├── credentials.json
│   └── token.json
├── src/
│   ├── clients/
│   │   ├── youtubeAnalyticsClient.js
│   │   └── youtubeDataClient.js
│   ├── config/
│   │   ├── env.js
│   │   └── googleAuth.js
│   ├── controllers/
│   │   ├── analyticsController.js
│   │   ├── channelController.js
│   │   └── syncController.js
│   ├── db/
│   │   ├── index.js
│   │   └── schema.sql
│   ├── routes/
│   │   ├── analyticsRoutes.js
│   │   ├── channelRoutes.js
│   │   └── syncRoutes.js
│   ├── services/
│   │   ├── analyticsService.js
│   │   └── syncService.js
│   ├── utils/
│   │   └── durationParser.js
│   ├── app.js
│   ├── server.js
│   └── test-db.js
├── .env
├── .gitignore
├── docker-compose.yml
├── package.json
└── README.md