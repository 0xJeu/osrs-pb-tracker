import { handler } from '../../../../handler.js';

// Vercel does not forward this two-segment action path through the existing
// api/admin/recovery/[...route] function. Keep an explicit filesystem route so
// the complete URL reaches the authenticated Hono application.
export default handler;
