// src/authHelper.js 
import jwt from 'jsonwebtoken';

function verifyJwtToken(token) {
  return new Promise((resolve, reject) => {
    if (!token) {

      const error = new Error("Token non fornito");
      error.name = 'MissingTokenError';
      return reject(error);
    }
    // Solo HS256, l'algoritmo con cui si firmano i token.
    jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] }, (err, decodedUser) => {
      if (err) {

        console.error('Errore verifica JWT:', err.message); // Log centrale opzionale
        return reject(err);
      }

      resolve(decodedUser);
    });
  });
}


export { verifyJwtToken };
