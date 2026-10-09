// Il magazzino è creato in server.js insieme alle sue rotte; qui resta a
// disposizione di chi lo usa fuori dalle rotte (giro quotidiano, squadre).

export let magazzino = null;

export function collegaMagazzino(istanza) {
    magazzino = istanza;
}
