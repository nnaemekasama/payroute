/**
 * Attempt to insert a webhook event. Uses ON CONFLICT DO NOTHING
 * for idempotency — if the event_id already exists, returns null.
 */
async function insertIfNew(client, data) {
  const result = await client.query(
    `INSERT INTO webhook_events (event_id, event_type, provider_reference, raw_payload, signature)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (event_id) DO NOTHING
     RETURNING *`,
    [data.eventId, data.eventType, data.providerReference, data.rawPayload, data.signature]
  );
  return result.rows[0] || null;
}

async function markProcessed(client, id) {
  await client.query(
    'UPDATE webhook_events SET processed = TRUE, processed_at = NOW() WHERE id = $1',
    [id]
  );
}

module.exports = { insertIfNew, markProcessed };
