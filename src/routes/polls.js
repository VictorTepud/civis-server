const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const { authenticate } = require('../middlewares/authMiddleware');

const router = express.Router();

// Helper: get io instance
let io;
function getIo() {
  if (!io) {
    const { getServerIo } = require('../services/socketService');
    io = getServerIo();
  }
  return io;
}

// Helper: format poll with vote counts
function formatPollWithVotes(poll, userId) {
  const options = JSON.parse(poll.options);
  const votes = db.prepare('SELECT option_index, user_id FROM poll_votes WHERE poll_id = ?').all(poll.id);

  const voteCounts = {};
  const userVotes = [];

  votes.forEach(vote => {
    voteCounts[vote.option_index] = (voteCounts[vote.option_index] || 0) + 1;
    if (vote.user_id === userId) {
      userVotes.push(vote.option_index);
    }
  });

  const optionsWithCounts = options.map((opt, index) => ({
    text: opt,
    votes: voteCounts[index] || 0,
  }));

  return {
    ...poll,
    option_colors: poll.option_colors ? JSON.parse(poll.option_colors) : null,
    options: optionsWithCounts,
    user_voted: userVotes.length > 0,
    user_votes: userVotes,
  };
}

// Helper: get or create private conversation
function getOrCreatePrivateConversation(userId, receiverId) {
  let conversation = db.prepare(`
    SELECT c.id FROM conversations c
    JOIN conversation_participants cp1 ON c.id = cp1.conversation_id AND cp1.user_id = ?
    JOIN conversation_participants cp2 ON c.id = cp2.conversation_id AND cp2.user_id = ?
    WHERE c.type = 'private'
  `).get(userId, receiverId);

  if (!conversation) {
    const convId = uuidv4();
    db.prepare('INSERT INTO conversations (id, type, created_by) VALUES (?, ?, ?)').run(convId, 'private', userId);
    db.prepare('INSERT INTO conversation_participants (conversation_id, user_id) VALUES (?, ?)').run(convId, userId);
    db.prepare('INSERT INTO conversation_participants (conversation_id, user_id) VALUES (?, ?)').run(convId, receiverId);
    conversation = { id: convId };
  }

  return conversation;
}

// Helper: get or create group conversation
function getOrCreateGroupConversation(groupId) {
  let conversation = db.prepare(`
    SELECT c.id FROM conversations c
    JOIN conversation_participants cp ON c.id = cp.conversation_id
    WHERE c.type = 'group' AND cp.user_id = ?
  `).get(groupId);

  if (!conversation) {
    const convId = uuidv4();
    db.prepare('INSERT INTO conversations (id, type, created_by) VALUES (?, ?, ?)').run(convId, 'group', groupId);
    // Add group members as participants
    const members = db.prepare('SELECT user_id FROM group_members WHERE group_id = ?').all(groupId);
    members.forEach(member => {
      db.prepare('INSERT INTO conversation_participants (conversation_id, user_id) VALUES (?, ?)').run(convId, member.user_id);
    });
    conversation = { id: convId };
  }

  return conversation;
}

