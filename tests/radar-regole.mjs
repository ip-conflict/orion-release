// Le regole del radar che non hanno bisogno di rete: colori, controllo del formato delle tessere
// e dei fulmini, tessere da chiedere per ogni zoom, indirizzi, testi.
//   node tests/radar-regole.mjs

import { coloraTessera, colorePioggia, indirizzoTessera, leggiFulmini, pezziDellaTessera, testoStato } from '../public/js/radar-meteo.js';

let falliti = 0;
const verifica = (descr, ok, dettaglio = '') => {
    console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${descr}${ok ? '' : ` -> ${JSON.stringify(dettaglio)}`}`);
    if (!ok) falliti++;
};

console.log('\nColori della pioggia');
verifica('senza pioggia è trasparente', colorePioggia(0)[3] === 0, colorePioggia(0));
verifica('pioggia debole (2 mm/h) azzurra e piena', (([r, g, b, a]) => b > 200 && r < 160 && a > 200)(colorePioggia(0.02)), colorePioggia(0.02));
verifica('sotto mezzo millimetro non si disegna (è spesso rumore)', colorePioggia(1 / 255)[3] === 0, colorePioggia(1 / 255));
verifica('100 mm/h viola', (([r, g, b]) => r > 120 && g < 20 && b > 180)(colorePioggia(1)), colorePioggia(1));

console.log('\nTessere dei dati');
const tessera = (riempi) => { const px = new Uint8ClampedArray(256 * 256 * 4); for (let i = 0; i < px.length; i += 4) riempi(px, i, i / 4); return px; };
const grigia = tessera((px, i, n) => { px[i] = n % 256 < 128 ? 0 : 60; px[i + 3] = 255; });
verifica('il dato nel rosso si colora', coloraTessera(grigia, 256, 256) && grigia[3] === 0 && grigia[128 * 4 + 3] === 255);
const colorata = tessera((px, i) => { px[i] = 200; px[i + 1] = 120; px[i + 2] = 40; px[i + 3] = 255; });
verifica('una tessera già colorata vuol dire formato cambiato', coloraTessera(colorata, 256, 256) === false);
verifica('una tessera di misura diversa pure', coloraTessera(new Uint8ClampedArray(512 * 512 * 4), 512, 512) === false);
verifica('qualche pixel sporco della compressione non basta a scartarla',
    coloraTessera(tessera((px, i, n) => { px[i] = 80; px[i + 1] = n % 50 === 0 ? 40 : 0; px[i + 3] = 255; }), 256, 256));

console.log('\nFulmini');
const fulmine = (lat, lon) => {
    const x = Math.round((lon + 180) * 262144 / 360);
    const y = Math.round((lat + 90) * 262144 / 180);
    return [x & 0xffff, y & 0xffff, ((x >> 16) << 6) | ((y >> 16) << 4), 3];
};
const file = (punti, versione = 2) => {
    const v = new DataView(new ArrayBuffer(3 + punti.length * 6));
    v.setUint8(0, versione);
    v.setUint16(1, punti.length, false);
    punti.forEach(([x, y, alti, extra], i) => {
        v.setUint16(3 + i * 6, x, false);
        v.setUint16(5 + i * 6, y, false);
        v.setUint8(7 + i * 6, alti);
        v.setUint8(8 + i * 6, extra);
    });
    return v.buffer;
};
const letti = leggiFulmini(file([fulmine(45.9, 12.1), fulmine(38.1, 15.6)]));
verifica('due fulmini letti dove sono caduti', letti?.length === 2 && Math.abs(letti[0][0] - 45.9) < 0.001 && Math.abs(letti[1][1] - 15.6) < 0.002, letti);
verifica('un\'altra versione del formato si scarta', leggiFulmini(file([fulmine(45.9, 12.1)], 3)) === null);
verifica('un file troncato si scarta', leggiFulmini(file([fulmine(45.9, 12.1), fulmine(38.1, 15.6)]).slice(0, 10)) === null);
verifica('un file vuoto si scarta', leggiFulmini(new ArrayBuffer(0)) === null);

console.log('\nTessere da chiedere');
const z7 = pezziDellaTessera({ z: 7, x: 68, y: 47 });
verifica('a zoom 7 la tessera stessa', z7.length === 1 && z7[0].sl === 256);
const z9 = pezziDellaTessera({ z: 9, x: 68 * 4 + 1, y: 47 * 4 + 3 });
verifica('a zoom 9 un quarto della tessera 7, al posto giusto', z9.length === 1 && z9[0].x === 68 && z9[0].sl === 64 && z9[0].sx === 64 && z9[0].sy === 192, z9);
verifica('a zoom 5 le tessere 6 coperte', pezziDellaTessera({ z: 5, x: 16, y: 11 }).every(p => p.z === 6 && p.dl === 128));
verifica('fuori dall\'Italia nessuna richiesta', pezziDellaTessera({ z: 7, x: 10, y: 10 }).length === 0);
verifica('indirizzo nell\'archivio in ora UTC', indirizzoTessera(Date.UTC(2026, 9, 20, 18, 5), { z: 7, x: 68, y: 47 }).endsWith('/SRI/2026/10/20/1805/7/68/47/sri.webp'));

console.log('\nTesti');
const adesso = Date.UTC(2026, 9, 20, 18, 7);
const ultimo = Date.UTC(2026, 9, 20, 18, 5);
verifica('ultima immagine', testoStato({ modo: 'archivio', ultimo, istante: ultimo, adesso }).testo === "L'ultima immagine");
verifica('immagine di prima', testoStato({ modo: 'archivio', ultimo, istante: ultimo - 30 * 60_000, adesso }).testo === "30 minuti prima dell'ultima");
verifica('archivio guasto: si dice', /Solo l'ultima immagine/.test(testoStato({ modo: 'diretta', ultimo, istante: ultimo, adesso }).testo));
verifica('radar fermo', testoStato({ modo: 'archivio', ultimo: adesso - 45 * 60_000, istante: 0, adesso }).grave);
verifica('senza rete', testoStato({ ultimo: NaN, raggiungibile: false }).testo === 'Radar non raggiungibile');

console.log(falliti ? `\n${falliti} verifiche fallite.` : '\nTutto bene.');
process.exit(falliti ? 1 : 0);
