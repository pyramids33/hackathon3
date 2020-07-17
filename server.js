
const { Pool } = require('pg');
const express = require('express');
const fs = require('fs');
const { promisify } = require('util');
const fs_rename = promisify(fs.rename);
const bsv = require('bsv');
const bsvMessage = require('bsv/message');
const path = require('path');
const moment = require('moment');

const config = require('./config.js');
const Database = require('./database.js');
const multipartReader = require('./multipartReader.js');

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

const asyncHandler = function (fn) {
    return function (req, res, next) {
        Promise.resolve(fn(req, res, next)).catch(function (error) {
            console.log(error.stack); 
            next(error);
        });
    }
}

let saveMessage = asyncHandler(async function (req, res, next) {

    let { db, config } = req.app.get('context');

    let storagepath = path.resolve(config.storagePath, req.message.messageid + '.bin');

    let qparams = { 
        messageid: req.message.messageid, 
        tag: req.message.tag,
        subject: req.message.subject, 
        sender: req.message.sender, 
        timestamp: req.message.timestamp, 
        messagestring: req.body.message, 
        sig: req.body.sig
    };

    await db.messages.addMessage(qparams, async function () {
        if (req.files['filedata']) {
            await fs_rename(req.files['filedata'].file, storagepath);
        }
    });

    //await db.messages.hashTag({ tag: req.message.tag });

    res.status(200).end();
    //next();
});



if (process.argv.length > 2) {
    Object.assign(config, JSON.parse(fs.readFileSync(process.argv[2])));
}

console.log('env', process.env.NODE_ENV||'dev');
console.log('config', process.argv[2]||'default');

const pool = new Pool(config.postgres);

pool.on('error', function (err, client) {
    console.log('POOL ERROR', err.message)
});

const db = Database.GetDatabase(pool);

const readMultipart = multipartReader({ tempDir: config.tempPath });
    
const app = express();
app.disable('etag');
app.disable('x-powered-by');

if (config.env != 'dev') {
    app.set('trust proxy', 'loopback');
}

app.set('context', { db, config });

app.post('', readMultipart, validateMessage, saveMessage);

(async function () {
    try {
        await db.initSchemas();

        app.listen(config.port, config.host, function () {
            console.log(`Listening ${config.host}:${config.port}!`);
        });
    } catch (err) {
        console.log(err.stack);
    }
})();








