import pg from 'pg';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';
import { opzioniSslDatabase } from './src/sslDatabase.js';

dotenv.config({ quiet: true });

const { Pool } = pg;

const createAdmin = async () => {
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
    ssl: opzioniSslDatabase()
  });

  const client = await pool.connect();
  console.log('Connesso al database per creare utente admin...');

  try {
    // Rieseguibile: se l'utente c'è già si ferma.
    const checkUser = await client.query('SELECT 1 FROM users WHERE username = $1', [adminUsername.toLowerCase()]);
    if (checkUser.rowCount > 0) {
      console.log(`L'utente admin '${adminUsername}' esiste già. Salto la creazione.`);
      return; // Esce con successo se l'utente esiste già
    }

    console.log('Crittografia della password...');
    // Lo stesso costo delle password cambiate dal programma.
    const hashedPassword = await bcrypt.hash(adminPassword, 12);

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

createAdmin();
