const { Client } = require('pg');

async function createDb() {
  const c = new Client({
    host: '127.0.0.1',
    port: 5432,
    user: 'postgres',
    password: 'admin123',
    database: 'postgres'
  });

  await c.connect();
  console.log('Connected to local PostgreSQL server.');

  const res = await c.query("SELECT 1 FROM pg_database WHERE datname='retail_repair_db'");
  if (!res.rows.length) {
    await c.query('CREATE DATABASE "retail_repair_db"');
    console.log('Database "retail_repair_db" created successfully!');
  } else {
    console.log('Database "retail_repair_db" already exists.');
  }

  await c.end();
}

createDb().catch(err => {
  console.error('Error creating database:', err);
  process.exit(1);
});

