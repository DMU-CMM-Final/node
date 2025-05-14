// const express = require('express');
// const http = require('http');
// const socketIo = require('socket.io');
// const mysql = require('mysql2/promise'); // mysql2/promise 사용

// const app = express();
// const server = http.createServer(app);
// const io = socketIo(server, { cors: { origin: '*' } });

// // DB 연결 설정 (본인 환경에 맞게 수정)
// const db = mysql.createPool({
//     host: 'localhost',
//     user: 'root',
//     password: 'hyun',
//     database: 'cmm', // 본인 DB명으로 변경
//     waitForConnections: true,
//     connectionLimit: 10,
//     queueLimit: 0
// });

// // 쿼리 실행 함수
// function queryPromise(sql, params = []) {
//     return db.query(sql, params)
//         .then(([rows, fields]) => rows)
//         .catch(err => { console.error('DB Error:', err); throw err; });
// }

// let votes = [];

// // 서버 시작 시 DB에서 투표 데이터 불러오기 (선택적)
// async function initializeVotes() {
//     try {
//         const voteResults = await queryPromise('SELECT * FROM Vote', []);
//         votes = voteResults.map(row => ({
//             node: row.node,
//             x: 0, // 위치/크기는 필요시 ProjectInfo에서 불러오세요
//             y: 0,
//             width: 300,
//             height: 200,
//             title: row.title || '',
//             list: [
//                 { num: 1, content: row.list1, count: row.list1Num },
//                 { num: 2, content: row.list2, count: row.list2Num },
//                 { num: 3, content: row.list3, count: row.list3Num },
//                 { num: 4, content: row.list4, count: row.list4Num }
//             ],
//             tId: row.tId
//         }));
//         console.log('투표 초기화 성공:', votes);
//     } catch (error) {
//         console.error('투표 초기화 실패:', error);
//     }
// }

// initializeTextBoxes().then(() => initializeVotes().then(() => {
//     io.on('connection', (socket) => {
//         let currentTeamId = null;
//         let currentUserId = null;

//         // 팀 입장
//         socket.on('joinTeam', async ({ uId }) => {
//             currentUserId = uId;
//             const teamRows = await queryPromise('SELECT tId FROM TeamMem WHERE uId = ?', [uId]);
//             if (!teamRows.length) {
//                 socket.emit('error', { message: '팀이 없습니다.' });
//                 return;
//             }
//             currentTeamId = teamRows[0].tId;
//             socket.join(String(currentTeamId));

//             // 팀별 텍스트박스/투표만 초기화해서 보내줌
//             const teamTextBoxes = textBoxes.filter(box => box.tId == currentTeamId);
//             socket.emit('initialize', teamTextBoxes);

//             const teamVotes = votes.filter(vote => vote.tId == currentTeamId);
//             socket.emit('initializeVotes', teamVotes);
//         });

//         // 텍스트박스 CRUD (생략, 기존 코드와 동일)

//         // ------------------ 투표 CRUD ------------------
//         socket.on('vote', async (data) => {
//             if (!currentTeamId) return;
//             const { fnc, node, cLocate, cScale, cTitle, cList, type = 'vote' } = data;

//             if (fnc === 'new') {
//                 const newNode = uuidv4();
//                 const x = cLocate?.x || 0;
//                 const y = cLocate?.y || 0;
//                 const width = cScale?.width || 300;
//                 const height = cScale?.height || 200;
//                 const vote = {
//                     node: newNode,
//                     x, y, width, height,
//                     title: cTitle || '',
//                     list: cList || [],
//                     tId: currentTeamId
//                 };
//                 const list1 = cList?.[0]?.content || '';
//                 const list2 = cList?.[1]?.content || '';
//                 const list3 = cList?.[2]?.content || '';
//                 const list4 = cList?.[3]?.content || '';
//                 try {
//                     await queryPromise(
//                         'INSERT INTO Vote (node, pId, tId, title, list1, list2, list3, list4, list1Num, list2Num, list3Num, list4Num) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
//                         [newNode, 1, currentTeamId, cTitle, list1, list2, list3, list4, 0, 0, 0, 0]
//                     );
//                     await queryPromise(
//                         'INSERT INTO ProjectInfo (node, pId, tId, dType, locate, scale) VALUES (?, ?, ?, ?, ?, ?)',
//                         [newNode, 1, currentTeamId, 'vote', JSON.stringify({ x, y }), JSON.stringify({ width, height })]
//                     );
//                 } catch (error) {
//                     console.error('새 투표 저장 실패:', error);
//                 }
//                 votes.push(vote);
//                 const responseData = {
//                     type, fnc, node: newNode,
//                     cLocate: { x, y },
//                     cScale: { width, height },
//                     cTitle: cTitle,
//                     cList: cList,
//                     tId: currentTeamId
//                 };
//                 io.to(String(currentTeamId)).emit('addVote', responseData);

