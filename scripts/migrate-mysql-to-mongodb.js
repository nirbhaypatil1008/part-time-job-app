require('dotenv').config();

const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');
const {initializeDatabase, closeDatabase} = require('../server/db');
const {models, relations, modelFor} = require('../server/models');

const excludedTable = /^razorpay_transactions$/i;
const removedGatewayField = /razorpay|^(?:gateway|provider)(?:_|$)|^(?:transaction_id|payment_signature|order_signature|order_id|environment)$/i;

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for the MySQL migration.`);
  return value;
}

function normalizeRow(row) {
  const result = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === '_id' || key === '__v') continue;
    if (removedGatewayField.test(key)) continue;
    result[key] = value instanceof Date ? value.toISOString() : value;
  }
  return result;
}

async function readPrimaryKey(connection, tableName) {
  const safeName = tableName.replace(/`/g, '``');
  const [rows] = await connection.query(`SHOW KEYS FROM \`${safeName}\` WHERE Key_name = 'PRIMARY'`);
  return rows.map(row => row.Column_name);
}

function migrationKey(row, tableName, primaryKeys) {
  if (row.id != null && Number.isSafeInteger(Number(row.id)) && Number(row.id) > 0) {
    row.id = Number(row.id);
    return {filter: {id: row.id}, numericId: row.id};
  }
  const key = primaryKeys.map(name => String(row[name])).join('|');
  if (!key || primaryKeys.some(name => row[name] == null)) {
    throw new Error(`Cannot safely identify a source row in "${tableName}".`);
  }

  if (row.id != null) {
    row.legacy_id = row.id;
    delete row.id;
  }
  row._legacy_primary_key = key;
  return {filter: {_legacy_primary_key: key}, numericId: null};
}

async function importTable(connection, tableName) {
  const safeName = tableName.replace(/`/g, '``');
  const primaryKeys = await readPrimaryKey(connection, tableName);
  if (primaryKeys.length === 0) {
    throw new Error(`Table "${tableName}" has no primary key; refusing a non-idempotent import.`);
  }
  const [rows] = await connection.query(`SELECT * FROM \`${safeName}\``);
  const Model = modelFor(tableName);
  let maxId = 0;

  for (const sourceRow of rows) {
    const row = normalizeRow(sourceRow);
    if (['users', 'pending_registrations'].includes(tableName.toLowerCase())) {
      const sourcePassword = row.password_hash || row.password;
      if (sourcePassword && !String(sourcePassword).startsWith('$2')) {
        row.password_hash = await bcrypt.hash(String(sourcePassword), 12);
      } else if (sourcePassword) {
        row.password_hash = sourcePassword;
      }
      delete row.password;
    }

    const {filter, numericId} = migrationKey(row, tableName, primaryKeys);
    await Model.findOneAndUpdate(
      filter,
      {$set: row},
      {upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true}
    ).exec();
    if (numericId) maxId = Math.max(maxId, numericId);
  }

  if (maxId && models[tableName]) {
    await models.counters.updateOne(
      {_id: tableName},
      {$max: {value: maxId}},
      {upsert: true, setDefaultsOnInsert: true, runValidators: true}
    );
  }
  console.log(`Imported ${rows.length} row(s) from ${tableName}.`);
  return rows.length;
}

async function restoreObjectIdReferences() {
  let referenceCount = 0;
  for (const [collectionName, definitions] of Object.entries(relations)) {
    const Model = modelFor(collectionName);
    for (const [foreignKey, referenceKey, relatedCollection] of definitions) {
      const Related = modelFor(relatedCollection);
      const rows = await Model.find({[foreignKey]: {$exists: true, $ne: null}})
        .select(`_id ${foreignKey}`)
        .lean()
        .exec();
      for (const row of rows) {
        const related = await Related.findOne({id: Number(row[foreignKey])}, {_id: 1})
          .lean()
          .exec();
        if (!related) continue;
        await Model.updateOne(
          {_id: row._id},
          {$set: {[referenceKey]: related._id}},
          {runValidators: true}
        ).exec();
        referenceCount++;
      }
    }
  }
  return referenceCount;
}

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    database: requiredEnv('MYSQL_DATABASE'),
    user: requiredEnv('MYSQL_USER'),
    password: process.env.MYSQL_PASSWORD || ''
  });

  try {
    await initializeDatabase();
    const [tableRows] = await connection.query('SHOW TABLES');
    const tables = tableRows.map(row => Object.values(row)[0]);
    if (tables.length === 0) throw new Error('No tables were found in the configured MySQL database.');

    let imported = 0;
    for (const tableName of tables) {
      if (excludedTable.test(tableName)) {
        console.log(`Skipped removed gateway table ${tableName}.`);
        continue;
      }
      imported += await importTable(connection, tableName);
    }

    const references = await restoreObjectIdReferences();
    console.log(`Migration complete: imported ${imported} row(s); linked ${references} ObjectId relationship(s).`);
    console.log('MySQL data was not modified or deleted.');
  } finally {
    await connection.end();
  }
}

main()
  .catch(error => {
    console.error('MySQL-to-MongoDB migration failed:', error.message);
    process.exitCode = 1;
  })
  .finally(closeDatabase);
