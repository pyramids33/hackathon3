const bsvMessage = require('bsv/message');
const FormData = require('form-data');

function MessageSender (url, privkey) {

    function send(args, stream, progress, progressInterval) {
        return new Promise(function (resolve, reject) {

            progressInterval = progressInterval||1000;

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

                let chunks = [];
                res.on('data', (chunk) => chunks.push(chunk))
                res.on('end', function () {
                    res.data = Buffer.concat(chunks).toString();
                    resolve(res);
                });
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