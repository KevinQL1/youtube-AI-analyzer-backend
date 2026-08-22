import dotenv from 'dotenv';

dotenv.config();

export const env = {
    port: process.env.PORT || 3000,
    db: {
        user: process.env.POSTGRES_USER,
        password: String(process.env.POSTGRES_PASSWORD),
        host: process.env.POSTGRES_HOST,
        port: Number(process.env.POSTGRES_PORT),
        database: process.env.POSTGRES_DB,
    },
    channelId: process.env.CHANNEL_ID,
    youtubeApiKey: process.env.YOUTUBE_API_KEY,
    groqApiKey: process.env.GROQ_API_KEY,
};