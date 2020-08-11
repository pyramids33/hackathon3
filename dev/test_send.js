const bsv = require('bsv');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const MessageSender = require('../sendmessage.js');

let url = 'http://localhost:6767/';

if (process.argv.length < 3) {
    console.log('no data set');
    process.exit();
}

// test data is json object looking like this
// {
//     "idkey": "..",
//     "spendkeys": [
//         ["privkey","address"]
//     ],
//     "change": "change address",
//     "tx": "inputs txid, filenamed with txid in the same directory"
// }

let testdata = JSON.parse(fs.readFileSync(process.argv[2]));
let fundtx = fs.readFileSync(path.resolve(path.dirname(process.argv[2]), testdata.tx+'.hex')).toString();

let privkey = bsv.PrivateKey.fromString(testdata.idkey);

console.log(privkey.toAddress().toString());


let sendMessage = MessageSender(url, privkey);

(async function () {
    try {
        let res = await sendMessage({
            tag: 'api',
            subject: 'tagdata',
            query: {
                tag: 'api',
                from: 1
            }
        });

        console.log(res.statusCode, res.data);

        if (res.statusCode === 200) {
            return;
        }

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

        // send payment of invoice

        res = await sendMessage({
            tag: 'api',
            subject: 'payinvoice',
            invoiceid: invoiceid,
            paymenttx: paytx.toString(),
        });

        console.log(res.statusCode, res.data);

        if (res.data.error) {
            console.log(res.data);
            return;
        }

        res = await axios.post(
            'https://www.ddpurse.com/openapi/mapi/tx', 
            { rawtx: paytx.toString() }, 
            { headers: { 
                'token': '561b756d12572020ea9a104c3441b71790acbbce95a6ddbf7e0630971af9424b'
            }});

        let payload = JSON.parse(res.data.payload);

        console.log(payload);

        if (payload.returnResult === 'failure') {
            return;
        }

        // notify broadcast
        res = await sendMessage({
            tag: 'api',
            subject: 'notifybroadcast',
            invoiceid: invoiceid
        });

        console.log(res.statusCode, res.data);

    } catch (err) {
        console.log(err.stack);
    }
})();



