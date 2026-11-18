// Tipo della segnalazione, doppioni vicini, avvisi della sala fuori sede, esportazione per Regione e Prefettura.
//   ORION_URL=http://localhost:3010 ORION_ADMIN_PASSWORD=... node tests/segnalazioni-nuove.mjs
// Apre un'emergenza di prova (chiude quella aperta, se c'è) e la chiude per esportarla; crea ed elimina le persone.

import { accediConFetch, prendiVisione, PASSWORD_PROVA } from './accesso-prova.mjs';

const BASE = (process.env.ORION_URL || 'http://localhost:3000').replace(/\/$/, '');
let falliti = 0;
const verifica = (descr, ok, dettaglio = '') => {
    console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${descr}${ok ? '' : ` -> ${typeof dettaglio === 'string' ? dettaglio : JSON.stringify(dettaglio)}`}`);
    if (!ok) falliti++;
};
const chiama = async (percorso, { method = 'GET', body, token } = {}) => {
    const r = await fetch(BASE + percorso, {
        method, body: body ? JSON.stringify(body) : undefined,
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }
    });
    const tipo = r.headers.get('content-type') || '';
    // Il BOM in testa al CSV si vede solo leggendo i byte: text() lo toglie.
    const testo = new TextDecoder('utf-8', { ignoreBOM: true }).decode(await r.arrayBuffer());
    let corpo = testo;
    if (tipo.includes('json')) { try { corpo = JSON.parse(testo); } catch { corpo = null; } }
    return { stato: r.status, tipo, disposizione: r.headers.get('content-disposition') || '', corpo };
};

console.log('\nSegnalazioni: tipo, vicine, avvisi della sala, esportazione');
const admin = (await accediConFetch(BASE, process.env.ORION_ADMIN_USER || 'admin', process.env.ORION_ADMIN_PASSWORD)).token;
const suffisso = Date.now().toString().slice(-5);
const persone = [];
let aperta = null;
async function persona(nome, role) {
    const n = (await chiama('/api/users', { method: 'POST', token: admin, body: { nome, cognome: `Nuove${suffisso}`, role } })).corpo;
    const q = new URL(n.magicLink).searchParams;
    const password = PASSWORD_PROVA;
    await chiama('/api/auth/reset-password', { method: 'POST', body: { token: q.get('token'), id: Number(q.get('id')), newPassword: password } });
    const token = (await chiama('/login', { method: 'POST', body: { username: n.username, password } })).corpo.token;
    await prendiVisione(BASE, token);
    persone.push(n.id);
    return { ...n, token };
}
const avvisiDi = async (token) => ((await chiama('/api/notifiche', { token })).corpo?.notifiche || []).filter(n => n.tipo === 'avviso_sala');

try {
    if ((await chiama('/api/emergencies/status', { token: admin })).corpo?.active) await chiama('/api/emergencies/close', { method: 'POST', token: admin, body: {} });
    const vol = await persona('Vito', 'volontario');
    const coord = await persona('Cora', 'coordinatore');

    const fuoriEmergenza = (await chiama('/api/app/contesto', { token: coord.token })).corpo?.capacita || [];
    verifica('in pace il coordinatore ha "Squadre" nell\'app ma non la sala', fuoriEmergenza.includes('squadre') && !fuoriEmergenza.includes('emergenza.sala'), fuoriEmergenza);

    const r = await chiama('/api/emergencies/open', { method: 'POST', token: admin, body: { external_code: `NUOVE-${suffisso}` } });
    aperta = r.corpo?.emergency?.id ?? null;
    verifica('emergenza di prova aperta', !!aperta, r.corpo);

    const tipi = (await chiama('/api/segnalazioni/tipi', { token: vol.token })).corpo || {};
    verifica('i tipi sono sette, "altro" compreso', Object.keys(tipi).length === 7 && 'altro' in tipi && 'allagamento' in tipi, tipi);

    const crea = (body, token = admin) => chiama('/api/reports', { method: 'POST', token, body });
    const senzaTipo = (await crea({ title: `Senza tipo ${suffisso}`, latitude: 46.0200, longitude: 11.9100 })).corpo;
    const lettura = async (id) => (await chiama(`/api/reports/${id}`, { token: admin })).corpo?.report;
    verifica('senza tipo vale "altro"', (await lettura(senzaTipo.id))?.tipo === 'altro', await lettura(senzaTipo.id));
    verifica('un tipo inventato -> 400', (await crea({ title: 'Tipo sbagliato', tipo: 'meteorite' })).stato === 400);
    const cantina = (await crea({ title: `=SOMMA(A1:A9) cantina ${suffisso}`, tipo: 'allagamento', priority: 'High', latitude: 46.0300, longitude: 11.9200, location_address: 'Via "Monte"; 3' })).corpo;
    verifica('il tipo scelto resta', (await lettura(cantina.id))?.tipo === 'allagamento');
    verifica('il tipo si cambia', (await chiama(`/api/reports/${senzaTipo.id}`, { method: 'PUT', token: admin, body: { tipo: 'albero' } })).stato === 200
        && (await lettura(senzaTipo.id))?.tipo === 'albero');
    verifica('cambiato in un tipo inventato -> 400', (await chiama(`/api/reports/${senzaTipo.id}`, { method: 'PUT', token: admin, body: { tipo: 'meteorite' } })).stato === 400);
    const elenco = (await chiama(`/api/reports?status_type=active&limit=100&emergency_id=${aperta}`, { token: admin })).corpo?.reports || [];
    verifica("l'elenco porta il tipo", elenco.find(x => x.id === cantina.id)?.tipo === 'allagamento', elenco.find(x => x.id === cantina.id));

    const vicine = (lat, lon, token = admin) => chiama(`/api/reports/vicine?lat=${lat}&lon=${lon}`, { token });
    const a50 = await vicine(46.0304, 11.9200);
    verifica('a 45 metri la segnalazione aperta compare fra le vicine', a50.stato === 200 && a50.corpo?.[0]?.id === cantina.id && a50.corpo[0].metri < 60, a50.corpo);
    const a300 = await vicine(46.0330, 11.9200);
    verifica('a 330 metri no', a300.stato === 200 && !a300.corpo.some(x => x.id === cantina.id), a300.corpo);
    verifica('senza coordinate -> 400', (await chiama('/api/reports/vicine?lat=abc', { token: admin })).stato === 400);
    verifica('fuori scala -> 400', (await vicine(95, 11)).stato === 400);

    verifica('il coordinatore riceve l\'avviso della segnalazione ad alta priorità', (await avvisiDi(coord.token)).some(n => /alta priorità/.test(n.titolo) && n.riferimento_id === cantina.id),
        await avvisiDi(coord.token));
    verifica('il volontario no', (await avvisiDi(vol.token)).length === 0);
    verifica('chi la crea non avvisa sé stesso', !(await avvisiDi(admin)).some(n => n.riferimento_id === cantina.id));

    const statoAvvisi = (await chiama('/api/users/me/avvisi-sala', { token: coord.token })).corpo;
    verifica('al coordinatore gli avvisi si offrono, accesi', statoAvvisi?.disponibile === true && statoAvvisi?.attivo === true, statoAvvisi);
    const delVolontario = (await chiama('/api/users/me/avvisi-sala', { token: vol.token })).corpo;
    verifica('al volontario non si offrono', delVolontario?.disponibile === false, delVolontario);
    verifica('il volontario non li accende -> 403', (await chiama('/api/users/me/avvisi-sala', { method: 'PUT', token: vol.token, body: { attivo: true } })).stato === 403);
    verifica('"si" non è un valore -> 400', (await chiama('/api/users/me/avvisi-sala', { method: 'PUT', token: coord.token, body: { attivo: 'si' } })).stato === 400);
    verifica('il coordinatore li spegne', (await chiama('/api/users/me/avvisi-sala', { method: 'PUT', token: coord.token, body: { attivo: false } })).corpo?.attivo === false);
    const seconda = (await crea({ title: `Tetto scoperchiato ${suffisso}`, tipo: 'struttura', priority: 'High' })).corpo;
    verifica('la seconda ad alta priorità si crea', Number.isInteger(seconda?.id), seconda);
    verifica('spenti, non arriva più niente', !(await avvisiDi(coord.token)).some(n => n.riferimento_id === seconda.id));

    const inEmergenza = (await chiama('/api/app/contesto', { token: coord.token })).corpo?.capacita || [];
    verifica("in emergenza il coordinatore ha la sala nell'app", inEmergenza.includes('emergenza.sala') && inEmergenza.includes('squadre'), inEmergenza);
    const delVol = (await chiama('/api/app/contesto', { token: vol.token })).corpo?.capacita || [];
    verifica('il volontario fuori squadra non ha né sala né squadre', !delVol.includes('emergenza.sala') && !delVol.includes('squadre'), delVol);

    const csv = (id, token = admin) => chiama(`/api/admin/emergencies/${id}/segnalazioni.csv`, { token });
    verifica("un'emergenza aperta non si esporta -> 409", (await csv(aperta)).stato === 409);
    await chiama('/api/emergencies/close', { method: 'POST', token: admin, body: {} });
    const chiusa = aperta;
    aperta = null;
    const esportato = await csv(chiusa);
    const righe = String(esportato.corpo).split('\r\n');
    verifica('CSV: scaricato come file, con il BOM per Excel', esportato.stato === 200 && /attachment/.test(esportato.disposizione) && righe[0].startsWith('﻿Numero;Tipo;'), righe[0]);
    const rigaCantina = righe.find(x => x.includes('cantina'));
    verifica('CSV: il titolo che pare una formula resta testo', rigaCantina?.includes(";'=SOMMA(A1:A9) cantina"), rigaCantina);
    verifica('CSV: virgolette e punto e virgola dentro le celle', rigaCantina?.includes('"Via ""Monte""; 3"'), rigaCantina);
    verifica('CSV: il tipo scritto per esteso', rigaCantina?.includes(`;${tipi.allagamento};`), rigaCantina);
    verifica('CSV: tutte e tre le segnalazioni', righe.filter(x => x.trim()).length === 4, righe);
    verifica('CSV: il volontario no -> 403', (await csv(chiusa, vol.token)).stato === 403);
    verifica('CSV: emergenza che non c\'è -> 404', (await csv(999999)).stato === 404);
    const geo = await chiama(`/api/admin/emergencies/${chiusa}/mappa.geojson`, { token: admin });
    const geoJson = typeof geo.corpo === 'string' ? JSON.parse(geo.corpo) : geo.corpo;
    const puntoCantina = geoJson?.features?.find(f => f.properties?.numero === cantina.emergency_report_number);
    verifica('GeoJSON: punti con le coordinate nell\'ordine giusto (lon, lat)', geoJson?.type === 'FeatureCollection' && puntoCantina?.geometry?.coordinates?.[0] === 11.92, puntoCantina);
    verifica('GeoJSON: la segnalazione senza punto resta fuori', geoJson?.features?.filter(f => f.properties?.tipo_elemento === 'segnalazione').length === 2, geoJson?.features?.length);
    const audit = (await chiama('/api/admin/audit-log?limit=20', { token: admin })).corpo;
    verifica("l'esportazione resta nel registro", JSON.stringify(audit || '').includes('emergenza.esportata'), typeof audit);
} finally {
    if (aperta) await chiama('/api/emergencies/close', { method: 'POST', token: admin, body: {} });
    for (const p of persone) await chiama(`/api/users/${p}`, { method: 'DELETE', token: admin, body: { beni: [] } });
}

console.log(falliti === 0 ? '\nSegnalazioni nuove: tutto a posto\n' : `\nSegnalazioni nuove: ${falliti} verifiche fallite\n`);
process.exit(falliti === 0 ? 0 : 1);
