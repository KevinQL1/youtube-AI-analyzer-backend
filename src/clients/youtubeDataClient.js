import { google } from 'googleapis';
import { env } from '#config/env';
import { getOAuth2Client } from '#config/googleAuth';

export const getYouTubeDataClient = () => {
    const auth = env.youtubeApiKey ? env.youtubeApiKey : getOAuth2Client();

    return google.youtube({
        version: 'v3',
        auth,
    });
};