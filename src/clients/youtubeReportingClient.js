import { google } from 'googleapis';
import { getOAuth2Client } from '#config/googleAuth';

export const getYouTubeReportingClient = () => google.youtubereporting({
    version: 'v1',
    auth: getOAuth2Client(),
});
