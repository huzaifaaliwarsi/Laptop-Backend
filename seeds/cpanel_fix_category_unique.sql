DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (
        SELECT tc.table_name, tc.constraint_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.constraint_column_usage ccu 
          ON tc.constraint_name = ccu.constraint_name
        WHERE tc.table_schema = 'public'
          AND tc.constraint_type = 'UNIQUE'
          AND tc.table_name IN (
            'product_categories', 'accessory_categories', 'repair_categories',
            'expense_categories', 'spare_part_categories', 'products',
            'repair_services', 'repair_parts'
          )
          AND ccu.column_name IN ('name', 'code', 'tracking_id')
    ) LOOP
        BEGIN
            EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I;', r.table_name, r.constraint_name);
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
    END LOOP;

    -- Add per-branch unique indexes instead of global unique constraints
    BEGIN EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS uq_branch_product_categories_name ON product_categories(branch_id, name);'; EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS uq_branch_accessory_categories_name ON accessory_categories(branch_id, name);'; EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS uq_branch_repair_categories_name ON repair_categories(branch_id, name);'; EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS uq_branch_expense_categories_name ON expense_categories(branch_id, name);'; EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS uq_branch_spare_part_categories_name ON spare_part_categories(branch_id, name);'; EXCEPTION WHEN OTHERS THEN NULL; END;
END $$;

