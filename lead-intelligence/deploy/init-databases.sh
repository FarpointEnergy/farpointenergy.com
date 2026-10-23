#!/bin/sh
set -eu
# psql reads secret values directly from the environment, never command arguments.
psql --username "$POSTGRES_USER" --dbname postgres --set ON_ERROR_STOP=1 <<'SQL'
\getenv leads_password LEADS_DB_PASSWORD
\getenv umami_password UMAMI_DB_PASSWORD
\getenv maintenance_password UMAMI_MAINTENANCE_DB_PASSWORD
SELECT format('CREATE ROLE farpoint_leads LOGIN PASSWORD %L', :'leads_password') \gexec
SELECT format('CREATE ROLE umami LOGIN PASSWORD %L', :'umami_password') \gexec
SELECT format('CREATE ROLE umami_maintenance LOGIN PASSWORD %L', :'maintenance_password') \gexec
CREATE DATABASE farpoint_leads OWNER farpoint_leads;
CREATE DATABASE umami OWNER umami;
REVOKE ALL ON DATABASE farpoint_leads FROM PUBLIC;
REVOKE ALL ON DATABASE umami FROM PUBLIC;
GRANT CONNECT,TEMPORARY ON DATABASE farpoint_leads TO farpoint_leads;
GRANT CONNECT,TEMPORARY ON DATABASE umami TO umami,umami_maintenance;
\connect umami
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO umami_maintenance;
ALTER DEFAULT PRIVILEGES FOR ROLE umami IN SCHEMA public GRANT SELECT ON TABLES TO umami_maintenance;
ALTER DEFAULT PRIVILEGES FOR ROLE umami IN SCHEMA public GRANT SELECT ON SEQUENCES TO umami_maintenance;
SQL
