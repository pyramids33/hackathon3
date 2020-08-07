const bsvMessage = require('bsv/message');

function JSONEnveloper(privkey) {
    return function (obj) {
        let message = JSON.stringify(obj);
        let sig = new bsvMessage(message).sign(privkey);
        return {
            payload: message,
            sig: sig.toString('hex'),
            publicKey: privkey.toPublicKey().toString(),
            encoding: 'UTF-8',
            mimetype: 'application/json'
        }
    }
}

module.exports = JSONEnveloper;