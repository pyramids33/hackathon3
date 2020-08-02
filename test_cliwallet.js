const bsv = require('bsv');
const moment = require('moment');
const sqlite3 = require('better-sqlite3');
const axios = require('axios');
const fs = require('fs');
const config = require('./config.js');

if (process.argv.length > 2) {
    Object.assign(config, JSON.parse(fs.readFileSync(process.argv[2])));
}

console.log('env', process.env.NODE_ENV||'dev');
console.log('config', process.argv[2]||'default');

function WalletDb (filename) {

    let db = new sqlite3(filename);
    db.pragma('journal_mode = WAL');
    process.on('exit', function () { db.close(); });

    function transaction (fn) {
        return db.transaction(fn)();
    }

    db.prepare('create table if not exists transactions (txid text primary key, rawtx blob)').run();
    db.prepare('create table if not exists hdkeys (id integer primary key, n integer, created text, xprv text)').run();
    db.prepare('create table if not exists addresses (address text primary key, hdkey int, n integer, created text)').run();

    db.prepare('create table if not exists utxos (txid text, vout integer, amount integer)').run();
    db.prepare('create unique index if not exists utxos_txid_vout on utxos(txid, vout)').run();

    db.prepare('create table if not exists stxos (txid text, vout integer, amount integer, spenttxid text)').run();
    db.prepare('create unique index if not exists stxos_txid_vout on stxos(txid, vout)').run();

    const psAddTransaction = db.prepare('insert into transactions (txid, rawtx) values (?,?)');
    const psTransactionById = db.prepare('select rawtx from transactions where txid = ?');

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

    let addTransaction = db.transaction(function(txhex) {
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
    
        psAddTransaction.run(tx.id, Buffer.from(txhex,'hex'));
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
        nextUtxo
    }
}



(async function () {
    try {
        let dbfile = './test_data/test_wallet.db';
        fs.unlinkSync(dbfile);

        let db = WalletDb(dbfile);
        

        let hdkey = db.getHDKey();
        
        if (hdkey === undefined) {
            //let newKey = bsv.HDPrivateKey.fromRandom();
            let newKey = bsv.HDPrivateKey.fromString('xprv9s21ZrQH143K4HcStkRBGjoL44SQpoTZUqa37PdtMmWrfwzbPWaDvkmiYg99qxusA5xyjJ7N6N3KXRuRkNFYafSx3VNM3dmKznYqkp7Ekau');
            db.addHDKey(newKey.toString(), moment().toISOString());
            hdkey = db.getHDKey();
        }

        function newAddress () {
            let nextIndex = db.nextIndex();
            let nextKey = bsv.HDPrivateKey.fromString(nextIndex.xprv).deriveChild(nextIndex.n,true).privateKey;
            
            db.addAddress({ 
                address: nextKey.toAddress().toString(), 
                hdkey: nextIndex.id, 
                index: nextIndex.n,
                created: moment().toISOString()
            });

            return nextKey.toAddress().toString();
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
                let utxo = db.nextUtxo(rowid);

                if (utxo === undefined) {
                    break;
                }

                rowid = utxo.rowid;

                let spendtx = new bsv.Transaction(db.transactionById(utxo.txid));
                let output = spendtx.outputs[utxo.vout];
                
                let addressInfo = db.getAddress(output.script.toAddress().toString());
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
                
                if (tx.inputAmount === tx.getFee()+tx.outputAmount) {
                    break;
                }
            }

            tx.sign(keys);

            return tx;
        }

        //let txid = 'a40d6f7521e5e74a2afec7ff6185ef416ecb0aa9f4cabfb0621e84bc4fe1644f';
        //let res = await axios.get('https://api.whatsonchain.com/v1/bsv/main/tx/'+txid+'/hex');
        //let txinfo = db.analyseTransaction(res.data);
        //console.log(txinfo);

        let a1 = newAddress();
        let a2 = newAddress();
        let a3 = newAddress();
        let a4 = newAddress();
        let a5 = newAddress();

        console.log(a1);
        console.log(a2);
        console.log(a3);
        console.log(a4);
        console.log(a5);

        let txids = [
            '6e62335cc5a4b40c8d65f07245e315e4d120bc3e55a6e34b8ef9c0de7d51ff44',
            '6769ad06305875bc7ba655e751801ba76c70dba48900ee87d19c86b33ced95b5',
            '5db3d4e6503a46d13326c7c257a158e3906d9dc540732923851682013a14d85a'
        ];
        
        for (let i = 0; i < txids.length; i++) {
            let txid = txids[i];
            let txfile = './test_data/'+txid;

            if (!fs.existsSync(txfile)) {
                let res = await axios.get('https://api.whatsonchain.com/v1/bsv/main/tx/'+txid+'/hex');
                fs.writeFileSync(txfile, Buffer.from(res.data,'hex'));
            }

            let txhex = fs.readFileSync(txfile).toString('hex');
            db.addTransaction(txhex);
        }

        let sendtx = send([[a5,14999]]);


        db.addTransaction(sendtx.toString());


        console.table(db.db.prepare('select txid from transactions').all());
        console.table(db.db.prepare('select * from utxos').all());

        let sendtx2 = send([['176MStNg63XY9pxeJjqAMDXvmdtnnQVU9', 37922]]);
        
        console.log(sendtx2.getFee(), sendtx2.inputAmount, sendtx2.getFee()+sendtx2.outputAmount);

        sendtx2 = send([['176MStNg63XY9pxeJjqAMDXvmdtnnQVU9', 37922-sendtx2.getFee()]]);

        console.log(sendtx2.getFee(), sendtx2.inputAmount, sendtx2.getFee()+sendtx2.outputAmount);
        console.log(sendtx2.toString());
        

    } catch (err) {
        console.log('---MAINERROR---');
        console.log(err.stack);
    } finally {
    }
})();
