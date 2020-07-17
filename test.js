const bsv = require('bsv');
const moment = require('moment');
const { Pool } = require('pg');

const database = require('./database.js');
const config = require('./config.js');

if (process.argv.length > 2) {
    Object.assign(config, JSON.parse(fs.readFileSync(process.argv[2])));
}

console.log('env', process.env.NODE_ENV||'dev');
console.log('config', process.argv[2]||'default');

const pool = new Pool(config.postgres);

pool.on('error', function (err, client) {
    console.log('POOL ERROR', err.message)
});

let test_fund_tx1 = '0100000001d1352f38f25f2d1b719530ba93ed7e5b7bc70bd1fdcd9ba0eb5633582066813a030000006a47304402201e657a'
                   +'30045425cfef108b13ea0356fe6cf92d7d190b507002c0d2ee8eae58cd0220024adf1aabd4afabd7127fd6451da25ff57142'
                   +'2e51e963e2f35d13027a527eb74121037e19f6b1b59179e4c6eb2263a333ed02746dc431bbe4d740d3aee30ccc558754ffff'
                   +'ffff0210270000000000001976a9148bf7622edc7b875fc7152ea94790b60a94bcdc8488accbb90400000000001976a9141f'
                   +'6dae2d86e15c882b5b40ed0718b4104efef17588ac00000000';

async function addTransaction (db, txhex, txtype) {
    
    let tx = new bsv.Transaction(txhex);

    let outputs = tx.outputs.map(async function (output, index) { 
        if (output.script.isPublicKeyHashOut()) {
            let known = await db.isKnownAddress(output.script.toAddress().toString())
            if (known) {
                return { 
                    txid: tx.id,
                    index: index, 
                    address: output.script.toAddress().toString(), 
                    amount: output.satoshis, 
                    scriptPubKey: output.script
                };
            }   
        }
    });

    outputs = (await Promise.all(outputs)).filter(o => o);

    let inputs = tx.inputs.map(async function (input, index) { 
        let known = await db.getTxOutput(input.prevTxId.toString('hex'), input.outputIndex);
        if (known) {
            return {
                txid: input.prevTxId.toString('hex'), 
                index: input.outputIndex
            }
        }
    });
    
    inputs = (await Promise.all(inputs)).filter(o => o);

    //console.log('bb', tx.id, inputs, outputs);

    await db.addTransaction({
        txid: tx.id,
        datecreated: moment().toISOString(),
        txtype: txtype,
        outputs,
        spent: inputs
    });
}


(async function () {
    try {

        let db = database.WalletDb(pool);
        await db.dropSchema();
        await db.initSchema();

        let hdkey = await db.getHDKey();
        
        if (hdkey === undefined) {
            //let newKey = bsv.HDPrivateKey.fromRandom();
            let newKey = bsv.HDPrivateKey.fromString('xprv9s21ZrQH143K4HcStkRBGjoL44SQpoTZUqa37PdtMmWrfwzbPWaDvkmiYg99qxusA5xyjJ7N6N3KXRuRkNFYafSx3VNM3dmKznYqkp7Ekau');
            await db.addHDKey({ xprv: newKey.toString(), datecreated: moment().toISOString() });
            hdkey = await db.getHDKey();
        }

        //console.log(hdkey);

        let nextIndex = await db.nextIndex();
        let nextKey = bsv.HDPrivateKey.fromString(nextIndex.xprv).deriveChild(nextIndex.index,true).privateKey;
        
        await db.addAddress({ 
            address: nextKey.toAddress().toString(), 
            hdkey: nextIndex.id, 
            index: nextIndex.index,
            datecreated: moment().toISOString(),
            txtype: 'funding'
        });

        let address = await db.getAddress(nextKey.toAddress().toString());
        console.log(address);

        nextIndex = await db.nextIndex();
        nextKey = bsv.HDPrivateKey.fromString(nextIndex.xprv).deriveChild(nextIndex.index,true).privateKey;
        console.log(nextKey.toAddress().toString(), nextKey.toString());

        await db.addAddress({ 
            address: nextKey.toAddress().toString(), 
            hdkey: nextIndex.id, 
            index: nextIndex.index,
            datecreated: moment().toISOString(),
            txtype: 'funding'
        });
        ////
        console.table((await pool.query(`select * from addresses`)).rows);

        await addTransaction(db, test_fund_tx1);

        // lookup txoutputs, get txid, index, amount
        let txo = {
            txid: 'f67d0948c1c3d862de769ad92103cbc09879049b562d0c0363b8dd3c7aa3f587',
            index: 0,
            amount: 10000
        };

        let tx1 = new bsv.Transaction(test_fund_tx1);
        let tx2 = new bsv.Transaction();
        let vout = 0;

        tx2.from({
            txid: tx1.id,
            vout: vout,
            amount: txo.amount/100000000,
            address: tx1.outputs[vout].script.toAddress().toString(),
            scriptPubKey: tx1.outputs[vout].script
        });

        tx2.change('1Nmddzij3TpvYZ4smW6YvLWhRGyjbeH3Ws');
        tx2.sign('L4XFTBUFbW7n4rwF6RrMgzQX4ttJX7biNRRFfQ4frCzNUNnSkXho');

        //console.log(tx2.toString())
        await addTransaction(db, tx2.toString(), 'funding');

        console.table((await pool.query(`select * from txoutputs`)).rows);
        console.table((await pool.query(`select * from transactions`)).rows);


    } catch (err) {
        console.log('---MAINERROR---');
        console.log(err.stack);
    } finally {
        pool.end();
    }
})();
