const path = require('path');

// Default Config
let config = {
    postgres: {
        user: 'hackathon3',
        host: 'localhost',
        database: 'hackathon3',
        password: 'hackathonxdse',
        port: 5432,
    },
    host: 'localhost',
    port: 6767,
    env: 'dev',
    tempPath: path.resolve(__dirname, '../data/temp/'),
    storagePath: path.resolve(__dirname, '../data/storage/'),
    mapiUrl: 'https://merchantapi.matterpool.io/mapi/'
};
module.exports = config;