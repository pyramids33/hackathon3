
function pluckValue(pgResult, column) {
    return (pgResult.fields.length === 0 || pgResult.rows.length === 0) ? undefined : pgResult.rows[0][column||pgResult.fields[0].name];
}

function pluckRow(pgResult) {
    return (pgResult.rows.length === 0) ? undefined : pgResult.rows[0];
}

function paramCSV (num, start, defaultEmpty) {

    if (num === 0) {
        return defaultEmpty||"null"
    }

    let parts = [];
    
    start = start || 1;

    for (let i = 0; i < num; i++) {
        parts.push('$'+(start+i).toString())
    }

    return parts.join(',');
}

module.exports = { pluckRow, pluckValue, paramCSV }