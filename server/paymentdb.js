const moment = require('moment');
const Transactor = require('./transactor.js');
const { pluckRow, pluckValue, paramCSV } = require('./pgutil.js');

function PaymentDb (pool) {

    let transaction = Transactor(pool);

    function initSchema () {
        return pool.query(`
            create table if not exists invoices (invoiceid text primary key, spec text, created text, userid text, 
                amount int, tag text, index int, invoicetx text, paymenttxid text, status text);

            create table if not exists access (txid text primary key, userid text, created text, tag text, index int);

            create index if not exists access_userid_created on access(userid,created)
        `);
    }

    function dropSchema () {
        return pool.query(`
            drop table if exists invoices;
            drop table if exists access;
            
            drop index if exists invoices_pkey;
            drop index if exists access_pkey;
            drop index if exists access_userid_created;
        `);
    }

    function addInvoice ({ invoiceid, spec, created, userid, amount, tag, index, invoicetx }) {
        return pool.query(`
            insert into invoices (invoiceid, spec, created, userid, amount, tag, index, invoicetx) values ($1,$2,$3,$4,$5,$6,$7,$8);`, 
            [ invoiceid, spec, created, userid, amount, tag, index, invoicetx ]);
    }

    function setPaymentAccepted ({ invoiceid, txid }) {
        return pool.query(`update invoices set paymenttxid = $1, status = 'accepted' where invoiceid = $2`, [ txid, invoiceid ]);
    }

    function addAccess ({ invoiceid, txid, userid, created, tag, index  }) {
        return transaction(function (client) {
            return Promise.all([
                client.query(`update invoices set status = 'done' where invoiceid = $1`, [ invoiceid ]),
                client.query(`insert into access (txid,userid,created,tag,index) values ($1,$2,$3,$4,$5)`, [ txid, userid, created, tag, index ])
            ]);
        });
    }

    async function getInvoice(invoiceid) {
        return pluckRow(await pool.query(`select * from invoices where invoiceid = $1; `, [ invoiceid ]));
    }

    async function hasAccess(userid, tag) {
        let created = moment().subtract(1,'h').toISOString();
        return pluckRow(await pool.query(`
            select txid from access where userid = $1 and tag = $2 and created > $3 `, [ userid, tag, created ]));
    }

    return {
        initSchema,
        dropSchema,
        addInvoice,
        getInvoice,
        addAccess,
        hasAccess,
        setPaymentAccepted
    }
}
module.exports = PaymentDb;