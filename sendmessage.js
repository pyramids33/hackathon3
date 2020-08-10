const bsvMessage = require('bsv/message');
const FormData = require('form-data');
const moment = require('moment');

function MessageSender (url, privkey) {

    function getDataAsString (res) {
        return function () {
            return new Promise(function (resolve, reject) {
                let chunks = [];
                res.on('data', (chunk) => chunks.push(chunk))
                res.on('end', function () {
                    res.data = Buffer.concat(chunks).toString();
                    resolve(res);
                });
            });
        }
    }

    function writeDataToStream (res) {
        return function (writeStream) {
            return new Promise(function (resolve, reject) {
                res.pipe(writeStream);
                writeStream.on('finish', resolve);
                writeStream.on('error', reject);
            });
        }
    }

    function send(args, stream, progress, progressInterval, handleManually) {
        return new Promise(function (resolve, reject) {

            progressInterval = progressInterval||1000;

            if ((args.messageid||'') === '') {
                args.messageid = new Date().valueOf().toString() 
                    + Math.random().toFixed(10).slice(2) 
                    + Math.random().toFixed(10).slice(2);
            }
            
            if ((args.timestamp||'') === '') {
                args.timestamp = moment().toISOString();
            }

            args.sender = privkey.toAddress().toString();

            let message = JSON.stringify(args);
            let sig = new bsvMessage(message).sign(privkey);
            
            let fd = new FormData();
            fd.append('message', message);
            fd.append('sig', sig);
            
            if (stream) {
                fd.append('filedata', stream);
            }

            let req = fd.submit(url, function (err, res) {
                if (err) {
                    reject(err);
                    return;
                }

                if (progress) {
                    progress(req.socket.bytesWritten, true);
                }

                res.getDataAsString = getDataAsString(res);
                res.writeDataToStream = writeDataToStream(res);

                if (handleManually) {
                    resolve(res);
                } else {
                    res.getDataAsString().then(resolve).catch(reject);
                }
            });
                
            req.on('socket', function (socket) {
                function updateProgress () { 
                    if (!req.finished) {
                        progress(socket.bytesWritten);
                        setTimeout(updateProgress, progressInterval);
                    }
                }
                if (progress) {
                    setTimeout(updateProgress, progressInterval);
                }
            });
        });
    }

    return send;
}

module.exports = MessageSender