const moment = require('moment');
const bsv = require('bsv');
const crypto = require('crypto');

const MessageSender = require('./sendmessage.js');

let url = 'http://localhost:6767/';
let privkey = bsv.PrivateKey.fromString('L2BSmApVHCL51UBbxSZpF7EFnGbPGDBxZ3K3KLTsv71JkomSAa9x');

let sendMessage = MessageSender(url, privkey);

(async function () {
    try {

        let res = await Promise.all([
            sendMessage({
                timestamp: moment().toISOString(),
                sender: privkey.toAddress().toString(),
                tag: 'server1',
                messageid: crypto.randomBytes(16).toString('hex'),   
                subject: 'getaddress'
            }),
            sendMessage({
                timestamp: moment().toISOString(),
                sender: privkey.toAddress().toString(),
                tag: 'server2',
                messageid: crypto.randomBytes(16).toString('hex'),   
                subject: 'getaddress'
            }),
            sendMessage({
                timestamp: moment().toISOString(),
                sender: privkey.toAddress().toString(),
                tag: 'server3',
                messageid: crypto.randomBytes(16).toString('hex'),   
                subject: 'getaddress'
            }),
            sendMessage({
                timestamp: moment().toISOString(),
                sender: privkey.toAddress().toString(),
                tag: 'server4',
                messageid: crypto.randomBytes(16).toString('hex'),   
                subject: 'getaddress'
            })
        ]);

        res.forEach(function(res){
            console.log(res.statusCode, res.data)
        });
    } catch (err) {
        console.log('ttt', err.stack);
    }
})();



