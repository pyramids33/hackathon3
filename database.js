const Transactor = require('./transactor.js');
const { pluckRow, pluckValue, paramCSV } = require('./pgutil.js');

const WalletDb = require('./walletdb.js');
const MessageDb = require('./messagedb.js');

function GetDatabase (pool) {

    let db = {
        wallet: WalletDb(pool),
        messages: MessageDb(pool)
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