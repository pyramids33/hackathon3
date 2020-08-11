const Busboy = require('busboy');
const fs = require('fs');
const path = require('path');

function multipartReader ({ tempDir }) {
    return function (req, res, next) {
        
        req.body = {};
        req.files = {};

        let contentType = req.headers['content-type'];
        
        if (!(typeof(contentType) === 'string' && contentType.startsWith('multipart/form-data'))) {
            res.status(400).json({ error: 'INVALID_CONTENT_TYPE', accepts: 'multipart/form-data' });
            return;
        }

        let busboy = new Busboy({ headers: req.headers });

        busboy.on('field', function(fieldname, val, fieldnameTruncated, valTruncated, encoding, mimetype) {
            req.body[fieldname] = val;

            if (fieldname === 'message') {
              req.message = JSON.parse(val);
            }
        });

        busboy.on('file', function(fieldname, file, filename, encoding, mimetype) {
            let tempFile = path.join(tempDir, new Date().valueOf().toString() + '-' + Math.random().toString().slice(2));
            req.files[fieldname] = { file: tempFile, filename, encoding, mimetype };
            file.pipe(fs.createWriteStream(tempFile));
        });

        busboy.on('finish', next);

        busboy.on('error', function (error) {
            console.log('busboyerror', error.stack);
            res.writeHead(500);
            res.end();
        });

        req.pipe(busboy);
    };
}

module.exports = multipartReader;