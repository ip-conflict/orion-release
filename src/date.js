// Le date senza ora non passano da new Date(), che dipende dal fuso orario.

// Letto a ogni chiamata: .env si carica dopo gli import.
const fuso = () => process.env.TZ || 'Europe/Rome';

export function dataItaliana(valore) {
    if (!valore) return '';
    if (valore instanceof Date) return valore.toLocaleDateString('it-IT', { timeZone: fuso() });
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(valore));
    if (m && String(valore).length === 10) return `${m[3]}/${m[2]}/${m[1]}`;
    const d = new Date(valore);
    return Number.isNaN(d.getTime()) ? String(valore) : d.toLocaleDateString('it-IT', { timeZone: fuso() });
}

export function oggiLocale(adesso = new Date()) {
    // en-CA scrive le date proprio in questo formato.
    return new Intl.DateTimeFormat('en-CA', { timeZone: fuso(), year: 'numeric', month: '2-digit', day: '2-digit' }).format(adesso);
}

export function dataOraItaliana(valore) {
    if (!valore) return '';
    const d = valore instanceof Date ? valore : new Date(String(valore).replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00'));
    if (Number.isNaN(d.getTime())) return String(valore);
    return d.toLocaleString('it-IT', { timeZone: fuso(), day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function oraItaliana(valore) {
    if (!valore) return '';
    const d = valore instanceof Date ? valore : new Date(String(valore).replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00'));
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('it-IT', { timeZone: fuso(), hour: '2-digit', minute: '2-digit' });
}

export const fusoOrario = fuso;
