import { google } from 'googleapis';
import { getOAuth2Client } from '#config/googleAuth';

export const getYouTubeAnalyticsClient = async () => {
    const auth = getOAuth2Client();
    return google.youtubeAnalytics({ version: 'v2', auth });
};