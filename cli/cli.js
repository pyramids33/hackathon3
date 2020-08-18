const moment = require('moment');
const axios = require('axios');
const fs = require('fs');
const commander = require('commander');
const bsv = require('bsv');
const bsvMessage = require('bsv/message');
const os = require('os');
const path = require('path');
const readline = require('readline');  
const crypto = require('crypto');

const hashFile = require('../hashfile.js');
const MessageSender = require('../sendmessage.js');
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

        console.log('notifybroadcast', txid, inv);

        let sendMessage = MessageSender(inv.server, privkey);

        let res = await sendMessage({
            tag: 'api',
            subject: 'notifybroadcast',
            invoiceid: inv.invoiceid
        });

        if (res.statusCode !== 200 || res.json === undefined) {
            console.log(res.data);
            return;
        }
    
        if (res.json.error && res.json.error !== 'INVOICE_DONE') {
            console.log('notifybroadcast', res.json);
            return;
        }

        db.setInvoiceNotified(txid);
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

program.command('identity')
    .description('show identity')
    .action (async (cmd) => {
        let db = loadWallet(cmd.parent.target);
        let privkey = db.identityKey();
        console.log(privkey.toAddress().toString());
    });

program.command('balance')
    .description('show balance')
    .action (async (cmd) => {
        let db = loadWallet(cmd.parent.target);
        let totals = db.totalUnspent();
        let list = db.listUtxos();
        let customs = db.getCustoms();
        let rtxos = db.getRtxos();

        totals = {
            utxos: totals.totalAmount
        };
        
        customs.forEach(function (item, index) {
            //console.log(item);
            let publicKey = bsv.PublicKey.fromString(item.pubkey,'hex');

            if (db.isKnownAddress(publicKey.toAddress().toString())) {
                totals.customs = {};
                totals.customs.pending = totals.customs.pending||0;
                totals.customs.escrow = totals.customs.escrow||0;
                
                if (item.status == 'pending') {
                    totals.customs.pending += item.amount;
                }

                if (item.status === 'escrowed') {
                    totals.customs.escrow += item.amount;
                }
            }
        });

        rtxos.forEach(function (item,index) {
            totals.rtxos = totals.rtxos||0;
            totals.rtxos += item.amount;
        });

        console.log('utxos:', totals.utxos);
        console.table(list);
        console.log('rtxos:', totals.rtxos);
        console.table(rtxos.map(function (item) {
            return {
                txid: item.txid,
                vout: item.vout,
                amount: item.amount,
                address: item.address,
                status: item.status
            };
        }));
        console.log('customs:');
        customs.forEach(function (item) {
            console.log({
                address: item.address + ' ' + item.pubkey + '',
                amount: item.amount,
                filehash: item.filehash,
                status: item.status,
                escrowtxid: item.escrowtxid||null,
                resolvedtxid: item.resolvedtxid||null
            });
        });
        //console.table(customs);

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
        
        amount = parseInt(amount)||0;
        
        if (amount === 0) {
            console.log('invalid amount');
            return;
        }

        let db = loadWallet(cmd.parent.target);
        let tx = db.send([[to, amount]]);

        console.log('in:', tx.inputAmount, 'out:', tx.outputAmount, 'fee:', tx.getFee());

        if (tx.inputAmount < tx.outputAmount+tx.getFee()) {
            console.log('error: not enough funds. max send is ' + (tx.outputAmount-tx.getFee()).toString());
            return;
        }

        let txhex = tx.toString();
        console.log(txhex);
        
        if (cmd.analyse) {
            let res = db.analyseTransaction(txhex);
            console.log(res);
        }

        if (cmd.process) {
            db.addTransaction(txhex);
            console.log('tx processed. now run the broadcast command');
        }

        //if (cmd.broadcast) {
        //    await broadcastTx(db, tx.id);
        //}
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
            try {
                await broadcastTx(db, txns[i].txid);
            } catch(error) {
                console.log(error);
            }
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
            try {
                await notifyBroadcast(db, txns[i].txid, privkey);
            } catch(error) {
                console.log(error);
            }
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

        console.log(res.data);
    });

function confirmPayment () {
    return new Promise(function (resolve, reject) {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
          
        rl.question('Pay Invoice? (y/n) ', function (answer) {
            resolve(answer);
            rl.close();
        });
    });
}

