const Transactor = require('./transactor.js');
const { pluckRow, pluckValue, paramCSV } = require('./pgutil.js');
/*
hdkey
name,index,datecreated

address
address,index,datecreated,txype

txos
txid,index,amount,spenttx

tx
txid,txtype,dateadded,status,merkleproof

-------

init
    insert hdkey from random

get_address (txtype)
    generate address from hdkey

add_tx (txtype)
    insert into tx
    insert into txos
    mark txos spent
*/

function WalletDb (pool) {

    let transaction = Transactor(pool);

    function initSchema () {
        return pool.query(`
            create table if not exists hdkeys (id serial primary key, index int, datecreated text, xprv text);
            create table if not exists addresses (address text primary key, hdkey int, index int, datecreated text, txtype text); 
            
            create table if not exists transactions (id serial primary key, txid text, txtype text, 
                datecreated text, status text, merkleproof text); 
            create unique index if not exists transactions_txid on transactions(txid);

            create table if not exists txoutputs (txid text, index text, amount text, spenttxid text, primary key (txid,index)); `);
    }

    function dropSchema () {
        return pool.query(`
            drop table if exists hdkeys;
            drop table if exists addresses;
            drop table if exists transactions;
            drop table if exists txoutputs; 
            
            drop index if exists hdkeys_pkey;
            drop index if exists addresses_pkey;
            drop index if exists transactions_pkey;
            drop index if exists transactions_txid;
            drop index if exists txoutputs_pkey;
            `);
    }

    async function getHDKey (id) {
        if (id === undefined) {
            return pluckRow(await pool.query(`select * from hdkeys order by id desc limit 1`)); 
        } else {
            return pluckRow(await pool.query(`select * from hdkeys where id = $1;`, [ id ])); 
        }   
    }
    
    function addHDKey ({ xprv, datecreated }) {
        return pool.query(`insert into hdkeys (index,datecreated,xprv) values ($1,$2,$3); `, [ 0, datecreated, xprv ]);
    }

    function addAddress ({ address, hdkey, index, datecreated, txtype }) {
        return pool.query(
            `insert into addresses (address, hdkey, index, datecreated, txtype) values ($1,$2,$3,$4,$5);`, 
            [ address, hdkey, index, datecreated, txtype ]);
    }

    function addTransaction ({ txid, datecreated, txtype, outputs, spent }) {
        return transaction(async function (client) {
            await client.query(`insert into transactions (txid, txtype, datecreated) values ($1,$2,$3);`, [ txid, txtype, datecreated ]);
            
            await Promise.all(outputs.map(function (output) {
                client.query(`insert into txoutputs (txid, index, amount) values ($1,$2,$3)`, [ output.txid, output.index, output.amount ])
            })); 
            await Promise.all(spent.map(function (input) {
                client.query(`update txoutputs set spenttxid = $1 where txid = $2 and index = $3;`, [ input.txid, input.txid, input.index ])
            })); 
        });
    }

    async function nextIndex () {
        return pluckRow(await pool.query(`update hdkeys set index = index + 1 where id = (select max(id) from hdkeys) returning id,index,xprv;`));
    }

    async function isKnownAddress (address) {
        return pluckValue(await pool.query(
            `select address from addresses where address = $1`, [ address ]));
    }

    async function getTxOutput (txid,index) {
        return pluckRow(await pool.query(
            `select * from txoutputs where txid = $1 and index = $2`, [ txid, index ]));
    }

    async function getAddress (address) {
        return pluckRow(await pool.query(`
            select addresses.*, hdkeys.xprv 
            from addresses 
                inner join hdkeys on addresses.hdkey = hdkeys.id
            where addresses.address = $1; `, [ address ]));
    }


    return {
        initSchema,
        dropSchema,
        getHDKey,
        addHDKey,
        nextIndex,
        addAddress,
        getAddress,
        isKnownAddress,
        addTransaction,
        getTxOutput
    }
}


function GetDatabase (pool) {

    let db = {
        wallet: WalletDb(pool)
    };

    function initSchemas () {
        return Promise.all(
            Object.keys(db).map(function (k) {
                return db[k].initSchema ? db[k].initSchema() : undefined;
            }).filter (function (item) {
                return item !== undefined;
            })
        );
   }
    
    function dropSchemas () {
        return Promise.all(
            Object.keys(db).map(function (k) {
                return db[k].dropSchema ? db[k].dropSchema() : undefined;
            }).filter (function (item) {
                return item !== undefined;
            })
        );
    }
    
    return {
        initSchemas,
        dropSchemas,
        ...db
    };
}

module.exports = {
    GetDatabase,
    Transactor,
    WalletDb
}