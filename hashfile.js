const crypto = require('crypto');
const fs = require('fs');

function hashFile(hashName, path, encoding='hex') {
    return new Promise((resolve, reject) => {
        let hash = crypto.createHash(hashName);
        let rs = fs.createReadStream(path);
        rs.on('error', (err) => reject(err));
        rs.on('data', (chunk) => hash.update(chunk));
        rs.on('end', () => resolve(hash.digest(encoding)));
    });
}
module.exports = hashFile;