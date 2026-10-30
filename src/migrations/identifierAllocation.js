// Only allocation crosses branch visibility: return a new ID, never another branch's data.
async function migrateIdentifierAllocation(client, { grantRuntimeRole = true } = {}) {
  await client.query(`
    CREATE SEQUENCE IF NOT EXISTS public.entity_id_sequence START 1000000000;
    CREATE OR REPLACE FUNCTION public.retail_next_entity_id(
      target_table text, target_column text, id_prefix text, pad_width integer
    ) RETURNS text LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = pg_catalog, public AS $$
    DECLARE candidate text; occupied boolean; n text;
    BEGIN
      IF target_table NOT IN ('users','customers','vendors','products','invoices','accounts','payments',
        'held_bills','repair_jobs','repair_services','repair_parts','repair_additional_work_requests',
        'whatsapp_conversations','expenses','vendor_returns')
        OR target_column <> 'id' OR id_prefix !~ '^[A-Z0-9]+$'
        OR pad_width < 1 OR pad_width > 30 THEN
        RAISE EXCEPTION 'Invalid entity identifier' USING ERRCODE='22023';
      END IF;
      LOOP
        n := nextval('public.entity_id_sequence'::regclass)::text;
        candidate := id_prefix || '-' || lpad(n, greatest(pad_width,length(n)), '0');
        EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I WHERE %I = $1)', target_table,target_column)
          INTO occupied USING candidate;
        IF NOT occupied THEN RETURN candidate; END IF;
      END LOOP;
    END $$;
    REVOKE ALL ON FUNCTION public.retail_next_entity_id(text,text,text,integer) FROM PUBLIC;
  `);
  if (grantRuntimeRole) {
    await client.query('GRANT EXECUTE ON FUNCTION public.retail_next_entity_id(text,text,text,integer) TO retail_branch_runtime');
  }
}
module.exports = { migrateIdentifierAllocation };
