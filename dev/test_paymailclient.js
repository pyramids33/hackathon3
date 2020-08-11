const bsv = require('bsv');
const bsvMnemonic = require('bsv/mnemonic');
const { PaymailClient } = require('@moneybutton/paymail-client');
const fs = require('fs');

if (process.argv.length < 3) {
    console.log('no data set');
    process.exit();
}

// point to file with mnemonic in it
// {
//     "mnemonic": "etc",
//     "paymail": "etc@moneybutton.com"
// }
let testdata = JSON.parse(fs.readFileSync(process.argv[2]).toString());
console.log(testdata);

(async function () {
    try {
    
    const client = new PaymailClient();

    let pubkey = await client.getPublicKey(testdata.paymail);
    pubkey = bsv.PublicKey.fromHex(pubkey);

    console.log('pubkey', pubkey.toAddress().toString(), pubkey.toString());

    let m = bsvMnemonic.fromString(testdata.mnemonic);
    let xprv = m.toHDPrivateKey();
    let privkey = xprv.deriveChild("m/44'/0'/0'/0/0/0").privateKey;

    console.log('privkey', privkey.toString(), privkey.toAddress().toString());

    let output = await client.getOutputFor(testdata.paymail, {
        senderHandle: testdata.paymail,
        amount: 10000,
        senderName: 'Mr. Sender',
        purpose: 'Pay for your services.'
    }, privkey.toString());

    console.log(output);

    } catch (err) {
        console.log('---MAINERROR---');
        console.log(err.stack);
    } finally {
    }
})();
