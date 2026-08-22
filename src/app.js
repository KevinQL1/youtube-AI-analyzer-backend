import express from 'express';
import cors from 'cors';
import aiRoutes from '#routes/aiRoutes';
import syncRoutes from '#routes/syncRoutes';
import channelRoutes from '#routes/channelRoutes';
import analyticsRoutes from '#routes/analyticsRoutes';

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api/ai', aiRoutes);
app.use('/api/sync', syncRoutes);
app.use('/api/channel', channelRoutes);
app.use('/api/analytics', analyticsRoutes);

export default app;