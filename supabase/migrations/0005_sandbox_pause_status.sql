-- Adds a 'paused' status: a paused E2B sandbox preserves its full filesystem
-- (and, by default, memory) state and can be resumed later via
-- Sandbox.connect(), unlike 'terminated' which is permanent. This lets a
-- sandbox's opencode session history, injected env vars for the running
-- process, and any uncommitted repo changes survive a user closing the app.
alter table public.sandboxes drop constraint if exists sandboxes_status_check;
alter table public.sandboxes add constraint sandboxes_status_check
  check (status in ('creating', 'ready', 'paused', 'failed', 'terminated'));
