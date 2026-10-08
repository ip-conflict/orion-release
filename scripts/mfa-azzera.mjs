#!/usr/bin/env node
// scripts/mfa-azzera.mjs
//
// Toglie la verifica in due passaggi a una persona, dalla console del server.
// Serve quando l'unico amministratore ha perso il telefono e i codici di
// riserva: dal web lo farebbe un altro amministratore. Chiude anche le sue
// sessioni; un amministratore la riattiva al prossimo accesso.
//
//   node scripts/mfa-azzera.mjs <username>
//
// Va lanciato dalla cartella di ORION, con l'utente del servizio (legge .env).

import 'dotenv/config';
import pg from 'pg';

const username = String(process.argv[2] || '').trim().toLowerCase();
if (!username) { console.error('Uso: node scripts/mfa-azzera.mjs <username>'); process.exit(2); }

const pool = new pg.Pool({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_DATABASE
});
const client = await pool.connect();
try {
    await client.query('BEGIN');
    const r = await client.query('SELECT id, mfa_attiva FROM users WHERE username = $1 FOR UPDATE', [username]);
    if (r.rowCount === 0) { console.error(`Nessun utente "${username}".`); process.exitCode = 1; await client.query('ROLLBACK'); }
    else {
        const id = r.rows[0].id;
        await client.query('UPDATE users SET mfa_attiva = false, mfa_segreto = NULL, mfa_attivata_il = NULL, mfa_ultimo_passo = NULL, sessioni_valide_dal = NOW() WHERE id = $1', [id]);
        await client.query('DELETE FROM mfa_codici_riserva WHERE user_id = $1', [id]);
        await client.query('DELETE FROM token_rinnovo WHERE user_id = $1', [id]);
        await client.query(
            `INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, details) VALUES (NULL, 'console', 'mfa.azzerata', 'utente', $1, $2)`,
            [String(id), JSON.stringify({ username, da: 'scripts/mfa-azzera.mjs' })]);
        await client.query('COMMIT');
        console.log(r.rows[0].mfa_attiva
            ? `Verifica in due passaggi tolta a ${username}; sessioni chiuse.`
            : `${username} non aveva la verifica attiva; sessioni chiuse comunque.`);
    }
} catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(`Errore: ${e.message}`);
    process.exitCode = 1;
} finally {
    client.release();
    await pool.end();
}
