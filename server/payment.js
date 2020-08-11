
const bsv = require('bsv');
const axios = require('axios');
const moment = require('moment');
const { PaymailClient } = require('@moneybutton/paymail-client');

const asyncHandler = require('./asynchandler.js');

let paymailClient = new PaymailClient();

let getInvoice = asyncHandler(async function (req, res) {
    let { db, config } = req.app.get('context');

    let taginfo = await db.messages.tagPageInfo(req.message.query.tag);
    
    if (taginfo === undefined) {
        res.status(200).json({ error: 'UNKNOWN_TAG'});
        return;
    }

    let invoiceid = moment().valueOf().toString() + Math.random().toFixed(10).slice(2);

    // create unsigned tx for invoice
    let tx = new bsv.Transaction();

    await Promise.all(
        config.paymentOuts.map(async function (item) {
            if (item.paymail) {              
                let output = await paymailClient.getOutputFor(item.paymail, {
                    senderHandle: config.paymailClient.handle,
                    amount: item.sats,
                    senderName: config.handle,
                    purpose: 'hackathon3invoice'
                }, config.paymailClient.key);

                tx.addOutput(new bsv.Transaction.Output({ script: output, satoshis: item.sats }));
            } else if (item.address) {
                tx.to(item.address, item.sats);
            }
        }));

    let opreturnData = jsonEnvelope([ invoiceid, taginfo.tag, taginfo.index.toString(), taginfo.taghash, req.message.sender ]);

    tx.addSafeData([ 
        opreturnData.payload, 
        Buffer.from(opreturnData.sig, 'hex'), 
        Buffer.from(opreturnData.publicKey, 'hex'),
        opreturnData.encoding,
        opreturnData.mimetype
    ]);

    await db.payments.addInvoice({
        invoiceid,
        created: moment().toISOString(),
        userid: req.message.sender,
        amount: tx.outputAmount,
        tag: taginfo.tag, 
        index: taginfo.index,
        invoicetx: tx.toString()
    });

    signed = jsonEnvelope({
        purpose: 'Access to tag:' + taginfo.tag + ' for one hour',
        taghash: taginfo,
        invoiceid,
        tx: tx.toString()
    });

    res.json(signed);
    return;
});

let requirePayment = async function (req, res, taginfo) {
    res.status(402);
    res.json({ error: 'PAYMENT_REQUIRED', description: 'send getinvoice message to begin payment.', taginfo });
    return;
};

let payInvoice = asyncHandler(async function (req, res, next) {

    let { db, config } = req.app.get('context');

    //console.log('message', req.message);

    let invoice = await db.payments.getInvoice(req.message.invoiceid)

    //console.log('invoice', invoice);

    let signedTx = new bsv.Transaction(req.message.paymenttx);
    let invoiceTx = new bsv.Transaction(invoice.invoicetx);
       
    let match = true;

    invoiceTx.outputs.forEach(function (o2) {
        let found = signedTx.outputs.find(o1 => o1.script.toString() === o2.script.toString());
        
        if (found === undefined) {
            match = false;
        }
    });

    if (!match || !invoiceTx.verify()) {
        res.status(200).json({ error: 'INVALID_TRANSACTION' });
        return;
    }

    await db.payments.setPaymentAccepted({ invoiceid: invoice.invoiceid, txid: signedTx.id });

    res.status(200).json({ 
        invoiceid: invoice.invoiceid, 
        txid: signedTx.id
    });
});

let notifyBroadcast = asyncHandler(async function (req, res, next) {

    let { db, config } = req.app.get('context');

    let invoice = await db.payments.getInvoice(req.message.invoiceid)

    if (invoice.status === 'done') {
        res.status(200).json({ error: 'INVOICE_DONE' });
        return;
    }
    //console.log(invoice);
    let broadcastRes = await axios.get(
        config.mapiUrl + 'tx/' + invoice.paymenttxid,
        { headers: { 
            'token': config.mapiToken
        }});

    let payload = JSON.parse(broadcastRes.data.payload);
    
    if (payload.returnResult === 'failure') {
        res.status(200).json({ error: 'INVALID_TRANSACTION', description: payload.resultDescription });
        return;
    }

    if (payload.returnResult === 'success') {
        await db.payments.addAccess({ 
            invoiceid: invoice.invoiceid,
            txid: invoice.paymenttxid, 
            userid: invoice.userid, 
            created: new Date().toISOString(), 
            tag: invoice.tag,
            index: invoice.index
        });
    }

    res.status(200).end();
});

module.exports = {
    requirePayment,
    getInvoice,
    payInvoice,
    notifyBroadcast
};