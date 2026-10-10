require('dotenv').config();

const {initializeDatabase, closeDatabase} = require('../server/db');

const removedFields = [
  'razorpay_order_id',
  'razorpay_payment_id',
  'razorpay_signature',
  'razorpayOrderId',
  'razorpayPaymentId',
  'razorpaySignature',
  'transaction_id',
  'transactionId',
  'gateway',
  'gateway_order_id',
  'gateway_payment_id',
  'gateway_signature',
  'gatewayOrderId',
  'gatewayPaymentId',
  'gatewaySignature',
  'providerOrderId',
  'providerPaymentId',
  'providerSignature',
  'payment_signature',
  'paymentSignature',
  'order_id',
  'orderId',
  'paymentId',
  'environment'
];

async function main() {
  await initializeDatabase();
  const payments = require('../server/models').models.payment_records.collection;
  const unset = Object.fromEntries(removedFields.map(field => [field, '']));
  const result = await payments.updateMany({}, {$unset: unset});
  const indexes = await payments.listIndexes().toArray();
  const obsoleteIndexes = indexes.filter(index =>
    index.name !== '_id_' && Object.keys(index.key).some(field =>
      /razorpay|transaction(?:_|id)|gateway|provider|signature|order_?id|payment_?id|environment/i.test(field)
    )
  );
  for (const index of obsoleteIndexes) await payments.dropIndex(index.name);
  console.log(`Removed obsolete gateway fields from ${result.modifiedCount} payment record(s) and dropped ${obsoleteIndexes.length} obsolete index(es).`);
}

main()
  .catch(error => {
    console.error('Gateway data cleanup failed:', error.message);
    process.exitCode = 1;
  })
  .finally(closeDatabase);
