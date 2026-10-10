import pg from 'pg';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';

// Carica le variabili d'ambiente (per le credenziali DB)
dotenv.config({ quiet: true });

const { Pool } = pg;

const createAdmin = async () => {
  // 1. Leggi i dati dell'admin e del DB dalle variabili d'ambiente
  const adminUsername = process.env.ADMIN_USERNAME;
  const adminPassword = process.env.ADMIN_PASSWORD;
  const adminNome = process.env.ADMIN_NOME || 'Admin';
  const adminCognome = process.env.ADMIN_COGNOME || 'User';
  const adminEmail = process.env.ADMIN_EMAIL || null;

  if (!adminUsername || !adminPassword) {
    console.error('ERRORE: ADMIN_USERNAME e ADMIN_PASSWORD devono essere impostati.');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: `postgres://${process.env.DB_USER}:${encodeURIComponent(process.env.DB_PASSWORD)}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_DATABASE}`,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
  });

  const client = await pool.connect();
  console.log('Connesso al database per creare utente admin...');

  try {
    // 2. Controlla se l'utente esiste già per rendere lo script rieseguibile
    const checkUser = await client.query('SELECT 1 FROM users WHERE username = $1', [adminUsername.toLowerCase()]);
    if (checkUser.rowCount > 0) {
      console.log(`L'utente admin '${adminUsername}' esiste già. Salto la creazione.`);
      return; // Esce con successo se l'utente esiste già
    }

    // 3. Crittografa la password
    console.log('Crittografia della password...');
    // Lo stesso costo delle password cambiate dal programma (12): con 10 la
    // password dell'amministratore era la piu' debole di tutte.
    const hashedPassword = await bcrypt.hash(adminPassword, 12);

    // 4. Inserisci il nuovo utente admin nel database
    console.log(`Inserimento utente '${adminUsername}' nel database...`);
    const insertQuery = `
      INSERT INTO users (username, password, role, nome, cognome, email)
      VALUES ($1, $2, 'admin', $3, $4, $5)
    `;
    await client.query(insertQuery, [
      adminUsername.toLowerCase(),
      hashedPassword,
      adminNome,
      adminCognome,
      adminEmail
    ]);

    console.log(`Utente admin '${adminUsername}' creato con successo!`);

  } catch (error) {
    console.error("ERRORE DURANTE LA CREAZIONE DELL'UTENTE ADMIN:", error);
    process.exit(1); // Esce con un codice di errore
  } finally {
    await client.release();
    await pool.end();
    console.log('Connessione al database chiusa.');
  }
};

// Esegui la funzione
createAdmin();
