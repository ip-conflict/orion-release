// L'esito delle visite si cifra con la chiave dei dati (enc1:...): non sta più in 20 caratteri.
// Tornando indietro va rimesso in chiaro, e per questo serve la chiave.

const path = require('path');
const { pathToFileURL } = require('url');

exports.up = (pgm) => {
    pgm.alterColumn('user_medical_records', 'status', { type: 'text', default: null });
};

exports.down = async (pgm) => {
    const radice = path.join(__dirname, '..');
    const { decifraCon, leggiFileChiaveDa } = await import(pathToFileURL(path.join(radice, 'src', 'formatoCifrato.js')).href);
    const cifrati = await pgm.db.select("SELECT id, status FROM user_medical_records WHERE status LIKE 'enc1:%'");
    if (cifrati.length) {
        const chiave = leggiFileChiaveDa(process.env.ORION_CHIAVE_FILE || path.join(radice, 'chiave-dati.key'));
        if (!chiave) throw new Error('Per rimettere in chiaro gli esiti delle visite serve la chiave dei dati.');
        for (const r of cifrati) {
            const esito = decifraCon(chiave, Buffer.from(r.status.slice(5), 'base64')).toString('utf8');
            await pgm.db.query('UPDATE user_medical_records SET status = $1 WHERE id = $2', [esito, r.id]);
        }
    }
    pgm.alterColumn('user_medical_records', 'status', { type: 'varchar(20)', default: 'Idoneo' });
};
