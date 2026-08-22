import express from 'express';
import cors from 'cors';
import aiRoutes from '#routes/aiRoutes';
import syncRoutes from '#routes/syncRoutes';
import channelRoutes from '#routes/channelRoutes';
import analyticsRoutes from '#routes/analyticsRoutes';

const app = express();

app.use(cors({
    origin: [
        'https://youtube-ai-analyzer-frontend.vercel.app',
        'http://localhost:5173',
        'http://localhost:3000'
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

app.use('/api/ai', aiRoutes);
app.use('/api/sync', syncRoutes);
app.use('/api/channel', channelRoutes);
app.use('/api/analytics', analyticsRoutes);

export default app;