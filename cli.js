const moment = require('moment');
const axios = require('axios');
const fs = require('fs');
const commander = require('commander');
const bsv = require('bsv');
const os = require('os');
const path = require('path');

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

    if (tx.status = 'processed') {

        let res = await axios.post(
            'https://www.ddpurse.com/openapi/mapi/tx', 
            { rawtx: tx.toString() }, 
            { headers: { 
                'token': '561b756d12572020ea9a104c3441b71790acbbce95a6ddbf7e0630971af9424b'
            }});

        let payload = JSON.parse(res.data.payload);
        
        if (payload.returnResult === 'failure') {
            console.log(payload.resultDescription);
            return;
        }

        db.updateTxStatus(tx.id, 'broadcast');
    }
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


program.command('broadcast ')
    .description('broadcast processed transactions')
    .option('-l, --list', 'list the transactions, dont broadcast them')
    .action (async (cmd) => {

        let txns = db.processedTransactions();
        
        if (cmd.list) {
            console.table(txns);
            return;
        }

        for (let i = 0; i < txns.length; i++) {
            await broadcastTx(db,txns[i]);
        }
    });

program.command('download <txid>')
    .description('download a transaction with txid. it will be cached in home directory before added to the db.')
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

program.parseAsync(process.argv)
    .catch(function (error) {
        console.log(error);
    });
    