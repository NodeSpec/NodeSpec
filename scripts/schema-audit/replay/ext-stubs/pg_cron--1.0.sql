CREATE SCHEMA IF NOT EXISTS cron;
CREATE TABLE IF NOT EXISTS cron.job (jobid bigserial PRIMARY KEY, schedule text, command text, jobname text, active boolean DEFAULT true);
CREATE FUNCTION cron.schedule(job_name text, schedule text, command text) RETURNS bigint LANGUAGE sql AS $$
  INSERT INTO cron.job (schedule, command, jobname) VALUES (schedule, command, job_name) RETURNING jobid $$;
CREATE FUNCTION cron.schedule(schedule text, command text) RETURNS bigint LANGUAGE sql AS $$
  INSERT INTO cron.job (schedule, command) VALUES (schedule, command) RETURNING jobid $$;
CREATE FUNCTION cron.unschedule(job_id bigint) RETURNS boolean LANGUAGE sql AS $$
  DELETE FROM cron.job WHERE jobid = job_id RETURNING true $$;
CREATE FUNCTION cron.unschedule(job_name text) RETURNS boolean LANGUAGE sql AS $$
  DELETE FROM cron.job WHERE jobname = job_name RETURNING true $$;
