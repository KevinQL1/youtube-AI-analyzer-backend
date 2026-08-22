import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const getOAuth2Client = () => {
    // Subimos dos niveles desde src/config a la raíz del proyecto
    const rootDir = path.resolve(__dirname, '../../');
    const credentialsPath = path.join(rootDir, 'credentials', 'credentials.json');
    const tokenPath = path.join(rootDir, 'credentials', 'token.json');

    if (!fs.existsSync(credentialsPath) || !fs.existsSync(tokenPath)) {
        throw new Error('❌ Faltan archivos credentials.json o token.json en la carpeta /credentials');
    }

    const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
    const token = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));

    const { client_secret, client_id, redirect_uris } = credentials.web || credentials.installed;
    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
    oAuth2Client.setCredentials(token);

    return oAuth2Client;
};