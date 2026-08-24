import { handler } from '../../../../handler.js';

// Installation actions have the same nested URL shape as candidate actions,
// so expose them explicitly rather than relying on the shallow catch-all.
export default handler;
