const moment = require('moment');
const axios = require('axios');
const fs = require('fs');
const commander = require('commander');
const bsv = require('bsv');
const os = require('os');
const path = require('path');

const MessageSender = require('./sendmessage.js');
const WalletDb = require('./cliwalletdb.js');

function loadWallet (dbfile) {
    if (!fs.existsSync(dbfile)) {
        console.log(`${dbfile} does not exist.`);
        process.exit();
    }
    
    return WalletDb(dbfile);
}


async function broadcastTx (db, txid) {

    let tx = db.transactionById(txid);

    if (tx.status === 'processed') {

        console.log('broadcast', txid);

        let res = await axios.post(
            'https://www.ddpurse.com/openapi/mapi/tx', 
            { rawtx: tx.rawtx.toString('hex') }, 
            { headers: { 
                'token': '561b756d12572020ea9a104c3441b71790acbbce95a6ddbf7e0630971af9424b'
            }});
 
        let payload = JSON.parse(res.data.payload);
        
        if (payload.returnResult === 'failure') {
            console.log(payload.returnResult, payload.resultDescription);
            if (payload.resultDescription === 'ERROR: Transaction already in the mempool' ||
                payload.resultDescription === 'ERROR: 257: txn-already-known') {
                db.updateTransactionStatus(txid, 'broadcast');
                return true;
            } else {
                db.updateTransactionStatus(txid, payload.resultDescription);
                return false;
            }
        } else {
            db.updateTransactionStatus(txid, 'broadcast');
            return true;
        }
    }
}

async function notifyBroadcast (db, txid, privkey) {

    let inv = db.invoiceTxnById(txid);

    if (inv && inv.server > '' && inv.notified === null && inv.status === 'broadcast') {

        console.log('notify', txid, inv);

        let sendMessage = MessageSender(inv.server, privkey);

        res = await sendMessage({
            tag: 'api',
            subject: 'notifybroadcast',
            invoiceid: inv.invoiceid
        });

        if (res.data && res.data.error) {
            console.log(res.statusCode, res.data);
            return;
        }

        db.setInvoiceNotified(txid);
    }
}

async function payInvoice (db, server, privkey, data) {
    let invdata = JSON.parse(JSON.parse(data).payload);
    let invoiceid = invdata.invoiceid;
    let invoiceTx = new bsv.Transaction(invdata.tx);

    let tx = db.send([], invoiceTx);
    let txhex = tx.toString();
    let txid = tx.id;

    let sendMessage = MessageSender(server, privkey); 

    res = await sendMessage({
        tag: 'api',
        subject: 'payinvoice',
        invoiceid: invoiceid,
        paymenttx: txhex,
    });

    console.log(res.statusCode, res.data);

    if (res.data.error) {
        console.log(res.data);
        return;
    }

    db.addTransaction(txhex, 'processed', { invoiceid, server });

    await broadcastTx(db, txid);
    await notifyBroadcast(db, txid, privkey);
}

try { fs.mkdirSync(path.resolve(os.homedir(), 'tx')); } catch (err) { }

const program = new commander.Command();
program.version('1.0.0');
program.option('-t --target <path>', 'target database', './wallet.db')

program.command('init')
    .description('create a new wallet file')
    .action (async (cmd) => {
        let dbfile = cmd.parent.target;

        if (fs.existsSync(dbfile)) {
            console.log(`${dbfile} already exists.`);
            process.exit();
        }

        let db = WalletDb(dbfile);
        let hdkey = db.getHDKey();
        
        if (hdkey === undefined) {
            let newKey = bsv.HDPrivateKey.fromRandom();
            db.addHDKey(newKey.toString(), moment().toISOString());
        }
    });

program.command('balance')
    .description('show balance')
    .action (async (cmd) => {
        let db = loadWallet(cmd.parent.target);
        let totals = db.totalUnspent();
        console.log(totals);
        let list = db.listUtxos();
        console.table(list);
    });

program.command('receive')
    .description('generates address to receive funds')
    .action (async (cmd) => {
        let db = loadWallet(cmd.parent.target);
        let address = db.newAddress();
        console.log(address);
    });

program.command('send <to> <amount>')
    .description('create a transaction to send money')
    .option('-a, --analyse', 'show changes')
    .option('-p, --process', 'update the wallet with the tx')
    .action (async (to,amount,cmd) => {
        let db = loadWallet(cmd.parent.target);
        let tx = db.send([[to, amount]]);
        let txhex = tx.toString();
        console.log(txhex);
        
        if (cmd.analyse) {
            let res = db.analyseTransaction(txhex);
            console.log(res);
        }

        if (cmd.process) {
            db.addTransaction(txhex);
        }

        if (cmd.broadcast) {
            await broadcastTx(db, tx.id);
        }
    });


