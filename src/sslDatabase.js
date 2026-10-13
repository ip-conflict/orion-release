// Con DB_SSL=true il certificato si verifica; solo DB_SSL_STRICT=false lo spegne.

import fs from 'fs';

export function opzioniSslDatabase(env = process.env) {
    if (env.DB_SSL !== 'true') return false;
    const opzioni = { rejectUnauthorized: env.DB_SSL_STRICT !== 'false' };
    if (env.DB_SSL_CA) opzioni.ca = fs.readFileSync(env.DB_SSL_CA, 'utf8');
    return opzioni;
}
