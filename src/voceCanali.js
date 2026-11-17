// I canali non sono una tabella: si ricavano dalle squadre e dall'emergenza, così non
// possono andare fuori allineamento. Vedi "Orion Voice" nel manuale tecnico.

import { permessiDi } from './permessi.js';

export const GENERALE = 'generale';
export const AVVISI = 'avvisi';
export const canaleSquadra = (id) => `squadra:${id}`;
export const canaleDiretto = (userId) => `diretto:${userId}`;

export function tipoCanale(id) {
    if (id === GENERALE) return 'generale';
    if (id === AVVISI) return 'avviso';
    if (/^squadra:\d+$/.test(id)) return 'squadra';
    if (/^diretto:\d+$/.test(id)) return 'diretto';
    return null;
}

export const numeroCanale = (id) => Number(String(id).split(':')[1]) || null;

export function ruoloVoce(profilo) {
    const esterno = profilo.ruoli.includes('esterno');
    return {
        esterno,
        sala: profilo.squadra?.coc === true,
        coordinatore: !esterno && profilo.permessi.includes('emergenze.apertura'),
        caposquadra: profilo.squadra?.coc === false && profilo.squadra.caposquadra === true
    };
}

// Il volontario parla sulla sua squadra; il generale lo sentono tutti, ma ci parlano solo sala,
// chi coordina e capisquadra, perché non diventi il traffico di tutte le squadre. Gli avvisi
// arrivano a tutti, ma li manda solo chi coordina.
export function canaliDi(profilo, { squadre = [], diretti = [] } = {}) {
    const r = ruoloVoce(profilo);
    const canali = new Map();
    const aggiungi = (id, nome, parla, extra = {}) => {
        const prima = canali.get(id);
        canali.set(id, { ...prima, ...extra, id, tipo: tipoCanale(id), nome: prima?.nome ?? nome, parla: parla || prima?.parla === true });
    };

    const squadra = profilo.squadra && !profilo.squadra.coc ? profilo.squadra : null;
    if (squadra) aggiungi(canaleSquadra(squadra.id), squadra.nome_radio, !(r.esterno && profilo.voce_parla === false), { primo_piano: true });

    if (r.sala) {
        for (const s of squadre) aggiungi(canaleSquadra(s.id), s.nome_radio, true);
    }
    if (r.sala || r.coordinatore || squadra) aggiungi(GENERALE, 'Generale', r.sala || r.coordinatore || r.caposquadra);
    if (r.sala || r.coordinatore || squadra) aggiungi(AVVISI, 'Avvisi a tutti', r.sala || r.coordinatore);

    for (const d of diretti) {
        if (d.user_id === profilo.id) aggiungi(canaleDiretto(d.user_id), 'Diretto con la sala', true);
        else if (r.sala || r.coordinatore) aggiungi(canaleDiretto(d.user_id), d.nome, true);
    }
    return [...canali.values()];
}

export function prioritaConsentita(profilo, canale, priorita) {
    const r = ruoloVoce(profilo);
    if (priorita === 'emergenza') return true;
    if (canale === AVVISI) return priorita === 'alta';
    if (priorita === 'alta') return r.sala || r.coordinatore;
    return priorita === 'normale';
}

// Chi può aprire un canale diretto, e con chi: con chiunque sia in una squadra.
export const apreDiretti = (profilo) => {
    const r = ruoloVoce(profilo);
    return r.sala || r.coordinatore;
};

export async function leggiProfili(pool, ids) {
    if (!ids.length) return new Map();
    const { rows } = await pool.query(`
        SELECT u.id, u.username, u.nome, u.cognome,
               COALESCE(u.is_active, true) AND u.eliminato_il IS NULL AS attivo,
               (EXTRACT(EPOCH FROM u.sessioni_valide_dal) * 1000)::bigint AS valide_dal, u.voce_parla,
               ARRAY(SELECT ruolo::text FROM utenti_ruoli WHERE user_id = u.id) AS ruoli,
               ARRAY(SELECT permesso FROM utenti_permessi WHERE user_id = u.id) AS permessi_in_piu,
               sm.squadra_id, sm.caposquadra, sm.joined_at, s.nome_radio, s.coc
          FROM users u
          LEFT JOIN LATERAL (SELECT squadra_id, caposquadra, joined_at FROM squadra_membri
                              WHERE username = u.username ORDER BY joined_at DESC NULLS LAST LIMIT 1) sm ON true
          LEFT JOIN squadre s ON s.id = sm.squadra_id
         WHERE u.id = ANY($1::int[])`, [ids]);
    return new Map(rows.map(u => [u.id, {
        id: u.id,
        username: u.username,
        nome: `${u.nome || ''} ${u.cognome || ''}`.trim() || u.username,
        attivo: u.attivo === true,
        valide_dal: u.valide_dal == null ? null : Number(u.valide_dal),
        voce_parla: u.voce_parla !== false,
        ruoli: u.ruoli,
        permessi: permessiDi(u.ruoli, u.permessi_in_piu),
        squadra: u.squadra_id ? {
            id: u.squadra_id, nome_radio: u.nome_radio, coc: u.coc === true,
            caposquadra: u.caposquadra === true, entrato_il: u.joined_at
        } : null
    }]));
}

export async function leggiSquadre(pool) {
    return (await pool.query(
        `SELECT s.id, s.nome_radio, s.nome, (SELECT COUNT(*)::int FROM squadra_membri sm WHERE sm.squadra_id = s.id) AS membri
           FROM squadre s WHERE NOT s.coc ORDER BY s.nome_radio`)).rows;
}

export async function leggiDiretti(pool, emergencyId) {
    if (!emergencyId) return [];
    return (await pool.query(`
        SELECT d.user_id, TRIM(CONCAT(u.nome, ' ', u.cognome)) AS nome
          FROM voce_diretti d JOIN users u ON u.id = d.user_id
         WHERE d.emergency_id = $1 AND d.chiuso_il IS NULL AND COALESCE(u.is_active, true) AND u.eliminato_il IS NULL`, [emergencyId])).rows;
}