program.command('broadcast')
    .description('broadcast processed transactions')
    .option('-l, --list', 'list the transactions, dont broadcast them')
    .action (async (cmd) => {
        let db = loadWallet(cmd.parent.target);
        let txns = db.processedTransactions();
        
        if (cmd.list) {
            console.table(txns);
            return;
        }

        for (let i = 0; i < txns.length; i++) {
            await broadcastTx(db,txns[i].txid);
        }
    });

program.command('notifyinvoices')
    .description('notify invoice payments')
    .option('-l, --list', 'list the invoices, dont notify')
    .action (async (cmd) => {

        let db = loadWallet(cmd.parent.target);
        let privkey = db.identityKey();
        let txns = db.invoicesToNotify();
        
        if (cmd.list) {
            console.table(txns);
            return;
        }

        for (let i = 0; i < txns.length; i++) {
            await notifyBroadcast(db, txns[i].txid, privkey);
        }
    });

program.command('download <txid>')
    .description('download a transaction with txid. it is cached in the home directory.')
    .option('-a, --analyse', 'show changes')
    .option('-p, --process', 'update the wallet with the tx')
    .action (async (txid, cmd) => {

        let db = loadWallet(cmd.parent.target);
        let txfile = path.resolve(os.homedir(), 'tx', txid);

        if (!fs.existsSync(txfile)) {
            let res = await axios.get('https://api.whatsonchain.com/v1/bsv/main/tx/'+txid+'/hex');
            fs.writeFileSync(txfile, Buffer.from(res.data,'hex'));
        }

        let txhex = fs.readFileSync(txfile).toString('hex');

        if (cmd.analyse) {
            let res = db.analyseTransaction(txhex);
            console.log(res);
        }

        if (cmd.process) {
            db.addTransaction(txhex, 'broadcast');
        }
    });

program.command('taginfo <server> <tag>')
    .description('get tag info')
    .action(async (server, tag, cmd) => {
        let db = loadWallet(cmd.parent.target);
        let privkey = db.identityKey();
        let sendMessage = MessageSender(server, privkey);

        let res = await sendMessage({
            tag: 'api',
            subject: 'taginfo',
            query: { tag }
        });

        console.log(JSON.parse(res.data));
    });

program.command('tagdata <server> <tag> [from]')
    .description('download data')
    .option('-p, --pay', 'pay 402 response automatically')
    .action(async (server, tag, from, cmd) => {

        from = parseInt(from)||1;

        let db = loadWallet(cmd.parent.target);
        let privkey = db.identityKey();
        let sendMessage = MessageSender(server, privkey);

        let res = await sendMessage({
            tag: 'api',
            subject: 'tagdata',
            query: {
                tag: tag,
                from: from
            }
        });

        if (res.statusCode === 200) {
            console.log(res.data);
            return;
        }

        if (res.statusCode !== 402) {
            console.log(res.statusCode, res.data);
            return;
        }

        if (!cmd.pay) {
            console.log(res.data);
            return;
        }

        await payInvoice(db, server, privkey, res.data);

        res = await sendMessage({
            tag: 'api',
            subject: 'tagdata',
            query: {
                tag: tag,
                from: from
            }
        });

        if (res.statusCode === 200) {
            console.log(res.data);
        } else {
            console.log(res.statusCode, res.data);
        }

    });

program.command('getattachment <server> <tag> <index> <savepath>')
    .description('download message attachment')
    .option('-p, --pay', 'pay 402 response automatically')
    .action(async (server, tag, index, savepath, cmd) => {

        let db = loadWallet(cmd.parent.target);
        let privkey = db.identityKey();
        let sendMessage = MessageSender(server, privkey);

        let ws = fs.createWriteStream(savepath);

        let res = await sendMessage({
            tag: 'api',
            subject: 'getattachment',
            query: {
                tag: tag,
                index: index
            }
        }, null, null, null, true);

        if (res.headers['content-type'] === 'application/octet-stream') {
            await res.writeDataToStream(ws);
            console.log('saved to', savepath);
        } else {
            await res.getDataAsString();
        }

        if (res.statusCode === 200) {
            console.log(res.statusCode, res.data);
            return;
        }

        if (res.statusCode !== 402) {
            console.log(res.statusCode, res.data);
            return;
        }

        if (!cmd.pay) {
            console.log(res.data);
            return;
        }

        await payInvoice(db, server, privkey, res.data);

        res = await sendMessage({
            tag: 'api',
            subject: 'getattachment',
            query: {
                tag: tag,
                index: index
            }
        }, null, null, null, true);

        if (res.headers['content-type'] === 'application/octet-stream') {
            await res.writeDataToStream(ws);
            console.log('saved to', savepath);
        } else {
            await res.getDataAsString();
        }

    });

program.parseAsync(process.argv)
    .catch(function (error) {
        console.log(error);
    });
    