program.command('buyaccess <server> <tag>')
    .description('pay for access to tag')
    .option("-p --pay", "pay automatically")
    .action(async (server, tag, cmd) => {
        let db = loadWallet(cmd.parent.target);
        let privkey = db.identityKey();
        let sendMessage = MessageSender(server, privkey);

        let res = await sendMessage({
            tag: 'api',
            subject: 'getinvoice',
            query: { tag }
        });

        if (res.statusCode !== 200 || res.json === undefined || res.json.error) {
            console.log(res.data);
            return;
        }
    
        let invdata = JSON.parse(res.json.payload);
        let invoiceid = invdata.invoiceid;
        let invoiceTx = new bsv.Transaction(invdata.tx);
        let txcost = invoiceTx.outputAmount;

        let tx = db.send([], invoiceTx);

        console.log({
            purpose: invdata.purpose,
            taginfo: invdata.taghash,
            invoiceid: invoiceid,
            txcost: txcost + invoiceTx.getFee()
        });

        if (cmd.pay === undefined) {
            let pay = await confirmPayment();
            if (!pay.toLowerCase().startsWith('y')) {
                return;
            }
        }

        let txhex = tx.toString();
        let txid = tx.id;
    
        console.log('payinvoice', txid, invoiceid);
    
        res = await sendMessage({
            tag: 'api',
            subject: 'payinvoice',
            invoiceid: invoiceid,
            paymenttx: txhex,
        });
    
        if (res.statusCode !== 200 || res.json === undefined || res.json.error) {
            console.log(res.data);
            return;
        }

        db.addTransaction(txhex, 'processed', { invoiceid, server });
    
        await broadcastTx(db, txid);
        await notifyBroadcast(db, txid, privkey);
    });

program.command('tagdata <server> <tag> <from> <savepath>')
    .description('download data')
    .action(async (server, tag, from, savepath, cmd) => {

        from = parseInt(from)||1;

        let db = loadWallet(cmd.parent.target);
        let privkey = db.identityKey();
        let sendMessage = MessageSender(server, privkey);

        let ws = fs.createWriteStream(savepath);

        let res = await sendMessage({
            tag: 'api',
            subject: 'tagdata',
            query: {
                tag: tag,
                from: from
            }
        }, null, null, null, true);

        if (res.statusCode === 200 && res.headers['content-type'] === 'application/octet-stream') {
            await res.writeDataToStream(ws);
            console.log('saved to', savepath);
            return;
        } 

        await res.getDataAsString();
        console.log(res.data);
    });

program.command('getattachment <server> <tag> <index> <savepath>')
    .description('download message attachment')
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

        if (res.statusCode === 200 && res.headers['content-type'] === 'application/octet-stream') {
            await res.writeDataToStream(ws);
            console.log('saved to', savepath);
            return;
        } 
        
        await res.getDataAsString();
        console.log(res.data);
    });



program.command('sendmessage <server> <jsonfile> [attachment]')
    .description('send a message')
    .action(async (server, jsonfile, attachment, cmd) => {
        let db = loadWallet(cmd.parent.target);
        let privkey = db.identityKey();
        let sendMessage = MessageSender(server, privkey);
        
        let obj = JSON.parse(fs.readFileSync(jsonfile));

        if (!obj.tag || !obj.subject) {
            console.log('Missing tag or subject');
            return;
        }

        let fileStream; 

        if (attachment) {
            obj.filehash = await hashFile('sha256', attachment, 'hex');
            obj.filename = path.basename(attachment);

            fileStream = fs.createReadStream(attachment);
        }

        function progress (bytesWritten, done) {
            console.log('uploaded ', bytesWritten, ' bytes');
        }

        let res = await sendMessage(obj, fileStream, progress, 3000);
        console.log(res.data);
    });



