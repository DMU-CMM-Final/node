// const mysql = require('mysql2/promise');

// const db = mysql.createPool({
//     host: 'cmm-database.clye0mci2nwj.us-east-1.rds.amazonaws.com',
//     user: 'cmm',
//     password: 'cmm4012yd',
//     database: 'cmm',
//     port: 3306
// });


// async function queryPromise(query, values) {
//     try {
//         const [results] = await db.execute(query, values);
//         return results;
//     } catch (error) {
//         throw error;
//     }
// }

// module.exports = { db, queryPromise };

const mysql = require('mysql2/promise');

const db = mysql.createPool({
    host: '172.31.87.147',
    user: 'cmm',
    password: 'cmm4012',
    database: 'cmm',
    port: 3306
});

async function queryPromise(query, values) {
    try {
        const [results] = await db.execute(query, values);
        return results;
    } catch (error) {
        throw error;
    }
}

module.exports = { db, queryPromise };



// const mysql = require('mysql2/promise');

// const db = mysql.createPool({
//     host: 'localhost',
//     user: 'root',
//     password: 'hyun',
//     database: 'cmm',
//     port: 3306
// });

// async function queryPromise(query, values) {
//     try {
//         const [results] = await db.execute(query, values);
//         return results;
//     } catch (error) {
//         throw error;
//     }
// }

// module.exports = { db, queryPromise };