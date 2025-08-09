async function insertLog({ node, tId, uId, action }, queryPromise) {
  await queryPromise(
    'INSERT INTO Log (node, tId, uId, action) VALUES (?, ?, ?, ?)',
    [node, tId, uId, action]
  );
}
module.exports = insertLog;
