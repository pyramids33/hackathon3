
const { Pool } = require('pg');
const express = require('express');
const fs = require('fs');
const bsv = require('bsv');

const JSONEnveloper = require('./jsonenveloper.js');
const config = require('./config.js');
const Database = require('./database.js');
const multipartReader = require('./multipartReader.js');
const message = require('./message.js');
const payment = require('./payment.js');
const asyncHandler = require('./asynchandler.js');

const path = require('path');
const { promisify } = require('util');
const fs_exists = promisify(fs.exists);

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

let jsonEnvelope = JSONEnveloper(bsv.PrivateKey.fromString(config.signingKey));

app.set('context', { db, config, jsonEnvelope });

app.use(function(req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    next();
});

app.use(express.static('site'));

let tagData = asyncHandler(async function (req, res) {

    let { db } = req.app.get('context');
    
    if (req.message.query === undefined) {
        res.status(200).json({ error: 'INVALID_QUERY' });
    }
    
    let info = await db.messages.tagPageInfo(req.message.query.tag);
    
    if (info === undefined) {
        res.status(200).end();
        return;
    }

    let hasAccess = (await db.payments.hasAccess(req.message.sender, req.message.query.tag))||false;
    
    if (!hasAccess) {
        return payment.requirePayment(req, res, info);
    }

    let rows = await db.messages.tagPageData(
        req.message.query.tag, parseInt(req.message.query.from)||1, 50);
    
    rows.forEach(function (row) {
        res.write(JSON.stringify(row)+'\n');
    });
    
    res.end();
});

let getAttachment = asyncHandler(async function (req, res) {

    let { db } = req.app.get('context');
    
    if (req.message.query === undefined) {
        res.status(200).json({ error: 'INVALID_QUERY' });
    }
    
    let info = await db.messages.tagPageInfo(req.message.query.tag);
    
    if (info === undefined) {
        res.status(200).end();
        return;
    }

    let hasAccess = (await db.payments.hasAccess(req.message.sender, req.message.query.tag))||false;
    
    if (!hasAccess) {
        return payment.requirePayment(req, res, info);
    }

    info = await db.messages.tagPageData(req.message.query.tag, req.message.query.index, 1);
    
    if (info === undefined || info.length === 0) {
        res.status(404).end();
        return;
    }

    info = info[0];
    
    let storagepath = info[0] + '.bin';

    let fileExists = await fs_exists(path.resolve(config.storagePath,storagepath));
    
    if (fileExists === false) {
        res.status(404).end();
        return;
    }

    res.sendFile(storagepath, { root: config.storagePath });
});

let tagInfo = asyncHandler(async function (req,res) {
    
    let { jsonEnvelope } = req.app.get('context');

    if (req.message.query === undefined) {
        res.status(200).json({ error: 'INVALID_QUERY' });
    }

    let tag = req.message.query.tag;
    let info = await db.messages.tagPageInfo(tag);

    if (info === undefined) {
        res.status(200).json({ error: 'UNKNOWN_TAG'});
        return;
    }

    let signed = jsonEnvelope(info);
    res.json(signed).end();
});

const handleMessage = asyncHandler(async function (req, res, next) {
    if (req.message.tag === 'api') {
        let actions = {
            'tagdata': tagData,
            'taginfo': tagInfo,
            'getattachment': getAttachment,
            'payinvoice': payment.payInvoice,
            'notifybroadcast': payment.notifyBroadcast
        };

        if (req.message.subject && actions[req.message.subject]) {
            return actions[req.message.subject](req, res, next);
        } else {
            res.status(200).json({})
        }
    } else {
        res.status(200).json({})
    }
});

app.post('', readMultipart, message.validateMessage, message.saveMessage, handleMessage);

(async function () {
    try {
        await db.initSchemas();

        let server = app.listen(config.port, config.host, function () {
            console.log(`Listening ${config.host}:${config.port}!`);
        });
        server.on('error', function (err) {
            console.log(err.stack);
            pool.end(function () {});
        });
        server.on('close', function (err) {
            pool.end(function () {});
        });
    } catch (err) {
        console.log(err.stack);
        await pool.end();
    }
})();








