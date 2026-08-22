import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const getOAuth2Client = () => {
    let credentials;
    let token;

    // 1. Intentar cargar desde variables de entorno (Producción / Render)
    if (process.env.GOOGLE_CREDENTIALS_JSON && process.env.GOOGLE_TOKEN_JSON) {
        credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
        token = JSON.parse(process.env.GOOGLE_TOKEN_JSON);
    }
    // 2. Si no existen, cargar desde el sistema de archivos (Desarrollo local)
    else {
        const rootDir = path.resolve(__dirname, '../../');
        const credentialsPath = path.join(rootDir, 'credentials', 'credentials.json');
        const tokenPath = path.join(rootDir, 'credentials', 'token.json');

        if (!fs.existsSync(credentialsPath) || !fs.existsSync(tokenPath)) {
            throw new Error('❌ Faltan credenciales: No se encontraron Variables de Entorno ni archivos en /credentials');
        }

        credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
        token = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
    }

    // Configurar cliente OAuth2
    const { client_secret, client_id, redirect_uris } = credentials.web || credentials.installed;
    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
    oAuth2Client.setCredentials(token);

    return oAuth2Client;
};