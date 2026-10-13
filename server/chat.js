const express = require('express');
const router = express.Router();
const {collection, insertDocument, toId} = require('./db');

async function complaintParticipant(req, reportId) {
  return collection('reports').findOne({
    id: toId(reportId),
    $or: [{reporter_id: req.user.id}, {target_user_id: req.user.id}]
  }, {projection: {id: 1, reporter_id: 1, target_user_id: 1}});
}

async function messages(reportId, messageId) {
  const match = {report_id: reportId};
  if (messageId !== undefined) match.id = messageId;
  return collection('complaint_messages').aggregate([
    {$match: match},
    {$lookup: {from: 'users', localField: 'sender_id', foreignField: 'id', as: 'sender'}},
    {$unwind: '$sender'},
    {$project: {
      _id: 0, id: 1, report_id: 1, sender_id: 1, message: 1, created_at: 1,
      sender_name: '$sender.full_name', sender_role: '$sender.role'
    }},
    {$sort: {created_at: 1}}
  ]).toArray();
}

router.get('/:reportId/messages', async (req, res, next) => {
  try {
    const report = await complaintParticipant(req, req.params.reportId);
    if (!report) return res.status(404).json({message: 'Complaint not found'});
    const rows = await messages(report.id);
    res.json({data: rows.map(row => ({id: row.id, reportId: row.report_id, senderId: row.sender_id, senderName: row.sender_name, senderRole: row.sender_role, message: row.message, createdAt: row.created_at}))});
  } catch (error) { next(error); }
});

router.post('/:reportId/messages', async (req, res, next) => {
  try {
    const message = String(req.body.message || '').trim();
    if (!message) return res.status(400).json({message: 'Message cannot be empty'});
    if (message.length > 2000) return res.status(400).json({message: 'Message is too long'});
    const report = await complaintParticipant(req, req.params.reportId);
    if (!report) return res.status(404).json({message: 'Complaint not found'});
    const created = await insertDocument('complaint_messages', {report_id: report.id, sender_id: req.user.id, message});
    const rows = await messages(report.id, created.id);
    const row = rows[0];
    res.status(201).json({data: {id: row.id, reportId: row.report_id, senderId: row.sender_id, senderName: row.sender_name, senderRole: row.sender_role, message: row.message, createdAt: row.created_at}, message: 'Message sent'});
  } catch (error) { next(error); }
});

module.exports = router;
