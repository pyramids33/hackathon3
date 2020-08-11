
function Transactor(pool) {
    return async function (func) { 
        const client = await pool.connect();
        let res;
        try {
            await client.query('BEGIN; ');
            res = await func(client);
            await client.query('COMMIT; ');      
        } catch (e) {
            await client.query('ROLLBACK; ');
            throw e;
        } finally {
            client.release();
        }
        return res;
    }
}

module.exports = Transactor;
