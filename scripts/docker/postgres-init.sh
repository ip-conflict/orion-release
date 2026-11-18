#!/bin/bash
# Al primo avvio del database: ORION ha un ruolo suo, padrone del database ma non superutente.
# Nomi uguali a quelli di setup.sh: i backup passano da un'installazione classica ai container e ritorno.
set -euo pipefail
psql -v ON_ERROR_STOP=1 -v pw="$ORION_DB_PASSWORD" --username "$POSTGRES_USER" --dbname postgres <<'SQL'
CREATE ROLE orion_db_user LOGIN PASSWORD :'pw';
CREATE DATABASE orion_db OWNER orion_db_user;
SQL
