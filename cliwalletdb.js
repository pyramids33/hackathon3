const sqlite3 = require('better-sqlite3');
const bsv = require('bsv');
const moment = require('moment');

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

    const psAddTransaction = db.prepare(`insert into transactions (txid, status, rawtx) values (?,?,?)`);
    const psUpdateTransactionStatus = db.prepare('update transactions set status = ? where txid = ?');
    const psTransactionById = db.prepare('select rawtx from transactions where txid = ?');
    const psProcessedTransactions = db.prepare(`select txid from transactions where status = 'processed' order by rowid`);

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
    const psAddStxo = db.prepare(`
        insert into stxos (txid, vout, amount, spenttxid) 
        select txid,vout,amount,? from utxos where txid = ? and vout = ?`);

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
        return psTransactionById.pluck().get(txid);
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
        return psAddressWithKey.get(address);
    }

    function totalUnspent () {
        return psTotalUnspent.get();
    }

    function listUtxos () {
        return psUtxos.all();
    }

    let addTransaction = db.transaction(function(txhex, status) {
        
        status = status||'processed';

        let tx = new bsv.Transaction(txhex);

        tx.outputs.forEach(function (output, index) {
            if (output.script.isPublicKeyHashOut() && isKnownAddress(output.script.toAddress().toString())) {
                psAddUtxo.run(tx.id, index, output.satoshis);
            }
        });

        tx.inputs.forEach(function (input, index) { 
            psAddStxo.run(tx.id, input.prevTxId.toString('hex'), input.outputIndex);
            psDeleteUtxo.run(input.prevTxId.toString('hex'), input.outputIndex);
        });
    
        psAddTransaction.run(tx.id, status, Buffer.from(txhex,'hex'));
    });

    function analyseTransaction (txhex) {
        let tx = new bsv.Transaction(txhex);

        let utxos = [];
        let stxos = [];

        let addedBalance = 0;
        let spentBalance = 0;

        tx.outputs.forEach(function (output, index) {
            if (output.script.isPublicKeyHashOut() && isKnownAddress(output.script.toAddress().toString())) {
                utxos.push({ txid: tx.id, index, amount: output.satoshis });
                addedBalance += output.satoshis;
            }
        });

        tx.inputs.forEach(function (input, index) {
            let utxo = getUtxo(input.prevTxId.toString('hex'), input.outputIndex)
            if (utxo) {
                stxos.push(utxo);
                spentBalance += utxo.amount;
            }
        });

        return {
            utxos, stxos, addedBalance, spentBalance
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

    function send (addressAmounts) {
            
        let tx = new bsv.Transaction();

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

            let spendtx = new bsv.Transaction(transactionById(utxo.txid));
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
                tx.to(change2, changeOut/2);
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
        listUtxos
    }
}

module.exports = WalletDb;
