import logger from './logger.js';

// Un segreteria_config guasto (salvato a mano o da una versione vecchia) non deve far rispondere 500
// a chi lo legge: vale "Segreteria spenta".
export function leggiConfigSegreteria(valore) {
    if (valore == null || valore === '') return {};
    try {
        const config = typeof valore === 'string' ? JSON.parse(valore) : valore;
        if (config && typeof config === 'object' && !Array.isArray(config)) return config;
    } catch { /* sotto */ }
    logger.warn('[Impostazioni] segreteria_config illeggibile: la Segreteria vale spenta finché non si salva di nuovo dalle Impostazioni.');
    return {};
}
