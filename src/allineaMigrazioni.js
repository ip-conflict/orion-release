// Dalla 1.0 le 37 migrazioni 3.x sono una sola (BASE_1_0). Un database nato prima ha
// ancora le 37 righe: senza questo passo node-pg-migrate lo rifiuterebbe.

import pg from 'pg';

export const ULTIMA_PRIMA_DELLA_1_0 = 'v3-update-36-tabelle-inutilizzate';
export const BASE_1_0 = '1790985600000_orion-1-0';

// 'nuovo' (database vuoto), 'ok' (già allineato) o 'allineato' (appena fatto).
export async function allineaMigrazioni(connessione) {
    const client = new pg.Client(typeof connessione === 'string' ? { connectionString: connessione } : connessione);
    await client.connect();
    try {
        const tabella = await client.query("SELECT to_regclass('public.pgmigrations') AS t");
        if (!tabella.rows[0].t) return 'nuovo';
        const nomi = (await client.query('SELECT name FROM pgmigrations ORDER BY id')).rows.map(r => r.name);
        if (nomi.length === 0 || nomi.includes(BASE_1_0)) return 'ok';
        if (!nomi.includes(ULTIMA_PRIMA_DELLA_1_0)) {
            throw new Error(`Il database e' di una versione precedente alla 3.36 (ultima migrazione: ${nomi[nomi.length - 1]}): ` +
                'va reinstallato, oppure aggiornato prima con una versione 3.38.');
        }
        await client.query('BEGIN');
        await client.query('DELETE FROM pgmigrations');
        await client.query('INSERT INTO pgmigrations (name, run_on) VALUES ($1, NOW())', [BASE_1_0]);
        await client.query('COMMIT');
        return 'allineato';
    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
    } finally {
        await client.end();
    }
}
