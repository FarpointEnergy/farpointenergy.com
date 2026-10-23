CREATE TABLE IF NOT EXISTS schema_migrations(version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE system_state(key text PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
INSERT INTO system_state(key,value) VALUES ('privacy_maintenance','{"active":false}');
CREATE TABLE privacy_tombstones(
  kind text NOT NULL CHECK(kind IN ('browser','gmail','inquiry')),
  key_hash char(64) NOT NULL CHECK(key_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(kind,key_hash)
);
CREATE INDEX privacy_tombstones_expiry ON privacy_tombstones(expires_at);
CREATE TABLE network_cache(
  key_hash char(64) PRIMARY KEY CHECK(key_hash ~ '^[a-f0-9]{64}$'), evidence jsonb NOT NULL CHECK(octet_length(evidence::text)<=4096),
  created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL
);
CREATE TABLE events(
  event_id uuid PRIMARY KEY, payload_hash char(64) NOT NULL CHECK(payload_hash ~ '^[a-f0-9]{64}$'), received_at timestamptz NOT NULL DEFAULT now(),
  event_name text NOT NULL CHECK(event_name IN ('page_view','product_path_view','rfq_start','rfq_submit_success','email_click')),
  page varchar(64) NOT NULL CHECK(page IN ('/index.html','/products.html','/applications.html','/manufacturing.html','/quality.html','/delivery.html','/quote.html','/about.html','/privacy.html','/thanks.html','/404.html')),
  browser_id uuid NOT NULL, session_id uuid NOT NULL,
  product text NOT NULL CHECK(product IN ('power','distribution','unsure')),
  application text NOT NULL CHECK(application IN ('data-center','solar','storage','hybrid','utility','industrial','other','unsure')),
  campaign_code varchar(40) NOT NULL DEFAULT '', source varchar(16) NOT NULL DEFAULT '' CHECK(source IN ('','email','search','social','referral','direct')),
  medium varchar(16) NOT NULL DEFAULT '' CHECK(medium IN ('','email','organic','social','referral','none')),
  referrer_host varchar(32) NOT NULL DEFAULT '', language varchar(5) NOT NULL,
  screen_class text NOT NULL CHECK(screen_class IN ('mobile','tablet','desktop')), client_timestamp bigint NOT NULL,
  inquiry_id uuid, network_key char(64), network_evidence jsonb NOT NULL DEFAULT '{}',
  is_qa boolean NOT NULL DEFAULT false, is_bot boolean NOT NULL DEFAULT false,
  payload jsonb NOT NULL CHECK(octet_length(payload::text)<=4096),
  CHECK(inquiry_id IS NULL OR event_name='rfq_submit_success')
);
CREATE INDEX events_received ON events(received_at);
CREATE INDEX events_browser_received ON events(browser_id,received_at);
CREATE INDEX events_session ON events(session_id);
CREATE INDEX events_inquiry ON events(inquiry_id);
CREATE INDEX events_campaign_received ON events(campaign_code,received_at);
CREATE TABLE analytics_outbox(
  event_id uuid PRIMARY KEY REFERENCES events(event_id) ON DELETE CASCADE,
  browser_id uuid NOT NULL, inquiry_id uuid, payload jsonb NOT NULL CHECK(octet_length(payload::text)<=4096),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','leased','forwarded','suppressed','dead_letter')),
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0 AND attempts<=10), next_attempt timestamptz NOT NULL DEFAULT now(),
  lease_token uuid, lease_until timestamptz, last_error varchar(64), created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX analytics_outbox_due ON analytics_outbox(status,next_attempt);
CREATE TABLE quotas(
  scope varchar(160) NOT NULL,bucket timestamptz NOT NULL, used integer NOT NULL CHECK(used>=0),expires_at timestamptz NOT NULL,
  PRIMARY KEY(scope,bucket)
);
CREATE INDEX quotas_expiry ON quotas(expires_at);
CREATE TABLE rfq_receipts(
  gmail_message_id varchar(128) PRIMARY KEY,received_at timestamptz NOT NULL,imported_at timestamptz NOT NULL DEFAULT now(),
  inquiry_id uuid,fields jsonb NOT NULL CHECK(octet_length(fields::text)<=262144),
  status text NOT NULL CHECK(status IN ('received','quarantined')),reason varchar(160),is_qa boolean NOT NULL DEFAULT false,
  attribution_status text NOT NULL DEFAULT 'unlinked' CHECK(attribution_status IN ('linked','unlinked','conflict'))
);
CREATE INDEX rfq_receipts_received ON rfq_receipts(received_at);
CREATE INDEX rfq_receipts_inquiry ON rfq_receipts(inquiry_id);
CREATE TABLE report_deliveries(
  delivery_key varchar(160) PRIMARY KEY,period text NOT NULL CHECK(period IN ('daily','weekly')),
  period_start timestamptz NOT NULL,period_end timestamptz NOT NULL CHECK(period_end>period_start),recipient varchar(128) NOT NULL CHECK(recipient='karan@farpointenergy.com'),
  message_id varchar(255) NOT NULL UNIQUE,subject varchar(255) NOT NULL,digest_hash char(64) NOT NULL,
  state text NOT NULL CHECK(state IN ('prepared','sending','provider_accepted','inbox_verified','uncertain','failed')),
  provider_id varchar(128),prepared_at timestamptz NOT NULL DEFAULT now(),sending_at timestamptz,updated_at timestamptz NOT NULL DEFAULT now(),
  attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count>=0),reconcile_count integer NOT NULL DEFAULT 0 CHECK(reconcile_count>=0),last_error varchar(160)
);
CREATE TABLE health_checks(
  name varchar(64) PRIMARY KEY,last_success timestamptz,last_attempt timestamptz NOT NULL DEFAULT now(),status varchar(32) NOT NULL,detail jsonb NOT NULL DEFAULT '{}'
);
CREATE TABLE health_history(
  id bigserial PRIMARY KEY,name varchar(64) NOT NULL,status varchar(32) NOT NULL,detail jsonb NOT NULL DEFAULT '{}',observed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX health_history_time ON health_history(observed_at);
CREATE INDEX health_history_name_time ON health_history(name,observed_at);
CREATE TABLE daily_aggregates(
  local_day date NOT NULL,metric varchar(40) NOT NULL,dimension_key varchar(40) NOT NULL,value bigint NOT NULL CHECK(value>=0),
  computed_at timestamptz NOT NULL DEFAULT now(),source_complete boolean NOT NULL,incomplete_reason text,
  PRIMARY KEY(local_day,metric,dimension_key)
);
