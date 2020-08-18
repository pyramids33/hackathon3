const sqlite3 = require('better-sqlite3');
const bsv = require('bsv');
const moment = require('moment');
const CustomInput = require('./custominput.js');

// custom (file,amount)
//     ...maketx
//     if start
//         custom_insert (address,filename,filehash,pubkey,amount,status,rawtx,escrowtxid,resolvedtxid)
//
// escrow_custom (address,inputs)
//     addinputs(inputs)
//     
// solve_custom (address,file)
//     spendtx (escrowtx, file)
//
// process
//     custom = getcustom(output.pubkey)
//     if custom.status = 'pending'
//         transactions.insert (tx,'processed',escrowtx)
//         custom.status('escrowed',escrowtxid)
//     
//     custom = getcustom(status == 'escrowed' and escrowtxid)
//     if custom
//         transactions.insert (tx,'processed',spendtx)
//         custom.status('resolved',resolvetxid)
//
//
// customutxo
//     txid,vout,amount,pubkey,escrowtxid,resolvedtxid
//

function WalletDb (filename) {

    let db = new sqlite3(filename);
    db.pragma('journal_mode = WAL');
    process.on('exit', function () { db.close(); });

    function transaction (fn) {
        return db.transaction(fn)();
    }

    db.prepare('create table if not exists transactions (txid text, status text, rawtx blob)').run();
    db.prepare('create unique index if not exists transactions_txid on transactions(txid)').run();
    db.prepare('create index if not exists transactions_status on transactions(status)').run();

    db.prepare('create table if not exists hdkeys (id integer primary key, n integer, created text, xprv text)').run();
    db.prepare('create table if not exists addresses (address text primary key, hdkey int, n integer, created text)').run();

    db.prepare('create table if not exists utxos (txid text, vout integer, amount integer)').run();
    db.prepare('create unique index if not exists utxos_txid_vout on utxos(txid, vout)').run();

    db.prepare('create table if not exists stxos (txid text, vout integer, amount integer, spenttxid text)').run();
    db.prepare('create unique index if not exists stxos_txid_vout on stxos(txid, vout)').run();

    db.prepare('create table if not exists invoicetxns (txid text, invoiceid text, server text, notified text)').run();
    db.prepare('create unique index if not exists invoicetxns_txid on invoicetxns(txid)').run();
    db.prepare('create index if not exists invoicetxns_notified on invoicetxns(notified)').run();

    db.prepare(`
        create table if not exists customtx (
            address text primary key, pubkey text, filehash text, amount integer, status text, 
            escrowtxid text, resolvedtxid text, rawtx blob)`).run();

    db.prepare('create index if not exists customtx_status on customtx(status)').run();

    db.prepare(`
        create table if not exists rtxos (
            txid text, vout integer, amount integer, address text)`).run();

    db.prepare('create unique index if not exists rtxos_txid_vout on rtxos(txid, vout)').run();

    const psAddTransaction = db.prepare(`insert into transactions (txid, status, rawtx) values (?,?,?)`);
    const psUpdateTransactionStatus = db.prepare('update transactions set status = ? where txid = ?');
    const psTransactionById = db.prepare('select * from transactions where txid = ?');
    const psProcessedTransactions = db.prepare(`select txid from transactions where status = 'processed' order by rowid`);

    const psAddInvoiceTxn = db.prepare('insert into invoicetxns (txid,invoiceid,server) values (?,?,?)');
    const psInvoiceNotified = db.prepare('update invoicetxns set notified = ? where txid = ?');
    const psInvoiceTxnByTxid = db.prepare(`
        select invoicetxns.*,transactions.status 
        from invoicetxns 
            inner join transactions on invoicetxns.txid = transactions.txid 
        where invoicetxns.txid = ?`);

    const psInvoicesToNotify = db.prepare(`
        select invoicetxns.*,transactions.status 
        from invoicetxns 
            inner join transactions on invoicetxns.txid = transactions.txid `);
        // where transactions.status = 'broadcast' and invoicetxns.notified is null`);

    const psCurrentHDKey = db.prepare('select * from hdkeys order by id desc limit 1');
    const psHDKeyById = db.prepare('select * from hdkeys where id = ?');
    const psAddHDKey = db.prepare('insert into hdkeys (n,created,xprv) values (?,?,?);');
    const psNextIndex = db.prepare('update hdkeys set n = n + 1 where id = (select max(id) from hdkeys);');

    const psIsKnownAddress = db.prepare('select address from addresses where address = ?');
    const psAddAddress = db.prepare('insert into addresses (address, hdkey, n, created) values (?,?,?,?);');
    const psUtxoByTxidIndex = db.prepare('select * from utxos where txid = ? and vout = ?');
    const psAddressWithKey = db.prepare(`
        select addresses.*, hdkeys.xprv 
        from addresses 
            inner join hdkeys on addresses.hdkey = hdkeys.id
        where addresses.address = ?;`);

    const psAddUtxo = db.prepare('insert into utxos (txid, vout, amount) values (?, ?, ?)');
    const psNextUtxo = db.prepare('select rowid,* from utxos where rowid > ? order by rowid limit 1');
    const psDeleteUtxo = db.prepare('delete from utxos where txid = ? and vout = ?');
    const psAddStxo = db.prepare('insert into stxos (txid, vout, amount, spenttxid) values (?,?,?,?)');

    const psUtxosToSpendAmount = db.prepare(`
        select * from utxos 
        where rowid <= (
            select rowid
            from (select rowid, sum(amount) over (order by rowid) as sum1 from utxos) a
            where a.sum1 > ?
            order by rowid limit 1
        )`);

    const psTotalUnspent = db.prepare('select sum(amount) as totalAmount, count(rowid) as numUtxos from utxos');
    const psUtxos = db.prepare('select * from utxos order by rowid');

    const psAddCustom = db.prepare('insert into customtx (address,pubkey,filehash,amount,status,rawtx) values (?,?,?,?,?,?) on conflict do nothing');   
    const psAddRtxo = db.prepare(`insert into rtxos (txid, vout, amount, address) values (?,?,?,?)`); 
    const psDeleteRtxo = db.prepare('delete from rtxos where txid = ? and vout = ?');  
    const psReservedTxo = db.prepare(`
        select rtxos.*, customtx.status, customtx.escrowtxid, customtx.resolvedtxid
        from rtxos 
            left join customtx on rtxos.address = customtx.address 
        where txid = ? and vout = ?`);

    const psGetCustom = db.prepare(`select address,pubkey,filehash,amount,status,rawtx,escrowtxid from customtx where address = ?`);
    const psGetCustoms = db.prepare(`select * from customtx where status in ('pending','escrowed')`);
    
    const psGetCustomEscrow = db.prepare(`
        select address,pubkey,filehash,amount,status 
        from customtx 
        where status = 'escrowed' and escrowtxid = ?`);

    const psGetRtxos = db.prepare(`
        select rtxos.*, customtx.status, customtx.escrowtxid, customtx.resolvedtxid
        from rtxos 
            left join customtx on rtxos.address = customtx.address 
        where customtx.status in ('pending')`);

    const psCustomEscrowed = db.prepare(`
        update customtx set 
            status = 'escrowed', 
            escrowtxid = ? 
        where address = ?
    `);

    const psCustomSolved = db.prepare(`
        update customtx set 
            status = 'solved', 
            resolvedtxid = ? 
        where address = ?
    `);
    let cancelCustom = db.transaction(function () {
        // insert into utxos (txid,vout,amount) select txid,vout,amount from rtxos where address = ?
        // delete from rtxos where address = ?
        // delete from customtx where address = ?
    })

    function getHDKey (id) {
        if (id === undefined) {
            return psCurrentHDKey.get();
        } else {
            return psHDKeyById.get(id);
        }   
    }

    function addHDKey (xprv, created) {
        return psAddHDKey.run(0, created, xprv);
    }

    function nextIndex () {
        return transaction(function () {
            psNextIndex.run();
            return psCurrentHDKey.get();
        });
    }

    function isKnownAddress (address) {
        return (psIsKnownAddress.get(address) !== undefined);
    }

    function transactionById (txid) {
        return psTransactionById.get(txid);
    }

    function updateTransactionStatus (txid, status) {
        return psUpdateTransactionStatus.run(status, txid);
    }

    function processedTransactions () {
        return psProcessedTransactions.all();
    }

    function addAddress ({ address, hdkey, index, created }) {
        return psAddAddress.run(address, hdkey, index, created);
    }

    function getUtxo (txid, index) {
        return psUtxoByTxidIndex.get(txid, index);
    }

    function nextUtxo (previousRowId) {
        return psNextUtxo.get(previousRowId);
    }

    function getUtxosToSpendAmount (amount) {
        return psUtxosToSpendAmount.all(amount);
    }

    function getAddress (address) {
        let info = psAddressWithKey.get(address);
        info.hdKey = bsv.HDPrivateKey.fromString(info.xprv);
        info.privateKey = info.hdKey.deriveChild(info.n,true).privateKey;
        return info;
    }

    function totalUnspent () {
        return psTotalUnspent.get();
    }

    function listUtxos () {
        return psUtxos.all();
    }

    function setInvoiceNotified (txid) {
        return psInvoiceNotified.run(moment().toISOString(), txid);
    }

    function invoiceTxnById (txid) {
        return psInvoiceTxnByTxid.get(txid);
    }

    function invoicesToNotify () {
        return psInvoicesToNotify.all();
    }

    function identityKey () {
        let row = psCurrentHDKey.get();
        let xprv = bsv.HDPrivateKey.fromString(row.xprv);
        return xprv.deriveChild("m/44'/0'/0'/0/0/0").privateKey;
    }

    function addCustom ({ address, pubkey, filehash, amount, status, txbuf }) {
        status = status||'pending';
        return psAddCustom.run(address, pubkey, filehash, amount, status, txbuf);
    }

    function addRtxo ({ txid, vout, amount, address}) {
        return psAddRtxo.run(txid, vout, amount, address);
    }
    function deleteRtxo (txid, vout) {
        return psDeleteRtxo.run(txid, vout);
    }
    function reservedTxo (txid, vout) {
        return psReservedTxo.get(txid, vout);
    }
    function getCustom (address) {
        return psGetCustom.get(address);
    }
    function getCustoms () {
        return psGetCustoms.all();
    }
    function getCustomEscrow (txid) {
        return psGetCustomEscrow.get(txid);
    }
    function customEscrowed (address, escrowtxid) {
        return psCustomEscrowed.run(escrowtxid, address);
    }
    function customSolved (address, resolvedtxid) {
        return psCustomSolved.run(resolvedtxid, address);
    }
    function getRtxos () {
        return psGetRtxos.all();
    }

    let addTransaction = db.transaction(function(txhex, status, invoice) {
        
        status = status||'processed';

        let tx = new bsv.Transaction(txhex);

        tx.outputs.forEach(function (output, index) {

            let reserved = reservedTxo(tx.id, index);

            if (reserved !== undefined) {
                return;
            }

            if (output.script.isPublicKeyHashOut()
                && isKnownAddress(output.script.toAddress().toString())) { 
                psAddUtxo.run(tx.id, index, output.satoshis);
            }

            if (CustomInput.IsOutputScript(output.script)) {
                let publicKey = CustomInput.PublicKeyFromOutputScript(output.script);
                let custom = getCustom(publicKey.toAddress().toString('hex'));

                if (custom) {
                    customEscrowed(custom.address, tx.id);
                }
            }
        });

        tx.inputs.forEach(function (input, index) { 
            let custom = getCustomEscrow(input.prevTxId.toString('hex'));
            
            if (custom) {
                customSolved(custom.address, tx.id);
                return;
            }

            let utxo = getUtxo(input.prevTxId.toString('hex'), input.outputIndex);
            
            if (utxo) {
                psAddStxo.run(input.prevTxId.toString('hex'), input.outputIndex, utxo.amount, tx.id);
                psDeleteUtxo.run(input.prevTxId.toString('hex'), input.outputIndex);
            }
        });

        if (invoice) {
            psAddInvoiceTxn.run(tx.id, invoice.invoiceid, invoice.server);
        }

        psAddTransaction.run(tx.id, status, Buffer.from(txhex,'hex'));
    });

    function analyseTransaction (txhex) {
        let tx = new bsv.Transaction(txhex);

        let utxos = [];
        let stxos = [];
        let rtxos = [];
        let customs = [];

        let addedBalance = 0;
        let spentBalance = 0;
        let reservedBalance = 0;
        let customEscrowBalance = 0;

        tx.outputs.forEach(function (output, index) {

            let reserved = reservedTxo(tx.id, index);

            if (reserved !== undefined) {
                rtxos.push({ txid: tx.id, index, amount: output.satoshis, address: reserved.address });
                reservedBalance += output.satoshis;
                return;
            }

            if (output.script.isPublicKeyHashOut() && isKnownAddress(output.script.toAddress().toString())) {
                utxos.push({ txid: tx.id, index, amount: output.satoshis, type: 'PKH' });
                addedBalance += output.satoshis;
            }

            if (CustomInput.IsOutputScript(output.script)) {
                let publicKey = CustomInput.PublicKeyFromOutputScript(output.script);
                let address = publicKey.toAddress().toString('hex');
                let custom = getCustom(address);
                if (custom) {
                    customs.push({ txid: tx.id, index, amount: output.satoshis, address, status: 'escrowed' });
                    customEscrowBalance += output.satoshis;
                }
            }
        });

        tx.inputs.forEach(function (input, index) {
            let utxo = getUtxo(input.prevTxId.toString('hex'), input.outputIndex)
            if (utxo) {
                stxos.push(utxo);
                spentBalance += utxo.amount;
            }
            let custom = getCustomEscrow(input.prevTxId.toString('hex'));
            if (custom) {
                customs.push({ txid: tx.id, index, amount: custom.amount, pubkey: custom.pubkey, status: 'solved' });
            }
        });

        return {
            txid: tx.id, utxos, stxos, rtxos, customs, reservedBalance, addedBalance, spentBalance, customEscrowBalance
        }
    }

    function newAddress () {
        let index = nextIndex();
        let key = bsv.HDPrivateKey.fromString(index.xprv).deriveChild(index.n,true).privateKey;
        
        addAddress({ 
            address: key.toAddress().toString(), 
            hdkey: index.id, 
            index: index.n,
            created: moment().toISOString()
        });

        return key.toAddress().toString();
    }

    function send (addressAmounts, invoiceTx) {
            
        let tx = invoiceTx || new bsv.Transaction();

        addressAmounts.forEach(function (item) {
            tx.to(item[0], item[1]);
        });
        
        tx.change(newAddress());

        let rowid = 0;
        let keys = [];

        while (true) {
            let utxo = nextUtxo(rowid);

            if (utxo === undefined) {
                break;
            }

            rowid = utxo.rowid;

            let spendtx = new bsv.Transaction(transactionById(utxo.txid).rawtx);
            let output = spendtx.outputs[utxo.vout];
            
            let addressInfo = getAddress(output.script.toAddress().toString());
            let key = bsv.HDPrivateKey.fromString(addressInfo.xprv).deriveChild(addressInfo.n,true).privateKey;
            keys.push(key);

            tx.from({
                txid: utxo.txid,
                outputIndex: utxo.vout,
                address: output.script.toAddress().toString(), 
                satoshis: output.satoshis, 
                scriptPubKey: output.script
            });

            let changeOut = tx.getChangeOutput();
            changeOut = changeOut ? changeOut.satoshis : 0;

            while (changeOut > 9000) {
                let change2 = newAddress();
                tx.to(change2, Math.floor(changeOut/2));
                changeOut = tx.getChangeOutput();
                changeOut = changeOut ? changeOut.satoshis : 0;
            }

            //console.log(output.satoshis, tx.getFee(), tx.inputAmount, tx.outputAmount, tx.getFee()+tx.outputAmount, changeOut);
            
            if (tx.inputAmount >= tx.getFee()+tx.outputAmount) {
                break;
            }
        }
        
        tx.sign(keys);
        
        return tx;
    }
    
    return {
        db,
        transaction,
        addTransaction,
        analyseTransaction,
        transactionById,
        getHDKey,
        addHDKey,
        nextIndex,
        isKnownAddress,
        addAddress,
        getUtxo,
        getAddress,
        getUtxosToSpendAmount,
        nextUtxo,
        newAddress,
        send,
        updateTransactionStatus,
        processedTransactions,
        totalUnspent,
        listUtxos,
        identityKey,
        setInvoiceNotified,
        invoiceTxnById,
        invoicesToNotify,
        addCustom,
        addRtxo,
        getCustom,
        getCustoms,
        getCustomEscrow,
        getRtxos,
        customEscrowed,
        customSolved
    }
}

module.exports = WalletDb;
