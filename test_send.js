const moment = require('moment');
const bsv = require('bsv');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const MessageSender = require('./sendmessage.js');

let url = 'http://localhost:6767/';

if (process.argv.length < 3) {
    console.log('no data set');
    process.exit();
}

let testdata = JSON.parse(fs.readFileSync(process.argv[2]));
let fundtx = fs.readFileSync(path.resolve(path.dirname(process.argv[2]), testdata.tx+'.hex')).toString();

let privkey = bsv.PrivateKey.fromString(testdata.idkey);

console.log(privkey.toAddress().toString());


let sendMessage = MessageSender(url, privkey);

(async function () {
    try {
        let res = await sendMessage({
            timestamp: moment().toISOString(),
            sender: privkey.toAddress().toString(),
            tag: 'api',
            subject: 'tagdata',
            query: {
                tag: 'forms',
                from: 1
            },
            messageid: crypto.randomBytes(16).toString('hex')
        });

        console.log(res.statusCode, res.data);

        let data = JSON.parse(res.data);
        let invoiceid = data.invoiceid;

        let paytx = new bsv.Transaction(data.tx);
        let spendtx = new bsv.Transaction(fundtx);

        spendtx.outputs.forEach(function (output, index) {
            if (output.script.isPublicKeyHashOut() && testdata.spendkeys[0][1] === output.script.toAddress().toString()) {
                paytx.from({ 
                    txid: spendtx.id,
                    outputIndex: index, 
                    address: output.script.toAddress().toString(), 
                    satoshis: output.satoshis, 
                    scriptPubKey: output.script
                });
            }
        });

        paytx.change(testdata.change);
        paytx.sign(testdata.spendkeys[0][0]);

        console.log('fee', paytx.getFee());
        console.log('size', paytx.toBuffer().length);
        console.log('signed', paytx.verify());
        console.log(paytx.toString());

        res = await sendMessage({
            timestamp: moment().toISOString(),
            sender: privkey.toAddress().toString(),
            tag: 'api',
            subject: 'payinvoice',
            invoiceid: invoiceid,
            paymenttx: paytx.toString(),
            messageid: new Date().valueOf().toString() + Math.random().toFixed(10).slice(2)
        });

        console.log(res.statusCode, res.data);

    } catch (err) {
        console.log('ttt', err.stack);
    }
})();



