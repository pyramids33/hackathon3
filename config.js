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
    mapiUrl: 'https://www.ddpurse.com/openapi/mapi/',
    mapiToken: '561b756d12572020ea9a104c3441b71790acbbce95a6ddbf7e0630971af9424b',
    signingKey: 'L3gZFJgxBFReLt58Jm2A5ejNkiFeZdrpr8b1FQKYs9wijTS7PagJ',
    paymailClient: {
        key: null,
        handle: null
    },
    permissions: [
        [ '*', 'api', '*' ],
        [ '1HML3oox9YQCjFnoStwXULYAiUBxm2G6tw', 'testtag', 'testsubject' ],
        [ '17rGQ4A3NAkhtbwZBCvNjEzfMtkJz9dTGv', 'forms', '*' ]
    ],
    paymentOuts: [
        { paymail: '1698@moneybutton.com', sats: 8000 },
        { address: '12yxtkjgKtaAqLeB3kQn5dgdEwRDS1i249', sats: 8000 },
        //{ hdkeyid: '?', sats: 8000 }
    ]
};


//'1BbtfWARKLFkhvVAbC6GLvRDQsefvbMH9w'
//'02bece04043c0c8dc573f3376a6564d33b73a81b49a9e37edf3184fdca4726899e'

module.exports = config;