// Helper: send poll message and emit via socket
function sendPollMessage(poll, conversationId, senderId, receiverId, groupId, replyTo) {
  const messageContent = JSON.stringify({
    poll_id: poll.id,
    question: poll.question,
    options: JSON.parse(poll.options),
    multiple: poll.multiple === 1,
    option_colors: poll.option_colors ? JSON.parse(poll.option_colors) : null,
    style: poll.style || 'bars',
  });

  const messageId = uuidv4();
  db.prepare(`INSERT INTO messages (id, conversation_id, sender_id, receiver_id, group_id, content, message_type, reply_to)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(messageId, conversationId, senderId, receiverId || null, groupId || null, messageContent, 'poll', replyTo || null);

  db.prepare(`UPDATE conversations SET last_message = ?, last_message_time = datetime('now') WHERE id = ?`)
    .run('📊 Poll: ' + poll.question, conversationId);

  // Update poll with message_id
  db.prepare('UPDATE polls SET message_id = ? WHERE id = ?').run(messageId, poll.id);

  const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
  const sender = db.prepare('SELECT id, name, avatar FROM users WHERE id = ?').get(senderId);

  // Emit via socket
  const socketIo = getIo();
  if (socketIo) {
    const messageWithSender = { ...message, sender };

    if (groupId) {
      const members = db.prepare('SELECT user_id FROM group_members WHERE group_id = ?').all(groupId);
      members.forEach(member => {
        if (member.user_id !== senderId) {
          socketIo.emit(`group_message_${member.user_id}`, messageWithSender);
        }
      });
    } else if (receiverId) {
      socketIo.emit(`message_${receiverId}`, messageWithSender);
    }
  }

  return db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
}

// POST / — Create poll
router.post('/', authenticate, (req, res) => {
  try {
    const { receiver_id, group_id, question, options, multiple, option_colors, style, reply_to } = req.body;

    if (!question || !question.trim()) {
      return res.status(400).json({ error: 'Question is required.' });
    }

    if (!options || !Array.isArray(options) || options.length < 2) {
      return res.status(400).json({ error: 'At least 2 options are required.' });
    }

    if (!receiver_id && !group_id) {
      return res.status(400).json({ error: 'receiver_id or group_id is required.' });
    }

    const pollStyle = style || 'bars';
    const optionColors = option_colors && Array.isArray(option_colors) ? JSON.stringify(option_colors) : null;

    const pollId = uuidv4();
    const optionsJson = JSON.stringify(options);

    // Create poll - store option_colors as JSON if provided
    if (optionColors) {
      db.prepare('INSERT INTO polls (id, question, options, multiple, created_by, option_colors, style) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(pollId, question.trim(), optionsJson, multiple ? 1 : 0, req.user.id, optionColors, pollStyle);
    } else {
      db.prepare('INSERT INTO polls (id, question, options, multiple, created_by, style) VALUES (?, ?, ?, ?, ?, ?)')
        .run(pollId, question.trim(), optionsJson, multiple ? 1 : 0, req.user.id, pollStyle);
    }

    const poll = db.prepare('SELECT * FROM polls WHERE id = ?').get(pollId);

    // Create message through existing conversation system
    let conversationId;
    if (group_id) {
      const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(group_id);
      if (!group) {
        return res.status(404).json({ error: 'Group not found.' });
      }
      const conversation = getOrCreateGroupConversation(group_id);
      conversationId = conversation.id;
    } else {
      const receiver = db.prepare('SELECT id FROM users WHERE id = ?').get(receiver_id);
      if (!receiver) {
        return res.status(404).json({ error: 'Receiver not found.' });
      }
      const conversation = getOrCreatePrivateConversation(req.user.id, receiver_id);
      conversationId = conversation.id;
    }

    // Send the poll as a message
    const message = sendPollMessage(poll, conversationId, req.user.id, receiver_id || null, group_id || null, reply_to || null);

    res.status(201).json({
      poll: formatPollWithVotes(poll, req.user.id),
      message,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /:pollId/vote — Vote on a poll
router.post('/:pollId/vote', authenticate, (req, res) => {
  try {
    const { pollId } = req.params;
    const { option_index } = req.body;

    if (option_index === undefined || option_index === null) {
      return res.status(400).json({ error: 'option_index is required.' });
    }

    const poll = db.prepare('SELECT * FROM polls WHERE id = ?').get(pollId);
    if (!poll) {
      return res.status(404).json({ error: 'Poll not found.' });
    }

    const options = JSON.parse(poll.options);
    if (option_index < 0 || option_index >= options.length) {
      return res.status(400).json({ error: 'Invalid option_index.' });
    }

    if (poll.multiple === 1) {
      // Multiple choice: just insert (unique constraint prevents duplicate)
      try {
        const voteId = uuidv4();
        db.prepare('INSERT INTO poll_votes (id, poll_id, user_id, option_index) VALUES (?, ?, ?, ?)')
          .run(voteId, pollId, req.user.id, option_index);
      } catch (insertErr) {
        if (insertErr.message && insertErr.message.includes('UNIQUE')) {
          return res.status(400).json({ error: 'Already voted for this option.' });
        }
        throw insertErr;
      }
    } else {
      // Single choice: delete any existing vote, then insert new one
      db.prepare('DELETE FROM poll_votes WHERE poll_id = ? AND user_id = ?')
        .run(pollId, req.user.id);

      const voteId = uuidv4();
      db.prepare('INSERT INTO poll_votes (id, poll_id, user_id, option_index) VALUES (?, ?, ?, ?)')
        .run(voteId, pollId, req.user.id, option_index);
    }

    // Recalculate total_votes (distinct users who voted)
    const totalVotesResult = db.prepare('SELECT COUNT(DISTINCT user_id) as count FROM poll_votes WHERE poll_id = ?')
      .get(pollId);
    db.prepare('UPDATE polls SET total_votes = ? WHERE id = ?')
      .run(totalVotesResult.count, pollId);

    const updatedPoll = db.prepare('SELECT * FROM polls WHERE id = ?').get(pollId);
    const formattedPoll = formatPollWithVotes(updatedPoll, req.user.id);

    // Get the user's latest vote for this poll (single choice: the one just cast)
    const userVote = db.prepare('SELECT option_index FROM poll_votes WHERE poll_id = ? AND user_id = ?')
      .get(pollId, req.user.id);

    // Emit poll_vote socket event
    const socketIo = getIo();
    if (socketIo) {
      const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(poll.message_id);

      if (message) {
        if (message.group_id) {
          const members = db.prepare('SELECT user_id FROM group_members WHERE group_id = ?').all(message.group_id);
          members.forEach(member => {
            socketIo.emit(`poll_vote_${member.user_id}`, {
              poll_id: pollId,
              user_id: req.user.id,
              option_index,
              poll: formattedPoll,
            });
          });
        } else {
          // Emit to the conversation participants
          const participants = db.prepare(
            'SELECT user_id FROM conversation_participants WHERE conversation_id = ?'
          ).all(message.conversation_id);

          participants.forEach(participant => {
            socketIo.emit(`poll_vote_${participant.user_id}`, {
              poll_id: pollId,
              user_id: req.user.id,
              option_index,
              poll: formattedPoll,
            });
          });
        }
      }
    }

    res.json({
      poll: formattedPoll,
      user_vote: userVote ? userVote.option_index : null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /:pollId — Get poll results
router.get('/:pollId', authenticate, (req, res) => {
  try {
    const { pollId } = req.params;

    const poll = db.prepare('SELECT * FROM polls WHERE id = ?').get(pollId);
    if (!poll) {
      return res.status(404).json({ error: 'Poll not found.' });
    }

    const formattedPoll = formatPollWithVotes(poll, req.user.id);

    res.json(formattedPoll);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
