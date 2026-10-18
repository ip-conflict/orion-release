// Il nome dice di chi è il backup, quando (in ora italiana) e perché: un file scaricato o
// copiato fuori dalla sua cartella si riconosce da solo.

// Si legge a ogni nome: questo modulo può essere importato prima che .env sia letto.
export function istanza() {
    const nome = process.env.ORION_ISTANZA || (process.env.DOMAIN_NAME || '').split('.')[0];
    return String(nome).toLowerCase().replace(/[^a-z0-9-]/g, '') || 'orion';
}

const due = (n) => String(n).padStart(2, '0');
export function orarioNome(d = new Date()) {
    return `${d.getFullYear()}${due(d.getMonth() + 1)}${due(d.getDate())}_${due(d.getHours())}${due(d.getMinutes())}${due(d.getSeconds())}`;
}

export const nomeBackup = (motivo, d) => `orion_${istanza()}_db_${orarioNome(d)}_${motivo}.sql.gz`;

// Anche i nomi di prima: db_<data UTC>_<ora>[_motivo].sql.gz.
const FORMA = /^(?:orion_([a-z0-9-]+)_)?db_\d{8}_\d{4,6}(?:_(.+))?\.sql\.gz$/;
export function leggiNomeBackup(nome) {
    const m = FORMA.exec(nome || '');
    return m ? { istanza: m[1] || null, motivo: m[2] || null } : null;
}

export const nomeDaScaricare = (nome) => (leggiNomeBackup(nome)?.istanza ? nome : `orion_${istanza()}_${nome}`);
