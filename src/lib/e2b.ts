import { Sandbox, SandboxOpts } from 'e2b';
import { env } from '../config/env';

/**
 * Creates a sandbox configured to pause (not kill) on its own idle timeout,
 * with auto-resume enabled. Without this, an idle sandbox is destroyed by E2B
 * and everything in it — opencode's chat/session history, the cloned repo,
 * any in-memory state — is lost permanently. Pausing preserves all of that;
 * Sandbox.connect() transparently resumes it on the next use.
 */
export function createE2bSandbox(opts?: SandboxOpts) {
  return Sandbox.create(env.E2B_TEMPLATE_ID, {
    apiKey: env.E2B_API_KEY,
    lifecycle: { onTimeout: { action: 'pause' }, autoResume: true },
    ...opts,
  });
}
