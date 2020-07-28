const bsvMessage = require('bsv/message');
const crypto = require('crypto');
const path = require('path');

function requireLogin (req, res, next){
    if (req.session.userid === undefined) {
        res.sendFile(path.resolve(__dirname,'site/login.html'));
        return;
    }
    next();
}

function getToken (req,res) {
    crypto.randomBytes(32, function (err, buf) {
        req.session.token = buf.toString('hex');
        res.status(200).json({ token: req.session.token });
        return;
    });
}

function doLogout (req, res) {
    req.session.token = undefined;
    req.session.userid = undefined;
    req.session.useraddr = undefined;
    res.redirect('/');
}

function doLogin (req, res) {
    let token = req.session.token;
    let paymail = req.body.paymail;
    let address = req.body.address;

    if (req.body.token !== token) {
        res.status(200).json({ error: 'INVALID_MESSAGE' });
        return;
    }

    try {
        let validSig = new bsvMessage(req.body.token).verify(req.body.address, req.body.sig);
        
        if (!validSig) {
            res.status(200).json({ error: 'INVALID_SIGNATURE' });
            return;
        }
    } catch (error) {
        res.status(200).json({ error: 'INVALID_SIGNATURE' });
        return;
    }

    req.session.userid = paymail;
    req.session.useraddr = address;
    res.status(200).json({});
    return;
}

module.exports = {
    requireLogin,
    doLogin,
    doLogout,
    getToken
};