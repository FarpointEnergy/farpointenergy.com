-- Run as database owner AFTER the pinned Umami migrations. Read access is used
-- for encrypted pg_dump; destructive access is limited to analytics records.
GRANT USAGE ON SCHEMA public TO umami_maintenance;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO umami_maintenance;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO umami_maintenance;
REVOKE DELETE ON ALL TABLES IN SCHEMA public FROM umami_maintenance;
GRANT DELETE ON public.session, public.session_link, public.website_event,
  public.event_data, public.session_data, public.revenue, public.session_replay,
  public.session_replay_saved, public.heatmap_event TO umami_maintenance;
GRANT TEMPORARY ON DATABASE umami TO umami_maintenance;