program.command('displaymessages <nldjsonfile>')
    .description('print out messages from a saved NLD json file')
    .action(async (nldjsonfile, cmd) => {
        
        const rl = readline.createInterface({
            input: fs.createReadStream(nldjsonfile),
            output: process.stdout,
            terminal: false
        });

        let taghash;

        rl.on('line', function (line) {
            let lineArray = JSON.parse(line);
            
            let lineObj = {
                tag: lineArray[1],
                index: lineArray[2],
                taghash: lineArray[6],
                sig: lineArray[7]
            };

            let msgbuf = Buffer.from(lineArray[8],'hex');
            
            lineObj.messageObj = JSON.parse(msgbuf.toString('utf-8'));
            
            //
            // Check Hash and Signature of Message
            // TagHash = sha256(TagHash + MsgHash)
            //

            let msghash = crypto.createHash('sha256');
            msghash.update(msgbuf);
            msghash = msghash.digest('hex');
            
            if (taghash) {
                let hash = crypto.createHash('sha256');
                hash.update(Buffer.from(taghash, 'hex'));
                hash.update(Buffer.from(msghash, 'hex'));
                taghash = hash.digest('hex');    
            } else {
                taghash = msghash;
            }

            lineObj.hashCheck = taghash;
            lineObj.hashCheckResult = taghash === lineObj.taghash ? 'OK' : 'FAILED';
            
            let base64sig = Buffer.from(lineArray[7],'hex').toString('base64');
            let validSig = new bsvMessage(msgbuf).verify(lineObj.messageObj.sender, base64sig);
            
            lineObj.sigCheck = validSig;

            console.log(lineObj);
        });

    });


program.command('transaction')
    .description('import a transaction')
    .option('-f, --file <filepath>', 'from file')
    .option('-d, --download <txid>', 'download transaction')
    .option('-a, --analyse', 'show changes')
    .option('-h, --hex', 'show hex')
    .option('-p, --process', 'update the wallet with the tx')
    .action (async (cmd) => {

        let db = loadWallet(cmd.parent.target);

        let txfile;
        let status = 'processed';

        if (cmd.file) {
            txfile = cmd.file;
        } else if (cmd.download) {
            let txid = cmd.download;
            txfile = path.resolve(os.homedir(), 'tx', txid);
            
            if (!fs.existsSync(txfile)) {
                let res = await axios.get('https://api.whatsonchain.com/v1/bsv/main/tx/'+txid+'/hex');
                fs.writeFileSync(txfile, Buffer.from(res.data,'hex'));
            }
            status = 'broadcast';
        }

        let txhex = fs.readFileSync(txfile).toString('hex');

        if (cmd.analyse) {
            let res = db.analyseTransaction(txhex);
            console.log(res);
        }

        if (cmd.hex) {
            console.log(txhex);
        }

        if (cmd.process) {
            db.addTransaction(txhex, status);
        }
    });  


const Output = bsv.Transaction.Output;
const CustomInput = require('./custominput.js');
const Signature = bsv.crypto.Signature;

program.command('custom_start <filepath> <amount>')
    .option('-s, --save', 'save the transaction to resolve later')
    .option('-f, --file <filepath>', 'write to file')
    .description('start a custom output for file')
    .action(async (filepath, amount, cmd) => {
        let db = loadWallet(cmd.parent.target);

        amount = parseInt(amount)||0;
        
        if (amount === 0) {
            console.log('invalid amount');
            return;
        }

        let filehash = await hashFile('sha256', filepath, 'hex');

        let address = db.newAddress();
        let info = db.getAddress(address);
        let pubkey = info.privateKey.publicKey;
        let tx = new bsv.Transaction();

        var script = CustomInput.BuildOutputScript(
            Buffer.from(filehash,'hex'), pubkey.toBuffer());

        let output = new Output({ script, satoshis: amount });

        tx.addOutput(output);

        if (cmd.save) {
            db.addCustom({ address: pubkey.toAddress().toString(), pubkey: pubkey.toString(), filehash, amount, txbuf: tx.toBuffer() });
            console.log('custom added', pubkey.toAddress().toString());
        } 

        if (cmd.file) {
            fs.writeFileSync(cmd.file, tx.toBuffer());
            console.log('saved to', cmd.file);
        } else {
            console.log(tx.toString());
        }
        
    });

