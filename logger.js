async function insertLog({ node, pId, tId, uId, action }, queryPromise) {
  await queryPromise(
    'INSERT INTO Log (node, pId, tId, uId, action) VALUES (?, ?, ?, ?, ?)',
    [node, pId, tId, uId, action]
  );
}
module.exports = insertLog;
