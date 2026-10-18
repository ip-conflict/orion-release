import fs from 'fs';
import path from 'path';

async function leggiVersione(cartella) {
    try {
        return JSON.parse(await fs.promises.readFile(path.join(cartella, 'versione.json'), 'utf8'));
    } catch {
        return null;
    }
}

// Un APK messo a mano non si perde: quello nuovo entra solo se più recente e firmato con la stessa chiave.
export async function portaAppAndroid(origine, destinazione) {
    const nuova = await leggiVersione(origine);
    if (!Number.isInteger(nuova?.codice) || !fs.existsSync(path.join(origine, 'orion.apk'))) return { esito: 'assente' };
    const attuale = await leggiVersione(destinazione);
    if (attuale && fs.existsSync(path.join(destinazione, 'orion.apk'))) {
        if (Number.isInteger(attuale.codice) && attuale.codice >= nuova.codice) return { esito: 'uguale', nuova };
        if (attuale.certificato_sha256 && nuova.certificato_sha256 && attuale.certificato_sha256 !== nuova.certificato_sha256) {
            return { esito: 'altra-chiave', nuova };
        }
    }
    const temporaneo = path.join(destinazione, `.orion.apk.${process.pid}`);
    try {
        await fs.promises.mkdir(destinazione, { recursive: true });
        // Prima l'APK, poi versione.json: un telefono non deve vedere annunciata una versione che non si scarica ancora.
        await fs.promises.copyFile(path.join(origine, 'orion.apk'), temporaneo);
        await fs.promises.rename(temporaneo, path.join(destinazione, 'orion.apk'));
        await fs.promises.copyFile(path.join(origine, 'versione.json'), path.join(destinazione, 'versione.json'));
        for (const nome of ['orion.apk', 'versione.json']) await fs.promises.chmod(path.join(destinazione, nome), 0o644).catch(() => {});
        return { esito: 'copiata', nuova };
    } catch (e) {
        await fs.promises.rm(temporaneo, { force: true }).catch(() => {});
        return { esito: 'errore', nuova, errore: e.message };
    }
}
