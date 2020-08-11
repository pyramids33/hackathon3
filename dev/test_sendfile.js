const bsv = require('bsv');
const fs = require('fs');
const MessageSender = require('../sendmessage.js');
const hashFile = require('../hashfile.js');

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
let privkey = bsv.PrivateKey.fromString(testdata.idkey);
console.log(privkey.toAddress().toString());

let sendMessage = MessageSender(url, privkey);

(async function () {
    try {
        let hash = await hashFile('sha256', '../sysarch.jpg');
        let stream = fs.createReadStream('../sysarch.jpg');
        
        let res = await sendMessage({
            tag: 'testtag',
            subject: 'testattach',
            filename: 'sysarch.jpg',
            hash
        }, stream);

        console.log(res.statusCode, res.data);

    } catch (err) {
        console.log(err.stack);
    }
})();



