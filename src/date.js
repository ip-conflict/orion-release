// src/date.js
//
// Le date senza ora arrivano da PostgreSQL come "AAAA-MM-GG" (vedi db.js) e si
// scrivono all'italiana senza passare da new Date(), che dipende dal fuso orario.


// Letto a ogni chiamata: .env si carica dopo gli import.
const fuso = () => process.env.TZ || 'Europe/Rome';

/** "2026-09-10" -> "10/09/2026". Accetta anche un Date o un timestamp ISO. */
export function dataItaliana(valore) {
    if (!valore) return '';
    if (valore instanceof Date) return valore.toLocaleDateString('it-IT', { timeZone: fuso() });
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(valore));
    if (m && String(valore).length === 10) return `${m[3]}/${m[2]}/${m[1]}`;
    const d = new Date(valore);
    return Number.isNaN(d.getTime()) ? String(valore) : d.toLocaleDateString('it-IT', { timeZone: fuso() });
}

/** Oggi in Italia, "AAAA-MM-GG". */
export function oggiLocale(adesso = new Date()) {
    // en-CA scrive le date proprio in questo formato.
    return new Intl.DateTimeFormat('en-CA', { timeZone: fuso(), year: 'numeric', month: '2-digit', day: '2-digit' }).format(adesso);
}
