// Prima di "npm run migrate" (setup.sh, update.sh): allinea un database nato
// prima della 1.0. Legge DATABASE_URL, come node-pg-migrate.
import { allineaMigrazioni } from '../src/allineaMigrazioni.js';

if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL non impostata.');
    process.exit(1);
}
try {
    const esito = await allineaMigrazioni(process.env.DATABASE_URL);
    if (esito === 'allineato') console.log('Database precedente alla 1.0: migrazioni allineate alla base della 1.0.');
} catch (e) {
    console.error(e.message);
    process.exit(1);
}
