
const bsv = require('bsv');
const axios = require('axios');
const asyncHandler = require('./asynchandler.js');

// client:
// check access
// if 402
//     create invoice
//     pay invoice
//     check again
//

// from site configs
let dummyspec = [
    { address: '12yxtkjgKtaAqLeB3kQn5dgdEwRDS1i249', amount: 1000 },
    { address: '1Hzb2yVHGo9tMHaEEDpZj8fTV8hNWtD4nF', amount: 1000 }
];

let requirePayment = async function (req, res, taginfo) {

    let { db } = req.app.get('context');

    res.status(402);
    res.set("Content-Type", 'application/json');

    let invoiceid = new Date().valueOf().toString() + Math.random().toFixed(10).slice(2);

    // create unsigned tx for invoice
    let tx = new bsv.Transaction();
    
    dummyspec.forEach(function (value) {
        tx.to(value.address, value.amount);
    });

    // maybe good to sign this on the server
    // console.log([ invoiceid, info.tag + ':' + info.index, info.taghash, req.session.token ])
    tx.addSafeData([ invoiceid, taginfo.tag, taginfo.index, taginfo.taghash, req.message.sender ]);

    await db.payments.addInvoice({
        invoiceid,
        spec: JSON.stringify(dummyspec),
        created: new Date().toISOString(),
        userid: req.message.sender,
        amount: 10000,
        tag: taginfo.tag, 
        index: taginfo.index,
        invoicetx: tx.toString()
    });

    res.json({
        purpose: 'Access to tag:' + taginfo.tag + ' for one hour',
        taghash: taginfo,
        invoiceid,
        spec: dummyspec,
        tx: tx.toString()
    });
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

    // broadcast
    let broadcastRes = await axios.post(
        'https://www.ddpurse.com/openapi/mapi/tx', 
        { rawtx: signedTx.toString() }, 
        { headers: { 
            'token': '561b756d12572020ea9a104c3441b71790acbbce95a6ddbf7e0630971af9424b'
        }});

    let payload = JSON.parse(broadcastRes.data.payload);
    
    if (payload.returnResult === 'failure') {
        res.status(200).json({ error: 'INVALID_TRANSACTION', description: payload.resultDescription });
        return;
    }

    await db.payments.addAccess({ 
        invoiceid, 
        txid: signedTx.id, 
        userid: req.message.sender, 
        created: new Date().toISOString(), 
        tag: invoice.tag,
        index: invoice.index
    });

    res.status(200).end();
});



module.exports = {
    requirePayment,
    payInvoice
};