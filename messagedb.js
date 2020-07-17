const Transactor = require('./transactor.js');
const { pluckRow, pluckValue, paramCSV } = require('./pgutil.js');
const crypto = require('crypto');

function MessageDb (pool) {

    let transaction = Transactor(pool);

    function initSchema () {
        return pool.query(`
            create table if not exists messages (id bigserial primary key, 
                messageid text, tag text, index int, subject text, sender text, timestamp text, messagestring text, sig text);

            create table if not exists taghashes (tag text primary key, index int, hash bytea);

            create unique index if not exists messages_tag_index on messages(tag,index);
            create unique index if not exists messages_messageid on messages(messageid);
            create index if not exists messages_timestamp on messages(timestamp);
        `);
    }

    function dropSchema () {
        return pool.query(`
            drop table if exists messages;
            drop table if exists taghashes;

            drop index if exists messages_messageid;
            drop index if exists messages_tag_index;
            drop index if exists messages_timestamp;
            drop index if exists messages_pkey;
            drop index if exists taghashes_pkey;`);
    }
    
    function addMessage ({ messageid, tag, subject, sender, timestamp, messagestring, sig }, beforeCommit) {
        return transaction(async function (client) {
            try {
                let hash = crypto.createHash('sha256');
                hash.update(Buffer.from(messagestring));
                hash = hash.digest('hex');

                let tagHash = pluckRow(await client.query(`
                    insert into taghashes (tag,index,hash)
                    values ($1, 1, decode($2,'hex'))
                    on conflict (tag) do 
                    update set 
                        index = taghashes.index + 1,
                        hash = sha256(taghashes.hash || decode($3,'hex')) 
                    returning taghashes.index, taghashes.hash;`,
                    [ tag, hash, hash ] ));

                let pgResult = await client.query(`
                    insert into messages (messageid,tag,index,subject,sender,timestamp,messagestring,sig)
                    values ($1,$2,$3,$4,$5,$6,$7,$8);`,
                    [ messageid, tag, tagHash.index, subject, sender, timestamp, messagestring, sig ]);

                if (beforeCommit) {
                    await beforeCommit(client);
                }
                
                return pgResult;
            } catch (err) {
                if (err.message.startsWith('duplicate key value violates unique constraint')) {
                    throw new Error('MESSAGE_ID_EXISTS');
                }
                throw err;
            }
        });
    }

    return {
        initSchema,
        dropSchema,
        addMessage
    }
}

module.exports = MessageDb;