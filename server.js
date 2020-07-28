
const { Pool } = require('pg');
const express = require('express');
const fs = require('fs');

const config = require('./config.js');
const Database = require('./database.js');
const multipartReader = require('./multipartReader.js');
const message = require('./message.js');
const payment = require('./payment.js');
const asyncHandler = require('./asynchandler.js');

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

app.use(express.static('site'));

// cli user
// just use a keypair and create the signed json messages

// web user
// let user login to the static site with cookie/token/paymail
// the static pages can create the signed json messages and post them 

// static pages
// login.html
// form.html
// tag.html

let tagData = asyncHandler(async function (req, res) {

    let { db } = req.app.get('context');
    
    if (req.message.query === undefined) {
        res.status(200).json({ error: 'INVALID_QUERY' });
    }
    
    let info = await db.messages.tagPageInfo(req.message.tag);
    
    if (info === undefined) {
        res.status(200).end();
        return;
    }

    let hasAccess = (await db.payments.hasAccess(req.message.sender, req.message.tag))||false;
    
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

let tagInfo = asyncHandler(async function (req,res) {
    
    if (req.message.query === undefined) {
        res.status(200).json({ error: 'INVALID_QUERY' });
    }

    let tag = req.message.query.tag;
    let info = await db.messages.tagPageInfo(tag);
    res.json(info).end();
});

const handleMessage = asyncHandler(async function (req, res, next) {
    if (req.message.tag === 'api') {
        let actions = {
            'tagdata': tagData,
            'taginfo': tagInfo,
            'payinvoice': payment.payInvoice
        }

        if (req.message.subject && actions[req.message.subject]) {
            return actions[req.message.subject](req, res, next);
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








