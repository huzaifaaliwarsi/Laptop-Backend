# Persistent WhatsApp sessions

Run this backend as a continuously running Node service using `npm start`
(`src/server.js`). The frontend can stay on Vercel. Set its
`NEXT_PUBLIC_API_URL` to `https://<persistent-backend>/api`, set backend
`CORS_ORIGIN` to the frontend origin, and rebuild the frontend.

The Vercel function entry (`api/index.js`) cannot own a continuously running
WhatsApp socket or run startup recovery. Connecting from that environment now
returns an explanatory status instead of creating another temporary session.

Use one backend instance for the API and WhatsApp integration. PostgreSQL
advisory locks prevent two instances from opening the same branch's session,
but this does not implement cross-instance message dispatch or shared status.
Use direct PostgreSQL connections or session pooling; transaction pooling is
not compatible with session advisory locks. Each active branch holds one
dedicated database connection. Keep deployment database configuration stable.

Credentials and ALL Signal keys are stored in the branch database in
`whatsapp_auth_state`. The database user needs CREATE TABLE and read/write
permissions. Existing local auth files are imported atomically on first use.
Do not delete the old auth folder before that first startup. If the previous
production container already lost its files, scan once after deploying.

Back up and restrict access to this table as authentication secrets. Never
include its contents in logs or support exports. A logout tombstone prevents
old local files from silently reimporting a revoked session.

Temporary disconnects retry with bounded backoff and preserve authentication.
Shutdown flushes queued saves and closes sockets without logging out. A
WhatsApp-revoked session (401), phone-side unlink, or account restriction still
requires user action; no application can promise to override those events.

## Validation before production rollout

Run `node --test src/modules/whatsapp/session.test.cjs src/modules/whatsapp/auth-store.test.cjs`.
These tests mock transport and SQL; they do not replace the following live checks:

1. Link a test phone and send/receive a test message.
2. Restart the Node service, then send/receive again without a QR scan.
3. Interrupt network access briefly; confirm automatic reconnect with no QR.
4. Redeploy while preserving the database; confirm the existing link restores.
5. Click Disconnect / Logout; restart and confirm it stays logged out.
6. Unlink from the phone; confirm a relink prompt and no reconnect loop.

Production rollout and live phone validation require the actual hosting target.
