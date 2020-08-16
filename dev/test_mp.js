const bsv = require('bsv');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const MessageSender = require('../sendmessage.js');
const hashfile = require('../hashfile.js');

const Output = bsv.Transaction.Output;
const Script = bsv.Script;
const TransactionSignature = bsv.Transaction.Signature;
const Sighash = bsv.Transaction.sighash;
const $ = bsv.util.preconditions;
//if (process.argv.length < 3) {
 //   console.log('no data set');
//    process.exit();
//}

//let sendMessage = MessageSender(url, privkey);

var inherits = require('inherits');

function CustomInput () {
    bsv.Transaction.Input.apply(this, arguments);
}

inherits(CustomInput, bsv.Transaction.Input);
  
CustomInput.prototype.getSignatures = function (transaction, privateKey, index, sigtype, hashData) {
    var publicKey = privateKey.toPublicKey();
    //console.log(bsv.crypto.Hash.sha256(this.filebuf).toString('hex'), this.output.script.chunks[1].buf.toString('hex'));
    console.log(privateKey.publicKey.toString(), new bsv.PublicKey(this.output.script.chunks[3].buf).toString());
    
    if (!this.filehash) {
        this.filehash = bsv.crypto.Hash.sha256(this.filebuf).toString('hex');
    }

    let scriptHash = this.output.script.chunks[1].buf.toString('hex');
    let scriptPubKey = new bsv.PublicKey(this.output.script.chunks[3].buf).toString();

    if (publicKey.toString() === scriptPubKey && this.filehash === scriptHash) {
        return [new TransactionSignature({
            publicKey: privateKey.publicKey,
            prevTxId: this.prevTxId,
            outputIndex: this.outputIndex,
            inputIndex: index,
            signature: Sighash.sign(transaction, privateKey, sigtype, index, this.output.script, this.output.satoshisBN),
            sigtype: sigtype
        })];
    } else {
        return [];
    }
}
  
CustomInput.prototype.addSignature = function (transaction, signature) {
    $.checkState(this.isValidSignature(transaction, signature), 'Signature is invalid')

    //tx.verifySignature()

    console.log(this.isValidSignature(transaction, signature));
    let inputScript = new Script();
    inputScript.add(Buffer.concat([
        signature.signature.toDER(),
        Buffer.from([(signature.sigtype || bsv.Transaction.Signature.SIGHASH_ALL) & 0xff])
    ]));
    //inputScript.add(new bsv.PublicKey(signature.publicKey).toBuffer());
    //console.log(this.filebuf);
    inputScript.add(this.filebuf);

    this.setScript(inputScript);
    return this;
}
  
CustomInput.prototype.clearSignatures = function () {
    this.setScript(Script.empty());
    return this;
}
  
CustomInput.prototype.isFullySigned = function () {
    return this.script.chunks.length>0;
}
  
// 32   txid
// 4    output index
// --- script ---
// 1    script size (VARINT)
// 1    signature size (OP_PUSHDATA)
// <=72 signature (DER + SIGHASH type)
// 1    public key size (OP_PUSHDATA)
// 33   compressed public key
//
// 4    sequence number
CustomInput.SCRIPT_MAX_SIZE = 108
  
CustomInput.prototype._estimateSize = function () {
    return bsv.Transaction.Input.BASE_SIZE + CustomInput.SCRIPT_MAX_SIZE + 1 + this.filebuf.length;
};

(async function () {
    try {

        var utxo = bsv.Transaction.UnspentOutput.fromObject({
            address: "1Mn2QTLrLSXuH4g8367QRhD9nG68sBBUrq",
            txid: "c940d0c6800b19a876cb477d6d666bb5351e73ea3c6142a52084641d7a579710",
            vout: 0,
            scriptPubKey: "76a914e3e66801aa8c51028318eacfbf06a531dbc9599c88ac",
            amount: 0.00003000
        });

        var pk0 = bsv.PrivateKey.fromString('KzwMRhRhj4X8m98swMNzrBPnTyWjdypHYqaiA9hjW2rgaSrepAhd');

        let filename = path.resolve(__dirname,'../test_data/secret.txt');
        let filehash = await hashfile('sha256', filename, 'hex');
        // 5a706c64d4a6ef853d17053e57cbefc32ef364e29e3b287c77564e3d25719e9a
        let filebuf = fs.readFileSync(filename);

        let tx = new bsv.Transaction();
        tx.from(utxo);

        var s = new bsv.Script();   
        s.add(bsv.Opcode.OP_SHA256);
        s.add(Buffer.from(filehash,'hex'));
        s.add(bsv.Opcode.OP_EQUALVERIFY);
        s.add(pk0.publicKey.toBuffer());
        s.add(bsv.Opcode.OP_CHECKSIG);

        let o = new Output({ script: s, satoshis: 3000 });

        tx.addOutput(o);
        tx.sign(pk0);

        console.log(tx.verify());

        //let pk1 = bsv.PrivateKey.fromRandom();

        let pk1 = bsv.PrivateKey.fromString('Kyg9XkkNSY7MF769uDXnZtYn6euLXY6e9cLVyWU8siYmzZB2cUGB');
        let a = pk1.toAddress();

        console.log(a.toString(), pk1.toString());

        let tx2 = new bsv.Transaction();

        let input = new CustomInput({
            output: tx.outputs[0],
            prevTxId: tx.id,
            outputIndex: 0,
            script: bsv.Script.empty()
        });
        //filebuf = fs.readFileSync(path.resolve(__dirname,'../test_data/test_send1.json'))
        input.filebuf = filebuf;
        input.filehash = filehash;

        tx2.addInput(input);
        tx2.change(a);

        console.log('SIGN')
        tx2.sign(pk0);
        

        console.log(tx2.getFee(), tx2._getUnspentValue(), tx2.inputAmount, tx2.outputAmount, tx2.isFullySigned());
        console.log(tx2.toString());

        let interp = new bsv.Script.Interpreter();
        let result = interp.verify(tx2.inputs[0].script, o.script, tx2, 0, 
            bsv.Script.Interpreter.SCRIPT_ENABLE_SIGHASH_FORKID,
            new bsv.crypto.BN(3000));
        
        console.log(result, interp.errstr);

    } catch (err) {
        console.log(err.stack);
    }
})();