//             } else if (fnc === 'update') {
//                 const vote = votes.find(v => v.node === node && v.tId == currentTeamId);
//                 if (vote) {
//                     if (cTitle !== undefined) vote.title = cTitle;
//                     if (cList !== undefined) vote.list = cList;
//                     const list1 = cList?.[0]?.content || '';
//                     const list2 = cList?.[1]?.content || '';
//                     const list3 = cList?.[2]?.content || '';
//                     const list4 = cList?.[3]?.content || '';
//                     try {
//                         await queryPromise(
//                             'UPDATE Vote SET title = ?, list1 = ?, list2 = ?, list3 = ?, list4 = ? WHERE node = ? AND pId = ? AND tId = ?',
//                             [cTitle, list1, list2, list3, list4, node, 1, currentTeamId]
//                         );
//                     } catch (error) {
//                         console.error('투표 업데이트 실패:', error);
//                     }
//                     const responseData = {
//                         type, fnc, node,
//                         cTitle: cTitle,
//                         cList: cList,
//                         tId: currentTeamId
//                     };
//                     io.to(String(currentTeamId)).emit('updateVote', responseData);
//                 }
//             } else if (fnc === 'move') {
//                 const vote = votes.find(v => v.node === node && v.tId == currentTeamId);
//                 if (vote) {
//                     if (cLocate) {
//                         vote.x = Number(cLocate.x);
//                         vote.y = Number(cLocate.y);
//                     }
//                     if (cScale) {
//                         if (cScale.width !== undefined) vote.width = cScale.width;
//                         if (cScale.height !== undefined) vote.height = cScale.height;
//                     }
//                     try {
//                         await queryPromise(
//                             'UPDATE ProjectInfo SET locate = ?, scale = ? WHERE node = ? AND pId = ? AND tId = ?',
//                             [JSON.stringify({ x: vote.x, y: vote.y }), JSON.stringify({ width: vote.width, height: vote.height }), node, 1, currentTeamId]
//                         );
//                     } catch (error) {
//                         console.error('투표 위치/크기 업데이트 실패:', error);
//                     }
//                     const responseData = {
//                         type, fnc, node,
//                         cLocate: { x: vote.x, y: vote.y },
//                         cScale: { width: vote.width, height: vote.height },
//                         tId: currentTeamId
//                     };
//                     io.to(String(currentTeamId)).emit('moveVote', responseData);
//                 }
//             } else if (fnc === 'delete') {
//                 const initialLength = votes.length;
//                 votes = votes.filter(v => !(v.node === node && v.tId == currentTeamId));
//                 if (initialLength !== votes.length) {
//                     try {
//                         await queryPromise('DELETE FROM Vote WHERE node = ? AND pId = ? AND tId = ?', [node, 1, currentTeamId]);
//                         await queryPromise('DELETE FROM ProjectInfo WHERE node = ? AND pId = ? AND tId = ?', [node, 1, currentTeamId]);
//                     } catch (error) {
//                         console.error('투표 삭제 실패:', error);
//                     }
//                     const responseData = { type, fnc, node, tId: currentTeamId };
//                     io.to(String(currentTeamId)).emit('removeVote', responseData);
//                 }
//             } else if (fnc === 'choice') {
//                 const { user, num } = data;
//                 const column = `list${num}Num`;
//                 try {
//                     await queryPromise(
//                         `UPDATE Vote SET ${column} = ${column} + 1 WHERE node = ? AND pId = ? AND tId = ?`,
//                         [node, 1, currentTeamId]
//                     );
//                     const [result] = await queryPromise('SELECT * FROM Vote WHERE node = ? AND pId = ? AND tId = ?', [node, 1, currentTeamId]);
//                     const responseData = {
//                         type, fnc, node,
//                         cTitle: result.title,
//                         cList: [
//                             { num: 1, content: result.list1, count: result.list1Num },
//                             { num: 2, content: result.list2, count: result.list2Num },
//                             { num: 3, content: result.list3, count: result.list3Num },
//                             { num: 4, content: result.list4, count: result.list4Num }
//                         ],
//                         tId: currentTeamId
//                     };
//                     io.to(String(currentTeamId)).emit('updateVote', responseData);
//                 } catch (error) {
//                     console.error('투표 선택 실패:', error);
//                 }
//             }
//         });

//         socket.on('disconnect', () => {
//             if (currentTeamId) socket.leave(String(currentTeamId));
//         });
//     });
// }));

// server.listen(3000, () => {
//     console.log('서버가 3000번 포트에서 실행 중입니다.');
// });