program.command('custom_fund <txpath> <amount> [savetx] [saveinput] ')
    .option('-s, --save', 'save the transaction to resolve later')
    .description('fund a signed input for a custom transaction')
    .action(async (txpath, amount, savetx, saveinput, cmd) => {
        let db = loadWallet(cmd.parent.target);

        amount = parseInt(amount)||0;

        if (amount === 0 ) {
            console.log('invalid amount');
            return;
        }
        
        let address = db.newAddress();
        let info = db.getAddress(address);

        let fundtx = db.send([[address, amount]]);
        let txbuf = fs.readFileSync(txpath);
        let hashtx = new bsv.Transaction(txbuf);

        hashtx.addInput(new bsv.Transaction.Input.PublicKeyHash({
            output: fundtx.outputs[0],
            prevTxId: fundtx.id,
            outputIndex: 0,
            script: bsv.Script.empty()
        }));

        hashtx.sign(info.privateKey, (Signature.SIGHASH_ALL | Signature.SIGHASH_ANYONECANPAY | Signature.SIGHASH_FORKID));

        if (cmd.save) {
            let pubkey = CustomInput.PublicKeyFromOutputScript(hashtx.outputs[0].script).toString('hex');
            let filehash = CustomInput.Hash256FromOutputScript(hashtx.outputs[0].script).toString('hex');
            let address = new bsv.PublicKey.fromString(pubkey,'hex').toAddress().toString();
            
            db.transaction(function () {
                db.addCustom({ address, pubkey, filehash, amount: hashtx.outputs[0].satoshis, txbuf });
                db.addRtxo({ txid: fundtx.id, vout: 0, amount, address });
            });
        }

        if (savetx) {
            fs.writeFileSync(savetx, fundtx.toBuffer());
            console.log('saved to ', savetx);
        } else {
            console.log(fundtx.toString());
        }

        if (saveinput) {
            fs.writeFileSync(saveinput, JSON.stringify(hashtx.inputs[0]));
            console.log('saved to ', saveinput);
        } else {
            console.log(hashtx.inputs[0].toBufferWriter().toBuffer().toString());
        }
    });

program.command('custom_escrow <address> ')
    .option('-i, --inputs <inputs...>','transaction inputs')
    .option('-s, --savetx <filepath>','savetx')
    .description('escrow the funds into the custom output')
    .action(async (address, cmd) => {

        let db = loadWallet(cmd.parent.target);
        let info = db.getCustom(address);
        let tx = new bsv.Transaction(info.rawtx);

        cmd.inputs.forEach(function (item, index) {
            let obj = JSON.parse(fs.readFileSync(item).toString());
            //console.log(obj);
            let input = new bsv.Transaction.Input.PublicKeyHash(obj);
            tx.addInput(input);
        });

        // let interp = new bsv.Script.Interpreter();
        // let result = interp.verify(tx.inputs[0].script, tx.inputs[0].output.script, tx, 0, 
        //     bsv.Script.Interpreter.SCRIPT_ENABLE_SIGHASH_FORKID,
        //     new bsv.crypto.BN(tx.inputs[0].output.satoshis));

        //  console.log(result, interp.errstr);    

        if (cmd.savetx) {
            fs.writeFileSync(cmd.savetx, tx.toBuffer());
            console.log('saved to ', cmd.savetx);
        } else {
            console.log(tx.toString());
        }
    });

program.command('custom_solve <address> <filepath>')
    .option('-s, --savetx <filepath>','savetx')
    .description('solve the custom transaction')
    .action(async (address, filepath, cmd) => {
        let db = loadWallet(cmd.parent.target);

        let info = db.getCustom(address);
        let tx = new bsv.Transaction(info.rawtx);

        let addrInfo = db.getAddress(info.address);
        let changeAddress = db.newAddress();

        let tx2 = new bsv.Transaction();

        let input = new CustomInput({
            output: tx.outputs[0],
            prevTxId: info.escrowtxid,
            outputIndex: 0,
            script: bsv.Script.empty()
        });

        input.filebuf = fs.readFileSync(filepath);
        input.filehash = await hashFile('sha256', filepath, 'hex');

        tx2.addInput(input);
        tx2.change(changeAddress);
        tx2.sign(addrInfo.privateKey);

        console.log(tx2.inputAmount, tx2.outputAmount, tx2.getFee());

        if (cmd.savetx) {
            fs.writeFileSync(cmd.savetx, tx2.toBuffer());
            console.log('saved to ', cmd.savetx);
        } else {
            console.log(tx2.toString());
        }
    });


module.exports = program;