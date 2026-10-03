-- ORION 1.0: lo schema completo del database e i dati di partenza.
--
-- Riunisce le 37 migrazioni della numerazione interna 3.x (da
-- initial-schema a v3-update-36-tabelle-inutilizzate): e' il risultato di
-- applicarle a un database vuoto, estratto con pg_dump (--no-owner
-- --no-privileges --column-inserts, senza la tabella pgmigrations) e ripulito
-- dalle impostazioni di sessione. Lo applica la migrazione
-- migrations/1790985600000_orion-1-0.cjs.
--
-- Non si modifica a mano: ogni cambiamento allo schema e' una migrazione
-- nuova (npm run migrate:create -- nome).

-- Le funzioni SQL si creano prima delle tabelle che leggono.
SET LOCAL check_function_bodies = false;

--
-- PostgreSQL database dump
--

--
-- Name: bene_tipo; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.bene_tipo AS ENUM (
    'dpi',
    'attrezzatura',
    'veicolo'
);

--
-- Name: movimento_tipo; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.movimento_tipo AS ENUM (
    'carico',
    'consegna',
    'rientro',
    'trasferimento',
    'manutenzione',
    'consumo',
    'smarrimento',
    'dismissione',
    'rettifica'
);

--
-- Name: user_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.user_role AS ENUM (
    'volontario',
    'esterno',
    'admin',
    'segreteria',
    'magazziniere'
);

--
-- Name: controlla_ruolo_esterno(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.controlla_ruolo_esterno() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM utenti_ruoli
                WHERE user_id = NEW.user_id
                  AND (ruolo = 'esterno') <> (NEW.ruolo = 'esterno')
            ) THEN
                RAISE EXCEPTION 'Il ruolo esterno non può essere combinato con altri ruoli (utente %)', NEW.user_id;
            END IF;
            RETURN NEW;
        END;
        $$;

