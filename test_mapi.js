const bsv = require('bsv');
const axios = require('axios').default;

(async function () {
    try {

        let txstring = '010000000187f5a37a3cddb863030c2d569b047998c0cb0321d99a76de62d8c3c148097df6000000006b48304502210083268ac4e99621dee2b46a9182961f924e1c70a79cb2fe30a9e3a9150da6f91302206d95105dbea88defc401d5715fb5a9a9f7c123e0d41773738931243aa1e675d54121021e3add15733e3f0a5fdcfd48b42461686615db07243a5b5fadb2bd7dac7fb9dfffffffff01b0260000000000001976a9149b037bf423afe88c7d07219b4c757e24421777a188ac00000000';

        let res = await axios.get(
            'https://www.ddpurse.com/openapi/mapi/feeQuote', 
            { headers: { 
                'token': '561b756d12572020ea9a104c3441b71790acbbce95a6ddbf7e0630971af9424b'
            }});

        console.log(res.data);

        res = await axios.post(
            'https://www.ddpurse.com/openapi/mapi/tx', 
            { rawtx: txstring }, 
            { headers: { 
                'token': '561b756d12572020ea9a104c3441b71790acbbce95a6ddbf7e0630971af9424b'
            }});

        console.log(res.data);


        res = await axios.get(
            'https://www.ddpurse.com/openapi/mapi/tx/29f03d81759addc76618a6ab72caf17ea86845ecfb5d4b70c8ddbd019e59e868',
            { headers: { 
                'token': '561b756d12572020ea9a104c3441b71790acbbce95a6ddbf7e0630971af9424b'
            }});

        console.log(res.data);

        // {
        //     payload: '{"apiVersion":"0.1.0","timestamp":"2020-07-27T05:32:06.286Z","returnResult":"failure","resultDescription":"ERROR: No such mempool or blockchain transaction. Use gettransaction for wallet transactions.","blockHash":null,"blockHeight":null,"confirmations":0,"minerId":"0211ccfc29e3058b770f3cf3eb34b0b2fd2293057a994d4d275121be4151cdf087","txSecondMempoolExpiry":0}',
        //     signature: '304502210095e40324497395ad57efeaae17af3b354c702961d803c0db0a64067cc918b9ea02200487d300edd3abd70a44bfcc609790b7c9e983b206f39ff0c4d9cbc75bf68a0b',
        //     publicKey: '0211ccfc29e3058b770f3cf3eb34b0b2fd2293057a994d4d275121be4151cdf087',
        //     encoding: 'UTF-8',
        //     mimetype: 'application/json'
        // }

        // {
        //     payload: '{"apiVersion":"0.1.0","timestamp":"2020-07-27T10:23:54.974Z","txid":"c58a5ca74d3a034464a0ea149ce552d427e2c15070b9d73374c8485d26eec44d","returnResult":"success","resultDescription":"","minerId":null,"currentHighestBlockHash":"0000000000000000015253d19b10e10836b3fb6d55c6e0ef442e7a7a0ad3e5b8","currentHighestBlockHeight":645510,"txSecondMempoolExpiry":0}',
        //     signature: null,
        //     publicKey: null,
        //     encoding: 'UTF-8',
        //     mimetype: 'applicaton/json'
        // }

    } catch (err) {
        console.log('---MAINERROR---');
        console.log(err.stack);
    } finally {
    }
})();
