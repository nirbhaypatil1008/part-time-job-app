const mongoose = require('mongoose');
const {models, relations, modelFor} = require('./models');

function toId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) {
    throw Object.assign(new Error('Invalid identifier'), {status: 400});
  }
  return id;
}

function requireConnection() {
  if (mongoose.connection.readyState !== 1) {
    throw new Error('MongoDB has not been initialized');
  }
}

function applyQueryOptions(query, options = {}) {
  if (options.sort) query.sort(options.sort);
  if (options.skip) query.skip(options.skip);
  if (options.limit) query.limit(options.limit);
  if (options.session) query.session(options.session);
  return query;
}

function collection(name) {
  requireConnection();
  const Model = modelFor(name);

  return {
    findOne(filter = {}, options = {}) {
      const query = Model.findOne(filter, options.projection);
      return applyQueryOptions(query, options).lean().exec();
    },

    find(filter = {}, options = {}) {
      let query = Model.find(filter, options.projection);
      query = applyQueryOptions(query, options);
      return {
        sort(value) { query = query.sort(value); return this; },
        skip(value) { query = query.skip(value); return this; },
        limit(value) { query = query.limit(value); return this; },
        project(value) { query = query.select(value); return this; },
        async toArray() { return query.lean().exec(); }
      };
    },

    aggregate(pipeline = [], options = {}) {
      const aggregate = Model.aggregate(pipeline);
      if (options.session) aggregate.session(options.session);
      return {toArray: () => aggregate.exec()};
    },

    countDocuments(filter = {}, options = {}) {
      return Model.countDocuments(filter).setOptions({session: options.session}).exec();
    },

    updateOne(filter, update, options = {}) {
      return Model.updateOne(filter, update, {
        ...options,
        runValidators: true,
        setDefaultsOnInsert: true
      }).exec();
    },

    updateMany(filter, update, options = {}) {
      return Model.updateMany(filter, update, {
        ...options,
        runValidators: true,
        setDefaultsOnInsert: true
      }).exec();
    },

    findOneAndUpdate(filter, update, options = {}) {
      return Model.findOneAndUpdate(filter, update, {
        ...options,
        runValidators: true,
        setDefaultsOnInsert: true
      }).lean().exec();
    },

    deleteOne(filter, options = {}) {
      return Model.deleteOne(filter, {session: options.session}).exec();
    },

    deleteMany(filter, options = {}) {
      return Model.deleteMany(filter, {session: options.session}).exec();
    },

    createIndex(keys, options) {
      return Model.collection.createIndex(keys, options);
    }
  };
}

async function nextId(name, session) {
  requireConnection();
  const counter = await models.counters.findOneAndUpdate(
    {_id: name},
    {$inc: {value: 1}},
    {upsert: true, returnDocument: 'after', session, setDefaultsOnInsert: true}
  ).lean().exec();
  if (!counter) throw new Error(`Unable to allocate an identifier for "${name}"`);
  return counter.value;
}

async function addObjectIdReferences(name, document, session) {
  for (const [foreignKey, referenceKey, relatedCollection] of relations[name] || []) {
    if (document[referenceKey] || document[foreignKey] == null) continue;
    let query = modelFor(relatedCollection).findOne({id: Number(document[foreignKey])}, {_id: 1});
    if (session) query = query.session(session);
    const related = await query.lean().exec();
    if (related) document[referenceKey] = related._id;
  }

  if (name === 'otp_verifications' && document.purpose === 'email_registration') {
    let query = models.pending_registrations.findOne({token: document.email}, {_id: 1});
    if (session) query = query.session(session);
    const pending = await query.lean().exec();
    if (pending) document.pending_registration_ref = pending._id;
  }
}

async function insertDocument(name, document, session) {
  requireConnection();
  const created = {
    ...document,
    id: document.id || await nextId(name, session)
  };
  await addObjectIdReferences(name, created, session);
  const Model = modelFor(name);
  const [saved] = await Model.create([created], {session});
  return saved.toObject();
}

async function transaction(work) {
  requireConnection();
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

async function initializeDatabase() {
  if (mongoose.connection.readyState === 1) return;
  if (mongoose.connection.readyState === 2) {
    await mongoose.connection.asPromise();
    return;
  }

  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI is required. Set it in the local .env file.');
  await mongoose.connect(uri, {serverSelectionTimeoutMS: 10000});
  for (const Model of Object.values(models)) {
    await Model.createIndexes();
  }
  console.log(`MongoDB connected to database "${mongoose.connection.name}"`);
}

async function closeDatabase() {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
}

module.exports = {
  client: mongoose,
  collection,
  insertDocument,
  initializeDatabase,
  closeDatabase,
  nextId,
  toId,
  transaction
};
