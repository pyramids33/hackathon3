const bsv = require('bsv');

const Input = bsv.Transaction.Input;
const Script = bsv.Script;
const TransactionSignature = bsv.Transaction.Signature;
const Sighash = bsv.Transaction.sighash;
const $ = bsv.util.preconditions;

var inherits = require('inherits');

function CustomInput () {
    Input.apply(this, arguments);
}

inherits(CustomInput, Input);

function IsOutputScript (script) {
    return (script.chunks.length === 5
        && script.chunks[0].opcodenum === 168
        && script.chunks[2].opcodenum === 136
        && script.chunks[4].opcodenum === 172);
}

function BuildOutputScript (filehashBuf, pubkeyBuf) {
    var script = new bsv.Script();   
    script.add(bsv.Opcode.OP_SHA256);
    script.add(filehashBuf);
    script.add(bsv.Opcode.OP_EQUALVERIFY);
    script.add(pubkeyBuf);
    script.add(bsv.Opcode.OP_CHECKSIG);
    return script;
}

function PublicKeyFromOutputScript (script) {
    return new bsv.PublicKey(script.chunks[3].buf);
}

function Hash256FromOutputScript (script) {
    return script.chunks[1].buf;
}

CustomInput.IsOutputScript = IsOutputScript;
CustomInput.BuildOutputScript = BuildOutputScript;
CustomInput.PublicKeyFromOutputScript = PublicKeyFromOutputScript;
CustomInput.Hash256FromOutputScript = Hash256FromOutputScript;

CustomInput.prototype.getSignatures = function (transaction, privateKey, index, sigtype, hashData) {
    var publicKey = privateKey.toPublicKey();
    //console.log(bsv.crypto.Hash.sha256(this.filebuf).toString('hex'), this.output.script.chunks[1].buf.toString('hex'));
    //console.log(privateKey.publicKey.toString(), new bsv.PublicKey(this.output.script.chunks[3].buf).toString());
    
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

    let inputScript = new Script();

    inputScript.add(Buffer.concat([
        signature.signature.toDER(),
        Buffer.from([(signature.sigtype || bsv.Transaction.Signature.SIGHASH_ALL) & 0xff])
    ]));

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
    return Input.BASE_SIZE + CustomInput.SCRIPT_MAX_SIZE + 1 + this.filebuf.length;
};

module.exports = CustomInput;