--
-- Name: etichetta_iniziale_bene(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.etichetta_iniziale_bene() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
        DECLARE
            tentativo text;
        BEGIN
            IF NEW.codice_etichetta IS NULL THEN
                LOOP
                    tentativo := genera_codice_etichetta();
                    EXIT WHEN NOT EXISTS (SELECT 1 FROM beni WHERE codice_etichetta = tentativo);
                END LOOP;
                NEW.codice_etichetta := tentativo;
            END IF;
            RETURN NEW;
        END;
        $$;

--
-- Name: genera_codice_etichetta(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.genera_codice_etichetta() RETURNS text
    LANGUAGE plpgsql
    AS $$
        DECLARE
            alfabeto text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
            codice text := '';
            i integer;
        BEGIN
            FOR i IN 1..6 LOOP
                codice := codice || substr(alfabeto, floor(random() * length(alfabeto) + 1)::int, 1);
            END LOOP;
            RETURN codice;
        END;
        $$;

--
-- Name: ruolo_iniziale_utente(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ruolo_iniziale_utente() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
        BEGIN
            INSERT INTO utenti_ruoli (user_id, ruolo)
            VALUES (NEW.id, NEW.role)
            ON CONFLICT DO NOTHING;
            RETURN NULL;
        END;
        $$;

--
-- Name: accessi_temporanei; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.accessi_temporanei (
    id integer NOT NULL,
    user_id integer NOT NULL,
    impronta character varying(64) NOT NULL,
    creato_il timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    creato_da character varying(100),
    scade_il timestamp with time zone NOT NULL,
    usato_il timestamp with time zone
);

--
-- Name: accessi_temporanei_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.accessi_temporanei_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: accessi_temporanei_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.accessi_temporanei_id_seq OWNED BY public.accessi_temporanei.id;

--
-- Name: audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_log (
    id integer NOT NULL,
    occurred_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    user_id integer,
    username character varying(100),
    action character varying(100) NOT NULL,
    entity_type character varying(50),
    entity_id character varying(100),
    details jsonb,
    ip_address character varying(64)
);

--
-- Name: audit_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.audit_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: audit_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.audit_log_id_seq OWNED BY public.audit_log.id;

--
-- Name: avvisi_magazzino; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.avvisi_magazzino (
    user_id integer NOT NULL,
    attivo boolean DEFAULT true NOT NULL,
    frequenza character varying(12) DEFAULT 'settimanale'::character varying NOT NULL,
    giorni_preavviso integer DEFAULT 30 NOT NULL,
    includi_da_recuperare boolean DEFAULT true NOT NULL,
    ultimo_invio date,
    aggiornato_il timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT avvisi_magazzino_frequenza_check CHECK (((frequenza)::text = ANY ((ARRAY['giornaliera'::character varying, 'settimanale'::character varying, 'mensile'::character varying])::text[]))),
    CONSTRAINT avvisi_magazzino_preavviso_check CHECK (((giorni_preavviso >= 1) AND (giorni_preavviso <= 365)))
);

--
-- Name: beni; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.beni (
    id integer NOT NULL,
    tipo public.bene_tipo NOT NULL,
    gestione character varying(10) DEFAULT 'singolo'::character varying NOT NULL,
    categoria_id integer,
    denominazione character varying(150) NOT NULL,
    codice_etichetta character varying(50),
    matricola character varying(80),
    taglia character varying(20),
    unita_misura character varying(20) DEFAULT 'pezzi'::character varying NOT NULL,
    quantita_totale numeric(12,2) DEFAULT 1 NOT NULL,
    ubicazione_id integer,
    km integer,
    patente_richiesta character varying(20),
    posti integer,
    data_acquisto date,
    valore numeric(12,2),
    fornitore character varying(150),
    note text,
    dismesso_il timestamp with time zone,
    creato_il timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    creato_da character varying(100),
    modello_id integer,
    CONSTRAINT beni_gestione_check CHECK (((gestione)::text = ANY ((ARRAY['singolo'::character varying, 'quantita'::character varying])::text[]))),
    CONSTRAINT beni_quantita_check CHECK (((((gestione)::text = 'singolo'::text) AND (quantita_totale = (1)::numeric)) OR (((gestione)::text = 'quantita'::text) AND (quantita_totale >= (0)::numeric)))),
    CONSTRAINT beni_veicolo_singolo_check CHECK (((tipo <> 'veicolo'::public.bene_tipo) OR ((gestione)::text = 'singolo'::text)))
);

--
-- Name: beni_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.beni_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: beni_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.beni_id_seq OWNED BY public.beni.id;

--
-- Name: beni_scadenze; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.beni_scadenze (
    id integer NOT NULL,
    bene_id integer NOT NULL,
    tipo character varying(30) NOT NULL,
    scadenza date NOT NULL,
    ultimo_controllo date,
    documento_url character varying(255),
    note text,
    aggiornata_il timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    periodicita_mesi integer,
    CONSTRAINT beni_scadenze_periodicita_check CHECK (((periodicita_mesi IS NULL) OR ((periodicita_mesi > 0) AND (periodicita_mesi <= 120)))),
    CONSTRAINT beni_scadenze_tipo_check CHECK (((tipo)::text = ANY ((ARRAY['revisione'::character varying, 'assicurazione'::character varying, 'bollo'::character varying, 'tagliando'::character varying, 'verifica_periodica'::character varying, 'scadenza_dpi'::character varying, 'collaudo'::character varying, 'manutenzione'::character varying])::text[])))
);

--
-- Name: beni_scadenze_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.beni_scadenze_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: beni_scadenze_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.beni_scadenze_id_seq OWNED BY public.beni_scadenze.id;

--
-- Name: movimenti; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.movimenti (
    id integer NOT NULL,
    bene_id integer NOT NULL,
    tipo public.movimento_tipo NOT NULL,
    quantita numeric(12,2) DEFAULT 1 NOT NULL,
    destinatario_tipo character varying(15) NOT NULL,
    destinatario_user_id integer,
    destinatario_squadra_id integer,
    destinatario_bene_id integer,
    destinatario_ubicazione_id integer,
    destinatario_nome character varying(150),
    bene_denominazione character varying(150) NOT NULL,
    emergency_id integer,
    verbale_id integer,
    km_registrati integer,
    note text,
    quando timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    eseguito_da character varying(100),
    eseguito_da_id integer,
    proveniva_da character varying(15),
    proveniva_user_id integer,
    proveniva_squadra_id integer,
    proveniva_bene_id integer,
    CONSTRAINT movimenti_destinatario_check CHECK (((destinatario_tipo)::text = ANY ((ARRAY['magazzino'::character varying, 'persona'::character varying, 'squadra'::character varying, 'veicolo'::character varying, 'officina'::character varying, 'esterno'::character varying, 'consumato'::character varying, 'perso'::character varying, 'dismesso'::character varying])::text[]))),
    CONSTRAINT movimenti_proveniva_check CHECK (((proveniva_da IS NULL) OR ((proveniva_da)::text = ANY ((ARRAY['magazzino'::character varying, 'persona'::character varying, 'squadra'::character varying, 'veicolo'::character varying, 'officina'::character varying, 'esterno'::character varying])::text[])))),
    CONSTRAINT movimenti_quantita_check CHECK ((((tipo = 'rettifica'::public.movimento_tipo) AND (quantita <> (0)::numeric)) OR ((tipo <> 'rettifica'::public.movimento_tipo) AND (quantita > (0)::numeric))))
);

--
-- Name: movimenti_effetti; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.movimenti_effetti AS
 SELECT id,
    bene_id,
    tipo,
    quantita,
    destinatario_tipo,
    destinatario_user_id,
    destinatario_squadra_id,
    destinatario_bene_id,
    destinatario_ubicazione_id,
    destinatario_nome,
    bene_denominazione,
    emergency_id,
    verbale_id,
    km_registrati,
    note,
    quando,
    eseguito_da,
    eseguito_da_id,
    proveniva_da,
        CASE tipo
            WHEN 'carico'::public.movimento_tipo THEN quantita
            WHEN 'rientro'::public.movimento_tipo THEN quantita
            WHEN 'rettifica'::public.movimento_tipo THEN quantita
            WHEN 'consegna'::public.movimento_tipo THEN (- quantita)
            WHEN 'manutenzione'::public.movimento_tipo THEN (- quantita)
            WHEN 'dismissione'::public.movimento_tipo THEN
            CASE
                WHEN ((COALESCE(proveniva_da, 'magazzino'::character varying))::text = 'magazzino'::text) THEN (- quantita)
                ELSE (0)::numeric
            END
            WHEN 'smarrimento'::public.movimento_tipo THEN
            CASE
                WHEN ((proveniva_da)::text = 'magazzino'::text) THEN (- quantita)
                ELSE (0)::numeric
            END
            ELSE (0)::numeric
        END AS effetto_magazzino,
        CASE tipo
            WHEN 'consegna'::public.movimento_tipo THEN quantita
            WHEN 'rientro'::public.movimento_tipo THEN (- quantita)
            WHEN 'consumo'::public.movimento_tipo THEN (- quantita)
            WHEN 'smarrimento'::public.movimento_tipo THEN
            CASE
                WHEN ((COALESCE(proveniva_da, 'persona'::character varying))::text <> 'magazzino'::text) THEN (- quantita)
                ELSE (0)::numeric
            END
            WHEN 'dismissione'::public.movimento_tipo THEN
            CASE
                WHEN ((COALESCE(proveniva_da, 'magazzino'::character varying))::text <> 'magazzino'::text) THEN (- quantita)
                ELSE (0)::numeric
            END
            ELSE (0)::numeric
        END AS effetto_fuori
   FROM public.movimenti m;

--
-- Name: beni_situazione; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.beni_situazione AS
 SELECT b.id AS bene_id,
    b.gestione,
    ultimo.tipo AS ultimo_movimento,
    ultimo.destinatario_tipo,
    ultimo.destinatario_user_id,
    ultimo.destinatario_squadra_id,
    ultimo.destinatario_bene_id,
    ultimo.destinatario_nome,
    ultimo.quando AS ultimo_movimento_il,
    COALESCE(conti.in_magazzino, (0)::numeric) AS in_magazzino,
    COALESCE(conti.fuori, (0)::numeric) AS fuori,
        CASE
            WHEN (b.dismesso_il IS NOT NULL) THEN false
            WHEN ((b.gestione)::text = 'singolo'::text) THEN ((COALESCE(ultimo.destinatario_tipo, 'magazzino'::character varying))::text = 'magazzino'::text)
            ELSE (COALESCE(conti.in_magazzino, (0)::numeric) > (0)::numeric)
        END AS disponibile
   FROM ((public.beni b
     LEFT JOIN LATERAL ( SELECT m.tipo,
            m.destinatario_tipo,
            m.destinatario_user_id,
            m.destinatario_squadra_id,
            m.destinatario_bene_id,
            m.destinatario_nome,
            m.quando
           FROM public.movimenti m
          WHERE (m.bene_id = b.id)
          ORDER BY m.quando DESC, m.id DESC
         LIMIT 1) ultimo ON (true))
     LEFT JOIN LATERAL ( SELECT sum(e.effetto_magazzino) AS in_magazzino,
            sum(e.effetto_fuori) AS fuori
           FROM public.movimenti_effetti e
          WHERE (e.bene_id = b.id)) conti ON (true));

--
-- Name: branding_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.branding_settings (
    setting_key character varying(255) NOT NULL,
    setting_value text,
    updated_at timestamp with time zone DEFAULT now()
);

--
-- Name: TABLE branding_settings; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.branding_settings IS 'Tabella per memorizzare le impostazioni di branding e personalizzazione come nome associazione, centro mappa, zoom, etc.';

--
-- Name: categorie_beni; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.categorie_beni (
    id integer NOT NULL,
    tipo public.bene_tipo NOT NULL,
    nome character varying(100) NOT NULL,
    creata_il timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

--
-- Name: categorie_beni_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.categorie_beni_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: categorie_beni_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.categorie_beni_id_seq OWNED BY public.categorie_beni.id;

--
-- Name: courses_catalog; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.courses_catalog (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    validity_months integer,
    course_code character varying(50)
);

--
-- Name: courses_catalog_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.courses_catalog_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: courses_catalog_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.courses_catalog_id_seq OWNED BY public.courses_catalog.id;

--
-- Name: detenzioni_sfusi; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.detenzioni_sfusi AS
 SELECT m.id AS movimento_id,
    m.bene_id,
    m.destinatario_tipo AS detentore_tipo,
    m.destinatario_user_id AS user_id,
    m.destinatario_squadra_id AS squadra_id,
    m.destinatario_bene_id AS veicolo_id,
    m.quantita AS variazione,
    m.quando,
    m.destinatario_nome AS detentore_nome
   FROM (public.movimenti m
     JOIN public.beni b ON ((b.id = m.bene_id)))
  WHERE (((b.gestione)::text = 'quantita'::text) AND (m.tipo = ANY (ARRAY['consegna'::public.movimento_tipo, 'trasferimento'::public.movimento_tipo])) AND ((m.destinatario_tipo)::text = ANY ((ARRAY['persona'::character varying, 'squadra'::character varying, 'veicolo'::character varying])::text[])))
UNION ALL
 SELECT m.id AS movimento_id,
    m.bene_id,
    m.proveniva_da AS detentore_tipo,
    m.proveniva_user_id AS user_id,
    m.proveniva_squadra_id AS squadra_id,
    m.proveniva_bene_id AS veicolo_id,
    (- m.quantita) AS variazione,
    m.quando,
    NULL::character varying AS detentore_nome
   FROM (public.movimenti m
     JOIN public.beni b ON ((b.id = m.bene_id)))
  WHERE (((b.gestione)::text = 'quantita'::text) AND (m.tipo = ANY (ARRAY['rientro'::public.movimento_tipo, 'consumo'::public.movimento_tipo, 'smarrimento'::public.movimento_tipo, 'dismissione'::public.movimento_tipo, 'trasferimento'::public.movimento_tipo])) AND ((m.proveniva_da)::text = ANY ((ARRAY['persona'::character varying, 'squadra'::character varying, 'veicolo'::character varying])::text[])) AND ((m.proveniva_user_id IS NOT NULL) OR (m.proveniva_squadra_id IS NOT NULL) OR (m.proveniva_bene_id IS NOT NULL)));

--
-- Name: diario_sala; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.diario_sala (
    id integer NOT NULL,
    emergency_id integer NOT NULL,
    testo text NOT NULL,
    autore_id integer,
    autore_nome character varying(200),
    creata_il timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: diario_sala_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.diario_sala_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: diario_sala_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.diario_sala_id_seq OWNED BY public.diario_sala.id;

--
-- Name: emergencies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.emergencies (
    id integer NOT NULL,
    code character varying(100) NOT NULL,
    name character varying(255),
    start_time timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    end_time timestamp with time zone,
    status character varying(20) DEFAULT 'ACTIVE'::character varying NOT NULL,
    log_file_path character varying(255),
    log_generated_at timestamp with time zone
);

--
-- Name: emergencies_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.emergencies_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: emergencies_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.emergencies_id_seq OWNED BY public.emergencies.id;

--
-- Name: emergency_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.emergency_documents (
    id integer NOT NULL,
    emergency_id integer NOT NULL,
    uploader_user_id integer NOT NULL,
    file_path character varying(255) NOT NULL,
    original_filename character varying(255) NOT NULL,
    file_mime_type character varying(100),
    description text,
    uploaded_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

--
-- Name: emergency_documents_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.emergency_documents_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: emergency_documents_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.emergency_documents_id_seq OWNED BY public.emergency_documents.id;

--
-- Name: emergency_team_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.emergency_team_log (
    id integer NOT NULL,
    emergency_id integer NOT NULL,
    squadra_id integer,
    nome_radio character varying(15) NOT NULL,
    squadra_nome character varying(255),
    username character varying(50),
    nome character varying(50),
    cognome character varying(50),
    azione character varying(20) NOT NULL,
    motivo character varying(30) DEFAULT 'operazione'::character varying NOT NULL,
    quando timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    eseguita_da character varying(100),
    CONSTRAINT emergency_team_log_azione_check CHECK (((azione)::text = ANY ((ARRAY['membro_aggiunto'::character varying, 'membro_rimosso'::character varying, 'squadra_eliminata'::character varying])::text[]))),
    CONSTRAINT emergency_team_log_motivo_check CHECK (((motivo)::text = ANY ((ARRAY['operazione'::character varying, 'apertura_emergenza'::character varying, 'chiusura_emergenza'::character varying, 'squadra_eliminata'::character varying])::text[])))
);

--
-- Name: emergency_team_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.emergency_team_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: emergency_team_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.emergency_team_log_id_seq OWNED BY public.emergency_team_log.id;

--
-- Name: interventi_manutenzione; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.interventi_manutenzione (
    id integer NOT NULL,
    bene_id integer NOT NULL,
    tipo character varying(30) NOT NULL,
    eseguito_il date NOT NULL,
    descrizione text,
    documento_url character varying(255),
    costo numeric(12,2),
    fornitore character varying(150),
    registrato_da character varying(100),
    registrato_il timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

--
-- Name: interventi_manutenzione_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.interventi_manutenzione_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: interventi_manutenzione_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.interventi_manutenzione_id_seq OWNED BY public.interventi_manutenzione.id;

--
-- Name: medical_visit_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.medical_visit_types (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    validity_months integer
);

--
-- Name: medical_visit_types_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.medical_visit_types_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: medical_visit_types_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.medical_visit_types_id_seq OWNED BY public.medical_visit_types.id;

--
-- Name: modelli_dpi; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.modelli_dpi (
    id integer NOT NULL,
    nome character varying(150) NOT NULL,
    categoria_id integer,
    taglie text[] DEFAULT '{}'::text[] NOT NULL,
    unita_misura character varying(20) DEFAULT 'pezzi'::character varying NOT NULL,
    standard boolean DEFAULT false NOT NULL,
    nascosto boolean DEFAULT false NOT NULL,
    creato_il timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

--
-- Name: modelli_dpi_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.modelli_dpi_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: modelli_dpi_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.modelli_dpi_id_seq OWNED BY public.modelli_dpi.id;

--
-- Name: movimenti_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.movimenti_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: movimenti_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.movimenti_id_seq OWNED BY public.movimenti.id;

--
-- Name: notifiche; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifiche (
    id integer NOT NULL,
    user_id integer NOT NULL,
    tipo character varying(40) NOT NULL,
    titolo character varying(120) NOT NULL,
    testo text,
    riferimento_tipo character varying(30),
    riferimento_id integer,
    chiave character varying(160),
    creata_il timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    letta_il timestamp with time zone,
    categoria character varying(20) DEFAULT 'personale'::character varying NOT NULL,
    scade_il timestamp with time zone,
    CONSTRAINT notifiche_categoria_check CHECK (((categoria)::text = ANY ((ARRAY['emergenza'::character varying, 'personale'::character varying, 'segreteria'::character varying, 'magazzino'::character varying])::text[])))
);

--
-- Name: notifiche_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.notifiche_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: notifiche_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.notifiche_id_seq OWNED BY public.notifiche.id;

--
-- Name: posizioni_squadre; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.posizioni_squadre (
    squadra_id integer NOT NULL,
    squadra_name character varying(255),
    latitude numeric(10,8),
    longitude numeric(11,8),
    last_update timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

--
-- Name: report_images; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.report_images (
    image_id integer NOT NULL,
    report_id integer NOT NULL,
    image_url text NOT NULL,
    uploaded_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    caption text
);

--
-- Name: report_images_image_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.report_images_image_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: report_images_image_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.report_images_image_id_seq OWNED BY public.report_images.image_id;

--
-- Name: report_team_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.report_team_assignments (
    assignment_id integer NOT NULL,
    report_id integer NOT NULL,
    squadra_id integer NOT NULL,
    assigned_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    removed_at timestamp without time zone
);

--
-- Name: report_team_assignments_assignment_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.report_team_assignments_assignment_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: report_team_assignments_assignment_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.report_team_assignments_assignment_id_seq OWNED BY public.report_team_assignments.assignment_id;

--
-- Name: report_updates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.report_updates (
    id integer NOT NULL,
    report_id integer NOT NULL,
    update_timestamp timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    update_text text NOT NULL,
    user_id integer NOT NULL,
    is_system boolean DEFAULT false NOT NULL
);

--
-- Name: report_updates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.report_updates_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: report_updates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.report_updates_id_seq OWNED BY public.report_updates.id;

--
-- Name: reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reports (
    id integer NOT NULL,
    title character varying(255) NOT NULL,
    description text,
    location_address text,
    status character varying(50) DEFAULT 'New'::character varying NOT NULL,
    priority character varying(50) DEFAULT 'Medium'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    creator_user_id integer NOT NULL,
    environmental_hazard text,
    emergency_id integer,
    reporter_name text,
    reporter_contact text,
    latitude numeric(10,7),
    longitude numeric(10,7),
    emergency_report_number integer,
    no_team_reason character varying(30),
    CONSTRAINT reports_no_team_reason_check CHECK (((no_team_reason IS NULL) OR ((no_team_reason)::text = ANY ((ARRAY['altro_ente'::character varying, 'monitoraggio'::character varying, 'nessun_intervento'::character varying])::text[]))))
);

--
-- Name: reports_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.reports_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: reports_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.reports_id_seq OWNED BY public.reports.id;

--
-- Name: revoked_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.revoked_tokens (
    token text NOT NULL,
    revoked_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

--
-- Name: richieste_idempotenti; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.richieste_idempotenti (
    user_id integer NOT NULL,
    chiave character varying(100) NOT NULL,
    rotta character varying(60) NOT NULL,
    impronta character varying(64) NOT NULL,
    stato_risposta integer,
    risposta jsonb,
    creata_il timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

--
-- Name: squadra_membri; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.squadra_membri (
    squadra_id integer NOT NULL,
    username character varying(50),
    nome character varying(50),
    cognome character varying(50),
    joined_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    left_at timestamp without time zone,
    id integer NOT NULL
);

--
-- Name: squadra_membri_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.squadra_membri_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: squadra_membri_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.squadra_membri_id_seq OWNED BY public.squadra_membri.id;

--
-- Name: squadre; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.squadre (
    id integer NOT NULL,
    nome character varying(255),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    target integer,
    nome_radio character varying(15) NOT NULL
);

--
-- Name: squadre_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.squadre_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: squadre_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.squadre_id_seq OWNED BY public.squadre.id;

--
-- Name: token_rinnovo; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.token_rinnovo (
    id integer NOT NULL,
    user_id integer NOT NULL,
    impronta character varying(64) NOT NULL,
    dispositivo character varying(100),
    creato_il timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    usato_il timestamp with time zone,
    scade_il timestamp with time zone NOT NULL
);

--
-- Name: token_rinnovo_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.token_rinnovo_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: token_rinnovo_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.token_rinnovo_id_seq OWNED BY public.token_rinnovo.id;

--
-- Name: ubicazioni; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ubicazioni (
    id integer NOT NULL,
    nome character varying(100) NOT NULL,
    tipo character varying(20) DEFAULT 'sede'::character varying NOT NULL,
    note text,
    attiva boolean DEFAULT true NOT NULL,
    creata_il timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT ubicazioni_tipo_check CHECK (((tipo)::text = ANY ((ARRAY['sede'::character varying, 'container'::character varying, 'garage'::character varying, 'altro'::character varying])::text[])))
);

--
-- Name: ubicazioni_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ubicazioni_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: ubicazioni_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ubicazioni_id_seq OWNED BY public.ubicazioni.id;

--
-- Name: user_courses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_courses (
    id integer NOT NULL,
    user_id integer NOT NULL,
    course_id integer NOT NULL,
    acquisition_date date NOT NULL,
    expiry_date date,
    document_url character varying(255),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

--
-- Name: user_courses_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_courses_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: user_courses_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_courses_id_seq OWNED BY public.user_courses.id;

--
-- Name: user_medical_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_medical_records (
    id integer NOT NULL,
    user_id integer NOT NULL,
    last_visit_date date NOT NULL,
    expiry_date date NOT NULL,
    status character varying(20) DEFAULT 'Idoneo'::character varying NOT NULL,
    document_url character varying(255),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    visit_type_id integer NOT NULL
);

--
-- Name: user_medical_records_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_medical_records_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: user_medical_records_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_medical_records_id_seq OWNED BY public.user_medical_records.id;

--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id integer NOT NULL,
    username character varying(50) NOT NULL,
    password character varying(255),
    role public.user_role NOT NULL,
    nome character varying(50),
    cognome character varying(50),
    email character varying(100),
    reset_token character varying(255),
    reset_token_expires timestamp with time zone,
    is_active boolean DEFAULT true,
    codice_fiscale character varying(16),
    telefono character varying(20),
    indirizzo character varying(255),
    citta character varying(100),
    cap character varying(10),
    photo_url character varying(255),
    public_token uuid DEFAULT gen_random_uuid() NOT NULL,
    sessioni_valide_dal timestamp with time zone,
    temporaneo boolean DEFAULT false NOT NULL,
    ente character varying(100),
    temporaneo_emergenza_id integer
);

--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;

--
-- Name: utenti_ruoli; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.utenti_ruoli (
    user_id integer NOT NULL,
    ruolo public.user_role NOT NULL,
    assegnato_il timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

--
-- Name: verbali_consegna; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.verbali_consegna (
    id integer NOT NULL,
    user_id integer,
    destinatario_nome character varying(150) NOT NULL,
    emesso_il timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    emesso_da character varying(100),
    stato character varying(20) DEFAULT 'da_confermare'::character varying NOT NULL,
    confermato_il timestamp with time zone,
    scansione_url character varying(255),
    note text,
    tipo character varying(10) DEFAULT 'consegna'::character varying NOT NULL,
    scansione_file character varying(255),
    scansione_caricata_il timestamp with time zone,
    scansione_caricata_da character varying(100),
    CONSTRAINT verbali_consegna_stato_check CHECK (((stato)::text = ANY ((ARRAY['da_confermare'::character varying, 'da_firmare'::character varying, 'confermato'::character varying, 'firmato_cartaceo'::character varying])::text[]))),
    CONSTRAINT verbali_consegna_tipo_check CHECK (((tipo)::text = ANY ((ARRAY['consegna'::character varying, 'rientro'::character varying])::text[])))
);

--
-- Name: verbali_consegna_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.verbali_consegna_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: verbali_consegna_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.verbali_consegna_id_seq OWNED BY public.verbali_consegna.id;

--
-- Name: accessi_temporanei id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accessi_temporanei ALTER COLUMN id SET DEFAULT nextval('public.accessi_temporanei_id_seq'::regclass);

--
-- Name: audit_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log ALTER COLUMN id SET DEFAULT nextval('public.audit_log_id_seq'::regclass);

--
-- Name: beni id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beni ALTER COLUMN id SET DEFAULT nextval('public.beni_id_seq'::regclass);

--
-- Name: beni_scadenze id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beni_scadenze ALTER COLUMN id SET DEFAULT nextval('public.beni_scadenze_id_seq'::regclass);

--
-- Name: categorie_beni id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categorie_beni ALTER COLUMN id SET DEFAULT nextval('public.categorie_beni_id_seq'::regclass);

--
-- Name: courses_catalog id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.courses_catalog ALTER COLUMN id SET DEFAULT nextval('public.courses_catalog_id_seq'::regclass);

--
-- Name: diario_sala id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.diario_sala ALTER COLUMN id SET DEFAULT nextval('public.diario_sala_id_seq'::regclass);

--
-- Name: emergencies id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emergencies ALTER COLUMN id SET DEFAULT nextval('public.emergencies_id_seq'::regclass);

--
-- Name: emergency_documents id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emergency_documents ALTER COLUMN id SET DEFAULT nextval('public.emergency_documents_id_seq'::regclass);

--
-- Name: emergency_team_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emergency_team_log ALTER COLUMN id SET DEFAULT nextval('public.emergency_team_log_id_seq'::regclass);

--
-- Name: interventi_manutenzione id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interventi_manutenzione ALTER COLUMN id SET DEFAULT nextval('public.interventi_manutenzione_id_seq'::regclass);

--
-- Name: medical_visit_types id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medical_visit_types ALTER COLUMN id SET DEFAULT nextval('public.medical_visit_types_id_seq'::regclass);

--
-- Name: modelli_dpi id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.modelli_dpi ALTER COLUMN id SET DEFAULT nextval('public.modelli_dpi_id_seq'::regclass);

--
-- Name: movimenti id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.movimenti ALTER COLUMN id SET DEFAULT nextval('public.movimenti_id_seq'::regclass);

--
-- Name: notifiche id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifiche ALTER COLUMN id SET DEFAULT nextval('public.notifiche_id_seq'::regclass);

--
-- Name: report_images image_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_images ALTER COLUMN image_id SET DEFAULT nextval('public.report_images_image_id_seq'::regclass);

--
-- Name: report_team_assignments assignment_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_team_assignments ALTER COLUMN assignment_id SET DEFAULT nextval('public.report_team_assignments_assignment_id_seq'::regclass);

--
-- Name: report_updates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_updates ALTER COLUMN id SET DEFAULT nextval('public.report_updates_id_seq'::regclass);

--
-- Name: reports id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports ALTER COLUMN id SET DEFAULT nextval('public.reports_id_seq'::regclass);

--
-- Name: squadra_membri id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.squadra_membri ALTER COLUMN id SET DEFAULT nextval('public.squadra_membri_id_seq'::regclass);

--
-- Name: squadre id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.squadre ALTER COLUMN id SET DEFAULT nextval('public.squadre_id_seq'::regclass);

--
-- Name: token_rinnovo id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.token_rinnovo ALTER COLUMN id SET DEFAULT nextval('public.token_rinnovo_id_seq'::regclass);

--
-- Name: ubicazioni id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ubicazioni ALTER COLUMN id SET DEFAULT nextval('public.ubicazioni_id_seq'::regclass);

--
-- Name: user_courses id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_courses ALTER COLUMN id SET DEFAULT nextval('public.user_courses_id_seq'::regclass);

--
-- Name: user_medical_records id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_medical_records ALTER COLUMN id SET DEFAULT nextval('public.user_medical_records_id_seq'::regclass);

--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);

--
-- Name: verbali_consegna id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.verbali_consegna ALTER COLUMN id SET DEFAULT nextval('public.verbali_consegna_id_seq'::regclass);

--
-- Data for Name: accessi_temporanei; Type: TABLE DATA; Schema: public; Owner: -
--

--
-- Data for Name: audit_log; Type: TABLE DATA; Schema: public; Owner: -
--

--
-- Data for Name: avvisi_magazzino; Type: TABLE DATA; Schema: public; Owner: -
--

--
-- Data for Name: beni; Type: TABLE DATA; Schema: public; Owner: -
--

--
-- Data for Name: beni_scadenze; Type: TABLE DATA; Schema: public; Owner: -
--

--
-- Data for Name: branding_settings; Type: TABLE DATA; Schema: public; Owner: -
--

--
-- Data for Name: categorie_beni; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.categorie_beni (id, tipo, nome, creata_il) VALUES (2, 'dpi', 'Protezione della testa', '2026-10-03 17:08:57.395407+00');
INSERT INTO public.categorie_beni (id, tipo, nome, creata_il) VALUES (3, 'dpi', 'Protezione delle mani', '2026-10-03 17:08:57.395407+00');
INSERT INTO public.categorie_beni (id, tipo, nome, creata_il) VALUES (4, 'dpi', 'Calzature', '2026-10-03 17:08:57.395407+00');
INSERT INTO public.categorie_beni (id, tipo, nome, creata_il) VALUES (5, 'dpi', 'Protezione degli occhi', '2026-10-03 17:08:57.395407+00');
INSERT INTO public.categorie_beni (id, tipo, nome, creata_il) VALUES (6, 'dpi', 'Protezione dell''udito', '2026-10-03 17:08:57.395407+00');
INSERT INTO public.categorie_beni (id, tipo, nome, creata_il) VALUES (7, 'dpi', 'Protezione delle vie respiratorie', '2026-10-03 17:08:57.395407+00');
INSERT INTO public.categorie_beni (id, tipo, nome, creata_il) VALUES (8, 'dpi', 'Abbigliamento', '2026-10-03 17:08:57.395407+00');

--
-- Data for Name: courses_catalog; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.courses_catalog (id, name, validity_months, course_code) VALUES (1, 'Corso Base Sicurezza', NULL, '01');

--
-- Data for Name: diario_sala; Type: TABLE DATA; Schema: public; Owner: -
--

--
-- Data for Name: emergencies; Type: TABLE DATA; Schema: public; Owner: -
--

--
-- Data for Name: emergency_documents; Type: TABLE DATA; Schema: public; Owner: -
--

--
-- Data for Name: emergency_team_log; Type: TABLE DATA; Schema: public; Owner: -
--

--
-- Data for Name: interventi_manutenzione; Type: TABLE DATA; Schema: public; Owner: -
--

--
-- Data for Name: medical_visit_types; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.medical_visit_types (id, name, validity_months) VALUES (1, 'Visita di Idoneità Fisica', 24);

--
-- Data for Name: modelli_dpi; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.modelli_dpi (id, nome, categoria_id, taglie, unita_misura, standard, nascosto, creato_il) VALUES (1, 'Elmetto di protezione', 2, '{Unica}', 'pezzi', true, false, '2026-10-03 17:08:57.395407+00');
INSERT INTO public.modelli_dpi (id, nome, categoria_id, taglie, unita_misura, standard, nascosto, creato_il) VALUES (2, 'Guanti da lavoro', 3, '{7,8,9,10,11}', 'paia', true, false, '2026-10-03 17:08:57.395407+00');
INSERT INTO public.modelli_dpi (id, nome, categoria_id, taglie, unita_misura, standard, nascosto, creato_il) VALUES (3, 'Scarpe antinfortunistiche', 4, '{36,37,38,39,40,41,42,43,44,45,46,47,48}', 'paia', true, false, '2026-10-03 17:08:57.395407+00');
INSERT INTO public.modelli_dpi (id, nome, categoria_id, taglie, unita_misura, standard, nascosto, creato_il) VALUES (4, 'Stivali di sicurezza', 4, '{37,38,39,40,41,42,43,44,45,46,47}', 'paia', true, false, '2026-10-03 17:08:57.395407+00');
INSERT INTO public.modelli_dpi (id, nome, categoria_id, taglie, unita_misura, standard, nascosto, creato_il) VALUES (5, 'Occhiali di protezione', 5, '{Unica}', 'pezzi', true, false, '2026-10-03 17:08:57.395407+00');
INSERT INTO public.modelli_dpi (id, nome, categoria_id, taglie, unita_misura, standard, nascosto, creato_il) VALUES (6, 'Otoprotettori', 6, '{Unica}', 'pezzi', true, false, '2026-10-03 17:08:57.395407+00');
INSERT INTO public.modelli_dpi (id, nome, categoria_id, taglie, unita_misura, standard, nascosto, creato_il) VALUES (7, 'Mascherina FFP2', 7, '{Unica}', 'pezzi', true, false, '2026-10-03 17:08:57.395407+00');
INSERT INTO public.modelli_dpi (id, nome, categoria_id, taglie, unita_misura, standard, nascosto, creato_il) VALUES (8, 'Giacca alta visibilità', 8, '{S,M,L,XL,XXL,XXXL}', 'pezzi', true, false, '2026-10-03 17:08:57.395407+00');
INSERT INTO public.modelli_dpi (id, nome, categoria_id, taglie, unita_misura, standard, nascosto, creato_il) VALUES (9, 'Gilet alta visibilità', 8, '{S,M,L,XL,XXL,XXXL}', 'pezzi', true, false, '2026-10-03 17:08:57.395407+00');
INSERT INTO public.modelli_dpi (id, nome, categoria_id, taglie, unita_misura, standard, nascosto, creato_il) VALUES (10, 'Pantaloni da intervento', 8, '{44,46,48,50,52,54,56,58,60}', 'pezzi', true, false, '2026-10-03 17:08:57.395407+00');
INSERT INTO public.modelli_dpi (id, nome, categoria_id, taglie, unita_misura, standard, nascosto, creato_il) VALUES (11, 'Polo', 8, '{S,M,L,XL,XXL,XXXL}', 'pezzi', true, false, '2026-10-03 17:08:57.395407+00');
INSERT INTO public.modelli_dpi (id, nome, categoria_id, taglie, unita_misura, standard, nascosto, creato_il) VALUES (12, 'Giubbotto antipioggia', 8, '{S,M,L,XL,XXL,XXXL}', 'pezzi', true, false, '2026-10-03 17:08:57.395407+00');

--
-- Data for Name: movimenti; Type: TABLE DATA; Schema: public; Owner: -
--

--
-- Data for Name: notifiche; Type: TABLE DATA; Schema: public; Owner: -
--

--
-- Data for Name: posizioni_squadre; Type: TABLE DATA; Schema: public; Owner: -
--

--
-- Data for Name: report_images; Type: TABLE DATA; Schema: public; Owner: -
--

--
-- Data for Name: report_team_assignments; Type: TABLE DATA; Schema: public; Owner: -
--

--
-- Data for Name: report_updates; Type: TABLE DATA; Schema: public; Owner: -
--

--
-- Data for Name: reports; Type: TABLE DATA; Schema: public; Owner: -
--

--
-- Data for Name: revoked_tokens; Type: TABLE DATA; Schema: public; Owner: -
--

--
-- Data for Name: richieste_idempotenti; Type: TABLE DATA; Schema: public; Owner: -
--

--
-- Data for Name: squadra_membri; Type: TABLE DATA; Schema: public; Owner: -
--

--
-- Data for Name: squadre; Type: TABLE DATA; Schema: public; Owner: -
--

--
-- Data for Name: token_rinnovo; Type: TABLE DATA; Schema: public; Owner: -
--

--
-- Data for Name: ubicazioni; Type: TABLE DATA; Schema: public; Owner: -
--

--
-- Data for Name: user_courses; Type: TABLE DATA; Schema: public; Owner: -
--

--
-- Data for Name: user_medical_records; Type: TABLE DATA; Schema: public; Owner: -
--

--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: -
--

--
-- Data for Name: utenti_ruoli; Type: TABLE DATA; Schema: public; Owner: -
--

--
-- Data for Name: verbali_consegna; Type: TABLE DATA; Schema: public; Owner: -
--

--
-- Name: accessi_temporanei_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.accessi_temporanei_id_seq', 1, false);

--
-- Name: audit_log_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.audit_log_id_seq', 1, false);

--
-- Name: beni_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.beni_id_seq', 1, false);

--
-- Name: beni_scadenze_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.beni_scadenze_id_seq', 1, false);

--
-- Name: categorie_beni_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.categorie_beni_id_seq', 8, true);

--
-- Name: courses_catalog_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.courses_catalog_id_seq', 1, true);

--
-- Name: diario_sala_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.diario_sala_id_seq', 1, false);

--
-- Name: emergencies_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.emergencies_id_seq', 1, false);

--
-- Name: emergency_documents_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.emergency_documents_id_seq', 1, false);

--
-- Name: emergency_team_log_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.emergency_team_log_id_seq', 1, false);

--
-- Name: interventi_manutenzione_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.interventi_manutenzione_id_seq', 1, false);

--
-- Name: medical_visit_types_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.medical_visit_types_id_seq', 1, true);

--
-- Name: modelli_dpi_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.modelli_dpi_id_seq', 12, true);

--
-- Name: movimenti_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.movimenti_id_seq', 1, false);

--
-- Name: notifiche_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.notifiche_id_seq', 1, false);

--
-- Name: report_images_image_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.report_images_image_id_seq', 1, false);

--
-- Name: report_team_assignments_assignment_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.report_team_assignments_assignment_id_seq', 1, false);

--
-- Name: report_updates_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.report_updates_id_seq', 1, false);

--
-- Name: reports_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.reports_id_seq', 1, false);

--
-- Name: squadra_membri_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.squadra_membri_id_seq', 1, false);

--
-- Name: squadre_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.squadre_id_seq', 1, false);

--
-- Name: token_rinnovo_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.token_rinnovo_id_seq', 1, false);

--
-- Name: ubicazioni_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.ubicazioni_id_seq', 1, false);

--
-- Name: user_courses_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.user_courses_id_seq', 1, false);

--
-- Name: user_medical_records_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.user_medical_records_id_seq', 1, false);

--
-- Name: users_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.users_id_seq', 1, false);

--
-- Name: verbali_consegna_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.verbali_consegna_id_seq', 1, false);

--
-- Name: accessi_temporanei accessi_temporanei_impronta_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accessi_temporanei
    ADD CONSTRAINT accessi_temporanei_impronta_key UNIQUE (impronta);

--
-- Name: accessi_temporanei accessi_temporanei_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accessi_temporanei
    ADD CONSTRAINT accessi_temporanei_pkey PRIMARY KEY (id);

--
-- Name: accessi_temporanei accessi_temporanei_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accessi_temporanei
    ADD CONSTRAINT accessi_temporanei_user_id_key UNIQUE (user_id);

--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);

--
-- Name: avvisi_magazzino avvisi_magazzino_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.avvisi_magazzino
    ADD CONSTRAINT avvisi_magazzino_pkey PRIMARY KEY (user_id);

--
-- Name: beni beni_codice_etichetta_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beni
    ADD CONSTRAINT beni_codice_etichetta_key UNIQUE (codice_etichetta);

--
-- Name: beni beni_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beni
    ADD CONSTRAINT beni_pkey PRIMARY KEY (id);

--
-- Name: beni_scadenze beni_scadenze_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beni_scadenze
    ADD CONSTRAINT beni_scadenze_pkey PRIMARY KEY (id);

--
-- Name: beni_scadenze beni_scadenze_uniche; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beni_scadenze
    ADD CONSTRAINT beni_scadenze_uniche UNIQUE (bene_id, tipo);

--
-- Name: branding_settings branding_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branding_settings
    ADD CONSTRAINT branding_settings_pkey PRIMARY KEY (setting_key);

--
-- Name: categorie_beni categorie_beni_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categorie_beni
    ADD CONSTRAINT categorie_beni_pkey PRIMARY KEY (id);

--
-- Name: courses_catalog courses_catalog_course_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.courses_catalog
    ADD CONSTRAINT courses_catalog_course_code_key UNIQUE (course_code);

--
-- Name: courses_catalog courses_catalog_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.courses_catalog
    ADD CONSTRAINT courses_catalog_pkey PRIMARY KEY (id);

--
-- Name: diario_sala diario_sala_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.diario_sala
    ADD CONSTRAINT diario_sala_pkey PRIMARY KEY (id);

--
-- Name: emergencies emergencies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emergencies
    ADD CONSTRAINT emergencies_pkey PRIMARY KEY (id);

--
-- Name: emergency_documents emergency_documents_file_path_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emergency_documents
    ADD CONSTRAINT emergency_documents_file_path_key UNIQUE (file_path);

--
-- Name: emergency_documents emergency_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emergency_documents
    ADD CONSTRAINT emergency_documents_pkey PRIMARY KEY (id);

--
-- Name: emergency_team_log emergency_team_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emergency_team_log
    ADD CONSTRAINT emergency_team_log_pkey PRIMARY KEY (id);

--
-- Name: interventi_manutenzione interventi_manutenzione_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interventi_manutenzione
    ADD CONSTRAINT interventi_manutenzione_pkey PRIMARY KEY (id);

--
-- Name: medical_visit_types medical_visit_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medical_visit_types
    ADD CONSTRAINT medical_visit_types_pkey PRIMARY KEY (id);

--
-- Name: modelli_dpi modelli_dpi_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.modelli_dpi
    ADD CONSTRAINT modelli_dpi_pkey PRIMARY KEY (id);

--
-- Name: movimenti movimenti_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.movimenti
    ADD CONSTRAINT movimenti_pkey PRIMARY KEY (id);

--
-- Name: notifiche notifiche_chiave_unica; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifiche
    ADD CONSTRAINT notifiche_chiave_unica UNIQUE (user_id, chiave);

--
-- Name: notifiche notifiche_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifiche
    ADD CONSTRAINT notifiche_pkey PRIMARY KEY (id);

--
-- Name: posizioni_squadre posizioni_squadre_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.posizioni_squadre
    ADD CONSTRAINT posizioni_squadre_pkey PRIMARY KEY (squadra_id);

--
-- Name: report_images report_images_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_images
    ADD CONSTRAINT report_images_pkey PRIMARY KEY (image_id);

--
-- Name: report_team_assignments report_team_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_team_assignments
    ADD CONSTRAINT report_team_assignments_pkey PRIMARY KEY (assignment_id);

--
-- Name: report_team_assignments report_team_assignments_uniq_report_id_squadra_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_team_assignments
    ADD CONSTRAINT report_team_assignments_uniq_report_id_squadra_id UNIQUE (report_id, squadra_id);

--
-- Name: report_updates report_updates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_updates
    ADD CONSTRAINT report_updates_pkey PRIMARY KEY (id);

--
-- Name: reports reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_pkey PRIMARY KEY (id);

--
-- Name: revoked_tokens revoked_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.revoked_tokens
    ADD CONSTRAINT revoked_tokens_pkey PRIMARY KEY (token);

--
-- Name: richieste_idempotenti richieste_idempotenti_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.richieste_idempotenti
    ADD CONSTRAINT richieste_idempotenti_pkey PRIMARY KEY (user_id, chiave);

--
-- Name: squadra_membri squadra_membri_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.squadra_membri
    ADD CONSTRAINT squadra_membri_pkey PRIMARY KEY (id);

--
-- Name: squadre squadre_nome_radio_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.squadre
    ADD CONSTRAINT squadre_nome_radio_key UNIQUE (nome_radio);

--
-- Name: squadre squadre_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.squadre
    ADD CONSTRAINT squadre_pkey PRIMARY KEY (id);

--
-- Name: token_rinnovo token_rinnovo_impronta_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.token_rinnovo
    ADD CONSTRAINT token_rinnovo_impronta_key UNIQUE (impronta);

--
-- Name: token_rinnovo token_rinnovo_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.token_rinnovo
    ADD CONSTRAINT token_rinnovo_pkey PRIMARY KEY (id);

--
-- Name: ubicazioni ubicazioni_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ubicazioni
    ADD CONSTRAINT ubicazioni_pkey PRIMARY KEY (id);

--
-- Name: user_courses user_courses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_courses
    ADD CONSTRAINT user_courses_pkey PRIMARY KEY (id);

--
-- Name: user_medical_records user_medical_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_medical_records
    ADD CONSTRAINT user_medical_records_pkey PRIMARY KEY (id);

--
-- Name: users users_codice_fiscale_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_codice_fiscale_key UNIQUE (codice_fiscale);

--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);

--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);

--
-- Name: users users_public_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_public_token_key UNIQUE (public_token);

--
-- Name: users users_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key UNIQUE (username);

--
-- Name: utenti_ruoli utenti_ruoli_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.utenti_ruoli
    ADD CONSTRAINT utenti_ruoli_pkey PRIMARY KEY (user_id, ruolo);

--
-- Name: verbali_consegna verbali_consegna_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.verbali_consegna
    ADD CONSTRAINT verbali_consegna_pkey PRIMARY KEY (id);

--
-- Name: audit_log_action_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_log_action_index ON public.audit_log USING btree (action);

--
-- Name: audit_log_occurred_at_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_log_occurred_at_index ON public.audit_log USING btree (occurred_at);

--
-- Name: audit_log_user_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_log_user_id_index ON public.audit_log USING btree (user_id);

--
-- Name: beni_categoria_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX beni_categoria_id_index ON public.beni USING btree (categoria_id);

--
-- Name: beni_dismesso_il_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX beni_dismesso_il_index ON public.beni USING btree (dismesso_il);

--
-- Name: beni_modello_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX beni_modello_id_index ON public.beni USING btree (modello_id);

--
-- Name: beni_scadenze_scadenza_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX beni_scadenze_scadenza_index ON public.beni_scadenze USING btree (scadenza);

--
-- Name: beni_tipo_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX beni_tipo_index ON public.beni USING btree (tipo);

--
-- Name: categorie_beni_nome_unico; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX categorie_beni_nome_unico ON public.categorie_beni USING btree (tipo, lower(btrim((nome)::text)));

--
-- Name: courses_catalog_nome_unico; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX courses_catalog_nome_unico ON public.courses_catalog USING btree (lower(btrim((name)::text)));

--
-- Name: diario_sala_emergency_id_creata_il_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX diario_sala_emergency_id_creata_il_index ON public.diario_sala USING btree (emergency_id, creata_il);

--
-- Name: emergency_documents_emergency_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX emergency_documents_emergency_id_index ON public.emergency_documents USING btree (emergency_id);

--
-- Name: emergency_team_log_emergency_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX emergency_team_log_emergency_id_index ON public.emergency_team_log USING btree (emergency_id);

--
-- Name: emergency_team_log_emergency_id_nome_radio_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX emergency_team_log_emergency_id_nome_radio_index ON public.emergency_team_log USING btree (emergency_id, nome_radio);

--
-- Name: interventi_manutenzione_bene_id_eseguito_il_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX interventi_manutenzione_bene_id_eseguito_il_index ON public.interventi_manutenzione USING btree (bene_id, eseguito_il);

--
-- Name: medical_visit_types_nome_unico; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX medical_visit_types_nome_unico ON public.medical_visit_types USING btree (lower(btrim((name)::text)));

--
-- Name: modelli_dpi_nome_unico; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX modelli_dpi_nome_unico ON public.modelli_dpi USING btree (lower(btrim((nome)::text)));

--
-- Name: movimenti_bene_id_quando_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX movimenti_bene_id_quando_index ON public.movimenti USING btree (bene_id, quando);

--
-- Name: movimenti_destinatario_squadra_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX movimenti_destinatario_squadra_id_index ON public.movimenti USING btree (destinatario_squadra_id);

--
-- Name: movimenti_destinatario_user_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX movimenti_destinatario_user_id_index ON public.movimenti USING btree (destinatario_user_id);

--
-- Name: movimenti_emergency_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX movimenti_emergency_id_index ON public.movimenti USING btree (emergency_id);

--
-- Name: movimenti_proveniva_squadra_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX movimenti_proveniva_squadra_id_index ON public.movimenti USING btree (proveniva_squadra_id);

--
-- Name: movimenti_proveniva_user_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX movimenti_proveniva_user_id_index ON public.movimenti USING btree (proveniva_user_id);

--
-- Name: movimenti_verbale_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX movimenti_verbale_id_index ON public.movimenti USING btree (verbale_id);

--
-- Name: notifiche_scade_il_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifiche_scade_il_index ON public.notifiche USING btree (scade_il);

--
-- Name: notifiche_user_id_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifiche_user_id_id_index ON public.notifiche USING btree (user_id, id);

--
-- Name: report_images_report_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX report_images_report_id_index ON public.report_images USING btree (report_id);

--
-- Name: report_team_assignments_report_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX report_team_assignments_report_id_index ON public.report_team_assignments USING btree (report_id);

--
-- Name: report_team_assignments_squadra_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX report_team_assignments_squadra_id_index ON public.report_team_assignments USING btree (squadra_id);

--
-- Name: report_updates_report_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX report_updates_report_id_index ON public.report_updates USING btree (report_id);

--
-- Name: reports_creator_user_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reports_creator_user_id_index ON public.reports USING btree (creator_user_id);

--
-- Name: reports_emergency_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reports_emergency_id_index ON public.reports USING btree (emergency_id);

--
-- Name: reports_priority_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reports_priority_index ON public.reports USING btree (priority);

--
-- Name: reports_status_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reports_status_index ON public.reports USING btree (status);

--
-- Name: reports_updated_at_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reports_updated_at_index ON public.reports USING btree (updated_at);

--
-- Name: richieste_idempotenti_creata_il_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX richieste_idempotenti_creata_il_index ON public.richieste_idempotenti USING btree (creata_il);

--
-- Name: token_rinnovo_user_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX token_rinnovo_user_id_index ON public.token_rinnovo USING btree (user_id);

--
-- Name: ubicazioni_nome_unico; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ubicazioni_nome_unico ON public.ubicazioni USING btree (lower(btrim((nome)::text)));

--
-- Name: user_courses_expiry_date_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_courses_expiry_date_index ON public.user_courses USING btree (expiry_date);

--
-- Name: user_courses_user_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_courses_user_id_index ON public.user_courses USING btree (user_id);

--
-- Name: user_medical_records_expiry_date_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_medical_records_expiry_date_index ON public.user_medical_records USING btree (expiry_date);

--
-- Name: user_medical_records_user_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_medical_records_user_id_index ON public.user_medical_records USING btree (user_id);

--
-- Name: utenti_ruoli_ruolo_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX utenti_ruoli_ruolo_index ON public.utenti_ruoli USING btree (ruolo);

--
-- Name: verbali_consegna_user_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX verbali_consegna_user_id_index ON public.verbali_consegna USING btree (user_id);

--
-- Name: beni beni_etichetta_iniziale; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER beni_etichetta_iniziale BEFORE INSERT ON public.beni FOR EACH ROW EXECUTE FUNCTION public.etichetta_iniziale_bene();

--
-- Name: users users_ruolo_iniziale; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER users_ruolo_iniziale AFTER INSERT ON public.users FOR EACH ROW EXECUTE FUNCTION public.ruolo_iniziale_utente();

--
-- Name: utenti_ruoli utenti_ruoli_esterno_esclusivo; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER utenti_ruoli_esterno_esclusivo BEFORE INSERT OR UPDATE ON public.utenti_ruoli FOR EACH ROW EXECUTE FUNCTION public.controlla_ruolo_esterno();

--
-- Name: accessi_temporanei accessi_temporanei_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accessi_temporanei
    ADD CONSTRAINT accessi_temporanei_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: audit_log audit_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;

--
-- Name: avvisi_magazzino avvisi_magazzino_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.avvisi_magazzino
    ADD CONSTRAINT avvisi_magazzino_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: beni beni_categoria_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beni
    ADD CONSTRAINT beni_categoria_id_fkey FOREIGN KEY (categoria_id) REFERENCES public.categorie_beni(id) ON DELETE SET NULL;

--
-- Name: beni beni_modello_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beni
    ADD CONSTRAINT beni_modello_id_fkey FOREIGN KEY (modello_id) REFERENCES public.modelli_dpi(id) ON DELETE SET NULL;

--
-- Name: beni_scadenze beni_scadenze_bene_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beni_scadenze
    ADD CONSTRAINT beni_scadenze_bene_id_fkey FOREIGN KEY (bene_id) REFERENCES public.beni(id) ON DELETE CASCADE;

--
-- Name: beni beni_ubicazione_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beni
    ADD CONSTRAINT beni_ubicazione_id_fkey FOREIGN KEY (ubicazione_id) REFERENCES public.ubicazioni(id) ON DELETE SET NULL;

--
-- Name: diario_sala diario_sala_autore_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.diario_sala
    ADD CONSTRAINT diario_sala_autore_id_fkey FOREIGN KEY (autore_id) REFERENCES public.users(id) ON DELETE SET NULL;

--
-- Name: diario_sala diario_sala_emergency_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.diario_sala
    ADD CONSTRAINT diario_sala_emergency_id_fkey FOREIGN KEY (emergency_id) REFERENCES public.emergencies(id) ON DELETE CASCADE;

--
-- Name: emergency_documents emergency_documents_emergency_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emergency_documents
    ADD CONSTRAINT emergency_documents_emergency_id_fkey FOREIGN KEY (emergency_id) REFERENCES public.emergencies(id) ON DELETE CASCADE;

--
-- Name: emergency_documents emergency_documents_uploader_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emergency_documents
    ADD CONSTRAINT emergency_documents_uploader_user_id_fkey FOREIGN KEY (uploader_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;

--
-- Name: emergency_team_log emergency_team_log_emergency_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emergency_team_log
    ADD CONSTRAINT emergency_team_log_emergency_id_fkey FOREIGN KEY (emergency_id) REFERENCES public.emergencies(id) ON DELETE CASCADE;

--
-- Name: emergency_team_log emergency_team_log_squadra_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emergency_team_log
    ADD CONSTRAINT emergency_team_log_squadra_id_fkey FOREIGN KEY (squadra_id) REFERENCES public.squadre(id) ON DELETE SET NULL;

--
-- Name: interventi_manutenzione interventi_manutenzione_bene_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interventi_manutenzione
    ADD CONSTRAINT interventi_manutenzione_bene_id_fkey FOREIGN KEY (bene_id) REFERENCES public.beni(id) ON DELETE CASCADE;

--
-- Name: modelli_dpi modelli_dpi_categoria_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.modelli_dpi
    ADD CONSTRAINT modelli_dpi_categoria_id_fkey FOREIGN KEY (categoria_id) REFERENCES public.categorie_beni(id) ON DELETE SET NULL;

--
-- Name: movimenti movimenti_bene_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.movimenti
    ADD CONSTRAINT movimenti_bene_id_fkey FOREIGN KEY (bene_id) REFERENCES public.beni(id) ON DELETE RESTRICT;

--
-- Name: movimenti movimenti_destinatario_bene_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.movimenti
    ADD CONSTRAINT movimenti_destinatario_bene_id_fkey FOREIGN KEY (destinatario_bene_id) REFERENCES public.beni(id) ON DELETE SET NULL;

--
-- Name: movimenti movimenti_destinatario_squadra_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.movimenti
    ADD CONSTRAINT movimenti_destinatario_squadra_id_fkey FOREIGN KEY (destinatario_squadra_id) REFERENCES public.squadre(id) ON DELETE SET NULL;

--
-- Name: movimenti movimenti_destinatario_ubicazione_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.movimenti
    ADD CONSTRAINT movimenti_destinatario_ubicazione_id_fkey FOREIGN KEY (destinatario_ubicazione_id) REFERENCES public.ubicazioni(id) ON DELETE SET NULL;

--
-- Name: movimenti movimenti_destinatario_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.movimenti
    ADD CONSTRAINT movimenti_destinatario_user_id_fkey FOREIGN KEY (destinatario_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

--
-- Name: movimenti movimenti_emergency_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.movimenti
    ADD CONSTRAINT movimenti_emergency_id_fkey FOREIGN KEY (emergency_id) REFERENCES public.emergencies(id) ON DELETE SET NULL;

--
-- Name: movimenti movimenti_eseguito_da_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.movimenti
    ADD CONSTRAINT movimenti_eseguito_da_id_fkey FOREIGN KEY (eseguito_da_id) REFERENCES public.users(id) ON DELETE SET NULL;

--
-- Name: movimenti movimenti_proveniva_bene_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.movimenti
    ADD CONSTRAINT movimenti_proveniva_bene_id_fkey FOREIGN KEY (proveniva_bene_id) REFERENCES public.beni(id) ON DELETE SET NULL;

--
-- Name: movimenti movimenti_proveniva_squadra_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.movimenti
    ADD CONSTRAINT movimenti_proveniva_squadra_id_fkey FOREIGN KEY (proveniva_squadra_id) REFERENCES public.squadre(id) ON DELETE SET NULL;

--
-- Name: movimenti movimenti_proveniva_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.movimenti
    ADD CONSTRAINT movimenti_proveniva_user_id_fkey FOREIGN KEY (proveniva_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

--
-- Name: movimenti movimenti_verbale_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.movimenti
    ADD CONSTRAINT movimenti_verbale_id_fkey FOREIGN KEY (verbale_id) REFERENCES public.verbali_consegna(id) ON DELETE SET NULL;

--
-- Name: notifiche notifiche_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifiche
    ADD CONSTRAINT notifiche_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: posizioni_squadre posizioni_squadre_squadra_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.posizioni_squadre
    ADD CONSTRAINT posizioni_squadre_squadra_id_fkey FOREIGN KEY (squadra_id) REFERENCES public.squadre(id) ON DELETE CASCADE;

--
-- Name: report_images report_images_report_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_images
    ADD CONSTRAINT report_images_report_id_fkey FOREIGN KEY (report_id) REFERENCES public.reports(id) ON DELETE CASCADE;

--
-- Name: report_team_assignments report_team_assignments_report_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_team_assignments
    ADD CONSTRAINT report_team_assignments_report_id_fkey FOREIGN KEY (report_id) REFERENCES public.reports(id) ON DELETE CASCADE;

--
-- Name: report_team_assignments report_team_assignments_squadra_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_team_assignments
    ADD CONSTRAINT report_team_assignments_squadra_id_fkey FOREIGN KEY (squadra_id) REFERENCES public.squadre(id) ON DELETE CASCADE;

--
-- Name: report_updates report_updates_report_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_updates
    ADD CONSTRAINT report_updates_report_id_fkey FOREIGN KEY (report_id) REFERENCES public.reports(id) ON DELETE CASCADE;

--
-- Name: report_updates report_updates_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_updates
    ADD CONSTRAINT report_updates_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE RESTRICT;

--
-- Name: reports reports_creator_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_creator_user_id_fkey FOREIGN KEY (creator_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;

--
-- Name: reports reports_emergency_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_emergency_id_fkey FOREIGN KEY (emergency_id) REFERENCES public.emergencies(id) ON DELETE CASCADE;

--
-- Name: richieste_idempotenti richieste_idempotenti_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.richieste_idempotenti
    ADD CONSTRAINT richieste_idempotenti_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: squadra_membri squadra_membri_squadra_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.squadra_membri
    ADD CONSTRAINT squadra_membri_squadra_id_fkey FOREIGN KEY (squadra_id) REFERENCES public.squadre(id) ON DELETE CASCADE;

--
-- Name: token_rinnovo token_rinnovo_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.token_rinnovo
    ADD CONSTRAINT token_rinnovo_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: user_courses user_courses_course_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_courses
    ADD CONSTRAINT user_courses_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.courses_catalog(id) ON DELETE RESTRICT;

--
-- Name: user_courses user_courses_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_courses
    ADD CONSTRAINT user_courses_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: user_medical_records user_medical_records_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_medical_records
    ADD CONSTRAINT user_medical_records_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: user_medical_records user_medical_records_visit_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_medical_records
    ADD CONSTRAINT user_medical_records_visit_type_id_fkey FOREIGN KEY (visit_type_id) REFERENCES public.medical_visit_types(id) ON DELETE RESTRICT;

--
-- Name: users users_temporaneo_emergenza_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_temporaneo_emergenza_id_fkey FOREIGN KEY (temporaneo_emergenza_id) REFERENCES public.emergencies(id) ON DELETE SET NULL;

--
-- Name: utenti_ruoli utenti_ruoli_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.utenti_ruoli
    ADD CONSTRAINT utenti_ruoli_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: verbali_consegna verbali_consegna_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.verbali_consegna
    ADD CONSTRAINT verbali_consegna_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;

--
-- PostgreSQL database dump complete
--
