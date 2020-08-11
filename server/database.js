const Transactor = require('./transactor.js');
const MessageDb = require('./messagedb.js');
const PaymentDb = require('./paymentdb.js');

function GetDatabase (pool) {

    let db = {
        messages: MessageDb(pool),
        payments: PaymentDb(pool)
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
    Transactor
}