import { vercelOidc } from "eve/channels/auth";
import { eveChannel } from "eve/channels/eve";
import { localDevUser } from "../lib/local-dev-user.js";

/**
 * Default HTTP channel: serves the dev TUI, the evals, and Vercel-authenticated callers.
 *
 * @remarks
 * {@link localDevUser} admits a trusted local caller on a development server as a user
 * principal, so the user-scoped Notion connection works in the dev TUI; it returns `null`
 * everywhere else, which leaves `vercelOidc()` as the only way in on a deployment.
 */
export default eveChannel({ auth: [localDevUser, vercelOidc()] });
