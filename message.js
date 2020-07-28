const fs = require('fs');
const { promisify } = require('util');
const fs_rename = promisify(fs.rename);
const bsvMessage = require('bsv/message');
const path = require('path');
const moment = require('moment');

const asyncHandler = require('./asynchandler.js');

function validateMessage (req, res, next) {

    if (req.message === undefined) {
        res.status(200).json({ error: 'EMPTY_MESSAGE' });
        return;
    }

    let validId = /^[a-zA-Z0-9]+$/.test(req.message.messageid);
                
    if (!validId) {
        res.status(200).json({ error: 'INVALID_MESSAGE_ID' });
        return;
    }

    try {
        let validSig = new bsvMessage(req.body.message).verify(req.message.sender, req.body.sig);
        
        if (!validSig) {
            res.status(200).json({ error: 'INVALID_SIGNATURE' });
            return;
        }
    } catch (error) {
        res.status(200).json({ error: 'INVALID_SIGNATURE' });
        return;
    }

    let validTimestamp = moment(req.message.timestamp, moment.ISO_8601, true).isValid();

    if (!validTimestamp) {
        res.status(200).json({ error: 'INVALID_TIMESTAMP' });
        return;
    }

    next();
}

const saveMessage = asyncHandler(async function (req, res, next) {

    let { db, config } = req.app.get('context');

    let storagepath = path.resolve(config.storagePath, req.message.messageid + '.bin');

    let qparams = { 
        messageid: req.message.messageid, 
        tag: req.message.tag,
        subject: req.message.subject, 
        sender: req.message.sender, 
        timestamp: req.message.timestamp, 
        messagestring: req.body.message, 
        sig: Buffer.from(req.body.sig,'base64').toString('hex')
    };

    await db.messages.addMessage(qparams, async function () {
        if (req.files['filedata']) {
            await fs_rename(req.files['filedata'].file, storagepath);
        }
    });

    next();
});

module.exports = {
    validateMessage,
    saveMessage
}